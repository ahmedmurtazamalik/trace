import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { ReportQueue } from './report.queue';

const PUBLISH_INTERVAL_MS = 5_000;
const REQUEST_PUBLISH_TIMEOUT_MS = 1_000;
const PUBLISH_BATCH_SIZE = 100;
const PUBLISH_TYPE_BATCH_SIZE = PUBLISH_BATCH_SIZE / 2;

@Injectable()
export class ReportPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportPublisher.name);
  private interval: NodeJS.Timeout | undefined;
  private reconciliation: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ReportQueue,
  ) {}

  onApplicationBootstrap(): void {
    void this.publishOwed().catch((error: unknown) => this.logFailure('startup reconciliation', error));
    this.interval = setInterval(
      () => void this.publishOwed().catch((error: unknown) => this.logFailure('interval reconciliation', error)),
      PUBLISH_INTERVAL_MS,
    );
    this.interval.unref();
  }

  async publishOneBounded(reportId: string): Promise<void> {
    try {
      if (!await this.prepareOne(reportId)) return;
    } catch (error) {
      this.logFailure(`report ${reportId}`, error);
      return;
    }
    await this.enqueueAndMarkQueued(reportId);
  }

  async publishOwed(): Promise<void> {
    if (this.reconciliation !== undefined) return this.reconciliation;
    this.reconciliation = this.reconcile();
    try {
      await this.reconciliation;
    } finally {
      this.reconciliation = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    await this.reconciliation;
  }

  private async reconcile(): Promise<void> {
    const [renderReports, initialReports] = await Promise.all([
      this.prisma.report.findMany({
        where: { status: 'processing', renderRevision: { not: null } },
        orderBy: [
          { renderPublishedAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
        ],
        take: PUBLISH_TYPE_BATCH_SIZE,
        select: { id: true },
      }),
      this.prisma.report.findMany({
        where: {
          status: { in: ['pending', 'processing'] },
          renderRevision: null,
          revisions: { none: {} },
        },
        orderBy: [
          { publishedAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
        ],
        take: PUBLISH_TYPE_BATCH_SIZE,
        select: { id: true },
      }),
    ]);
    const selected = [...renderReports, ...initialReports];
    const prepared = await Promise.all(selected.map(async ({ id }) => {
      try {
        return await this.prepareOne(id) ? id : null;
      } catch (error) {
        this.logFailure(`report ${id}`, error);
        return null;
      }
    }));
    await Promise.all(prepared
      .filter((id): id is string => id !== null)
      .map((id) => this.enqueueAndMarkQueued(id)));
  }

  private async prepareOne(reportId: string): Promise<boolean> {
    const report = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        status: { in: ['pending', 'processing'] },
        OR: [{ revisions: { none: {} } }, { renderRevision: { not: null } }],
      },
      select: { id: true, renderRevision: true, renderGeneration: true },
    });
    if (report === null) return false;
    const observedAt = new Date();
    if (report.renderRevision !== null) {
      const attempted = await this.prisma.report.updateMany({
        where: {
          id: report.id,
          status: 'processing',
          renderRevision: report.renderRevision,
          renderGeneration: report.renderGeneration,
        },
        data: { renderPublishedAt: observedAt },
      });
      return attempted.count === 1;
    }
    const attempted = await this.prisma.report.updateMany({
      where: {
        id: report.id,
        status: { in: ['pending', 'processing'] },
        renderRevision: null,
        revisions: { none: {} },
      },
      data: { publishedAt: observedAt },
    });
    return attempted.count === 1;
  }

  private async enqueueAndMarkQueued(reportId: string): Promise<void> {
    try {
      await this.withTimeout(this.queue.enqueue(reportId), REQUEST_PUBLISH_TIMEOUT_MS);
    } catch (error) {
      this.logFailure(`report ${reportId}`, error);
      return;
    }
    try {
      await this.prisma.workspaceReportOccurrence.updateMany({
        where: { reportId, status: 'PENDING' },
        data: { status: 'QUEUED', publishedAt: new Date() },
      });
    } catch (error) {
      this.logFailure(`workspace occurrence for report ${reportId}`, error);
    }
  }

  private async withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Report queue publication timed out.')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private logFailure(operation: string, error: unknown): void {
    const type = error instanceof Error ? error.name : 'UnknownError';
    this.logger.error(`Failed ${operation} (type=${type})`);
  }
}
