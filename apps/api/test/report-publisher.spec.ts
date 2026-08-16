import { Logger } from '@nestjs/common';
import type { PrismaService } from '@trace/database';
import { ReportPublisher } from '../src/modules/reports/report.publisher';
import type { ReportQueue } from '../src/modules/reports/report.queue';

describe('report publication reconciliation', () => {
  it('does not log queue or database exception details', async () => {
    const secret = 'redis://user:password@private-host:6379?token=opaque';
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const prisma = {
      report: { findFirst: jest.fn().mockRejectedValue(new Error(secret)) },
    } as unknown as PrismaService;
    const publisher = new ReportPublisher(prisma, { enqueue: jest.fn() } as unknown as ReportQueue);

    await publisher.publishOneBounded('report-id');

    expect(logger).toHaveBeenCalledWith('Failed report report-id (type=Error)');
    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    logger.mockRestore();
  });

  it('uses independent fair batches for render and initial obligations', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { report: { findMany } } as unknown as PrismaService;
    const queue = { enqueue: jest.fn() } as unknown as ReportQueue;

    await new ReportPublisher(prisma, queue).publishOwed();

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { status: 'processing', renderRevision: { not: null } },
      take: 50,
      orderBy: [
        { renderPublishedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ],
    }));
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        status: { in: ['pending', 'processing'] },
        renderRevision: null,
        revisions: { none: {} },
      },
      take: 50,
      orderBy: [
        { publishedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ],
    }));
  });

  it('rotates failed cohorts so later obligations in each class are attempted', async () => {
    type Row = { id: string; renderRevision: number | null; renderGeneration: number; publishedAt: Date | null; renderPublishedAt: Date | null };
    const rows: Row[] = [
      ...Array.from({ length: 50 }, (_, index): Row => ({
        id: `poison-render-${index}`, renderRevision: 1, renderGeneration: 1,
        publishedAt: null, renderPublishedAt: null,
      })),
      { id: 'later-render', renderRevision: 1, renderGeneration: 1, publishedAt: null, renderPublishedAt: null },
      ...Array.from({ length: 50 }, (_, index): Row => ({
        id: `poison-initial-${index}`, renderRevision: null, renderGeneration: 0,
        publishedAt: null, renderPublishedAt: null,
      })),
      { id: 'later-initial', renderRevision: null, renderGeneration: 0, publishedAt: null, renderPublishedAt: null },
    ];
    const findMany = jest.fn().mockImplementation(({ where }: { where: { status: unknown } }) => {
      const render = where.status === 'processing';
      const clock = (row: Row): Date | null => render ? row.renderPublishedAt : row.publishedAt;
      return Promise.resolve(rows
        .filter((row) => render ? row.renderRevision !== null : row.renderRevision === null)
        .sort((left, right) => {
          const leftClock = clock(left);
          const rightClock = clock(right);
          if (leftClock === null || rightClock === null) return leftClock === rightClock ? 0 : leftClock === null ? -1 : 1;
          return leftClock.getTime() - rightClock.getTime();
        })
        .slice(0, 50)
        .map(({ id }) => ({ id })));
    });
    const findFirst = jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.find((row) => row.id === where.id) ?? null));
    const updateMany = jest.fn().mockImplementation(({ where, data }: {
      where: { id: string }; data: { publishedAt?: Date; renderPublishedAt?: Date };
    }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (row === undefined) return Promise.resolve({ count: 0 });
      if (data.publishedAt !== undefined) row.publishedAt = data.publishedAt;
      if (data.renderPublishedAt !== undefined) row.renderPublishedAt = data.renderPublishedAt;
      return Promise.resolve({ count: 1 });
    });
    const enqueue = jest.fn().mockImplementation((id: string) =>
      id.startsWith('poison-') ? Promise.reject(new Error('queue unavailable')) : Promise.resolve());
    const prisma = { report: { findMany, findFirst, updateMany } } as unknown as PrismaService;
    const publisher = new ReportPublisher(prisma, { enqueue } as unknown as ReportQueue);

    await publisher.publishOwed();
    await publisher.publishOwed();

    expect(enqueue).toHaveBeenCalledWith('later-render');
    expect(enqueue).toHaveBeenCalledWith('later-initial');
  });

  it('commits every selected attempt clock before queue I/O and bounds a fully hanging cohort', async () => {
    const reports = Array.from({ length: 100 }, (_, index) => ({ id: `hanging-${index}` }));
    const findMany = jest.fn()
      .mockResolvedValueOnce(reports.slice(0, 50))
      .mockResolvedValueOnce(reports.slice(50));
    const findFirst = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({
      id: where.id,
      renderRevision: where.id === 'hanging-0' ? 1 : null,
      renderGeneration: 1,
    }));
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    let attemptedBeforeFirstQueueCall = 0;
    const enqueue = jest.fn().mockImplementation(() => {
      if (enqueue.mock.calls.length === 1) attemptedBeforeFirstQueueCall = updateMany.mock.calls.length;
      return new Promise<void>(() => undefined);
    });
    const prisma = { report: { findMany, findFirst, updateMany } } as unknown as PrismaService;
    const publisher = new ReportPublisher(prisma, { enqueue } as unknown as ReportQueue);
    const startedAt = Date.now();

    await publisher.publishOwed();

    expect(attemptedBeforeFirstQueueCall).toBe(100);
    expect(updateMany).toHaveBeenCalledTimes(100);
    expect(enqueue).toHaveBeenCalledTimes(100);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  }, 5_000);

  it('publishes render work even when more than 100 initial reports are outstanding', async () => {
    const renderReports = Array.from({ length: 50 }, (_, index) => ({ id: `render-${index}` }));
    const initialReports = Array.from({ length: 50 }, (_, index) => ({ id: `initial-${index}` }));
    const findMany = jest.fn()
      .mockResolvedValueOnce(renderReports)
      .mockResolvedValueOnce(initialReports);
    const findFirst = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({
      id: where.id,
      renderRevision: where.id.startsWith('render-') ? 2 : null,
      renderGeneration: 3,
    }));
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const prisma = { report: { findMany, findFirst, updateMany } } as unknown as PrismaService;
    const queue = { enqueue } as unknown as ReportQueue;

    await new ReportPublisher(prisma, queue).publishOwed();

    expect(enqueue).toHaveBeenCalledTimes(100);
    expect(enqueue).toHaveBeenCalledWith('render-49');
    expect(enqueue).toHaveBeenCalledWith('initial-49');
  });
});
