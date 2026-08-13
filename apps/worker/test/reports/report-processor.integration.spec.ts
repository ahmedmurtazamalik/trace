import { PrismaClient } from '@trace/database';
import { DeterministicReportProvider, type ReportInputSnapshot, type StructuredReportProvider } from '../../src/reports/report-provider';
import { ReportProcessor } from '../../src/reports/report.processor';

const prisma = new PrismaClient();
const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-13',
  timezone: 'UTC',
  facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  repositories: [],
};

describe('structured report processor', () => {
  const email = 'day9-worker@example.test';
  let reportId: string;

  const clean = async (): Promise<void> => {
    const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
    await prisma.report.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await prisma.user.deleteMany({ where: { email } });
  };

  beforeAll(async () => prisma.$connect());
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await clean();
    const user = await prisma.user.create({
      data: { username: `day9-${Date.now()}`, email, passwordHash: 'not-used-in-worker-tests' },
    });
    const report = await prisma.report.create({
      data: { userId: user.id, reportDate: new Date('2026-08-13T00:00:00.000Z'), timezone: 'UTC', inputSnapshot: snapshot },
    });
    reportId = report.id;
  });

  it('stores one editable AI revision and remains processing until Day 10 creates an artifact', async () => {
    const processor = new ReportProcessor(prisma, new DeterministicReportProvider());

    await processor.process(reportId);
    await processor.process(reportId);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { revisions: true } });
    expect(report).toMatchObject({ status: 'processing', completedAt: null, error: null });
    expect(report.aiOutput).toEqual(report.revisions[0]?.content);
    expect(report.revisions).toEqual([
      expect.objectContaining({ revision: 1, source: 'ai' }),
    ]);
  });

  it('retries schema or grounding failures within a fixed bound before persisting valid content', async () => {
    const valid = await new DeterministicReportProvider().generate(snapshot);
    const generate = jest.fn<Promise<unknown>, [ReportInputSnapshot]>()
      .mockResolvedValueOnce({ arbitraryLatex: '\\write18{curl attacker}' })
      .mockResolvedValueOnce(valid);
    const processor = new ReportProcessor(prisma, { generate }, { maximumAttempts: 3 });

    await processor.process(reportId);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'processing',
      error: null,
    });
  });

  it('stores only a closed safe error after bounded provider failures', async () => {
    const generate = jest.fn().mockRejectedValue(new Error('secret provider payload and api key'));
    const provider: StructuredReportProvider = { generate };
    const processor = new ReportProcessor(prisma, provider, { maximumAttempts: 2 });

    await expect(processor.process(reportId)).resolves.toBeUndefined();

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { revisions: true } });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ status: 'failed', error: 'Report generation failed.', completedAt: null, aiOutput: null });
    expect(report.revisions).toHaveLength(0);
  });

  it('fences concurrent duplicate processing so only the lease owner can persist', async () => {
    const valid = await new DeterministicReportProvider().generate(snapshot);
    let releaseFailure: (() => void) | undefined;
    const stalledFailure = new Promise<void>((resolve) => { releaseFailure = resolve; });
    const owner = new ReportProcessor(prisma, {
      generate: async () => { await stalledFailure; return valid; },
    }, { maximumAttempts: 1 });
    const duplicateGenerate = jest.fn().mockRejectedValue(new Error('transient'));
    const duplicate = new ReportProcessor(prisma, { generate: duplicateGenerate }, { maximumAttempts: 1 });

    const first = owner.process(reportId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = duplicate.process(reportId);
    await expect(second).rejects.toThrow('REPORT_PROCESSING_RETRY');
    releaseFailure?.();
    await first;

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { revisions: true } });
    expect(report.status).toBe('processing');
    expect(report.revisions).toHaveLength(1);
    expect(duplicateGenerate).not.toHaveBeenCalled();
  });

  it('prevents an expired owner from persisting after a successor claim', async () => {
    const valid = await new DeterministicReportProvider().generate(snapshot);
    let releaseOwner: (() => void) | undefined;
    const ownerWait = new Promise<void>((resolve) => { releaseOwner = resolve; });
    const owner = new ReportProcessor(prisma, {
      generate: async () => { await ownerWait; return valid; },
    }, { maximumAttempts: 1, leaseDurationMs: 30_000 });
    const first = owner.process(reportId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await prisma.report.update({ where: { id: reportId }, data: { processingExpiresAt: new Date(0) } });
    await new ReportProcessor(prisma, new DeterministicReportProvider(), { maximumAttempts: 1 }).process(reportId);
    releaseOwner?.();
    await first;
    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { revisions: true } });
    expect(report.revisions).toHaveLength(1);
    expect(report.processingToken).toBeNull();
  });
});
