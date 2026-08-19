import { Buffer } from 'node:buffer';
import { PrismaClient } from '@trace/database';
import type { ArtifactStorage } from '@trace/report-storage';
import { PDFDocument } from 'pdf-lib';
import type { LatexCompiler } from '../../src/latex/latex-compiler';
import { ReportArtifactProcessor } from '../../src/reports/report-artifact.processor';
import { DeterministicReportProvider, type ReportInputSnapshot } from '../../src/reports/report-provider';
import { ReportProcessor } from '../../src/reports/report.processor';

const prisma = new PrismaClient();
const email = 'workspace-report-worker@example.test';
const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-18',
  timezone: 'UTC',
  facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  repositories: [],
};
let pdf: Buffer;

class RetryOnceStorage implements ArtifactStorage {
  readonly objects = new Map<string, Buffer>();
  private failed = false;

  put(key: string, bytes: Buffer): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new Error('transient storage outage'));
    }
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }

  getOptional(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  get(key: string): Promise<Buffer> {
    const value = this.objects.get(key);
    if (value === undefined) return Promise.reject(new Error('not found'));
    return Promise.resolve(value);
  }
}

async function clean(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
  await prisma.workspace.deleteMany({ where: { createdById: { in: users.map(({ id }) => id) } } });
  await prisma.user.deleteMany({ where: { email } });
}

async function createWorkspaceReport(): Promise<{ reportId: string; occurrenceId: string }> {
  const user = await prisma.user.create({ data: { username: `workspace-report-${Date.now()}`, email, passwordHash: 'unused' } });
  const workspace = await prisma.workspace.create({ data: {
    name: 'Worker report lifecycle', slug: `worker-report-${Date.now()}`, createdById: user.id,
    memberships: { create: { userId: user.id, role: 'MANAGER' } },
  } });
  const report = await prisma.report.create({ data: {
    userId: user.id, workspaceId: workspace.id, reportDate: new Date('2026-08-18T00:00:00.000Z'), timezone: 'UTC', inputSnapshot: snapshot,
  } });
  const occurrence = await prisma.workspaceReportOccurrence.create({ data: {
    workspaceId: workspace.id, trigger: 'MANUAL', windowStart: new Date('2026-08-17T00:00:00.000Z'),
    windowEnd: new Date('2026-08-18T00:00:00.000Z'), dataCutoffAt: new Date('2026-08-18T00:00:00.000Z'),
    requestedById: user.id, reportId: report.id, idempotencyKey: `worker-${Date.now()}`,
    evidenceSnapshot: { version: 1, repositories: [], noActivity: true }, noActivity: true,
  } });
  return { reportId: report.id, occurrenceId: occurrence.id };
}

describe('workspace report worker lifecycle', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const document = await PDFDocument.create();
    document.addPage([300, 200]);
    pdf = Buffer.from(await document.save({ useObjectStreams: false }));
  });
  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('completes an honest zero-activity workspace report and synchronizes retries and duplicate delivery', async () => {
    const { reportId, occurrenceId } = await createWorkspaceReport();
    const storage = new RetryOnceStorage();
    const compiler: LatexCompiler = { compile: () => Promise.resolve(pdf) };
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler,
      storage,
    );

    await expect(processor.process(reportId)).rejects.toThrow('REPORT_RENDER_RETRY');
    expect(await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } })).toMatchObject({
      status: 'PROCESSING', completedAt: null, error: null, noActivity: true,
    });

    await processor.process(reportId);
    const completed = await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } });
    expect(completed).toMatchObject({ status: 'COMPLETED', error: null, noActivity: true });
    expect(completed.startedAt).toBeInstanceOf(Date);
    expect(completed.completedAt).toBeInstanceOf(Date);

    await processor.process(reportId);
    expect(await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } })).toEqual(completed);
  });

  it('copies a terminal safe generation failure to the occurrence', async () => {
    const { reportId, occurrenceId } = await createWorkspaceReport();
    const processor = new ReportProcessor(prisma, { generate: () => Promise.reject(new Error('provider secret')) });

    await expect(processor.process(reportId, { attempt: 1, maximumAttempts: 2, finalDelivery: false }))
      .rejects.toThrow('REPORT_PROCESSING_RETRY');
    expect(await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } })).toMatchObject({
      status: 'PENDING', completedAt: null, error: null,
    });

    await processor.process(reportId, { attempt: 2, maximumAttempts: 2, finalDelivery: true });

    const failed = await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } });
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('Report generation failed.');
    expect(failed.completedAt).toBeInstanceOf(Date);

    await processor.process(reportId, { attempt: 2, maximumAttempts: 2, finalDelivery: true });
    expect(await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } })).toEqual(failed);
  });
});
