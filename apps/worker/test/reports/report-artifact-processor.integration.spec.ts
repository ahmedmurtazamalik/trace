import { Buffer } from 'node:buffer';
import { PrismaClient } from '@trace/database';
import type { ArtifactStorage } from '@trace/report-storage';
import { PDFDocument } from 'pdf-lib';
import type { LatexCompiler } from '../../src/latex/latex-compiler';
import { ReportArtifactProcessor } from '../../src/reports/report-artifact.processor';
import { DeterministicReportProvider, type ReportInputSnapshot } from '../../src/reports/report-provider';
import { ReportProcessor } from '../../src/reports/report.processor';

const prisma = new PrismaClient();
const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-13',
  timezone: 'UTC',
  facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  repositories: [],
};
let pdf: Buffer;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 200]);
  pdf = Buffer.from(await document.save({ useObjectStreams: false }));
});

class MemoryStorage implements ArtifactStorage {
  readonly objects = new Map<string, Buffer>();
  failNextPut = false;

  put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('storage unavailable with secret details');
    }
    const existing = this.objects.get(key);
    if (existing !== undefined && !existing.equals(bytes)) throw new Error('immutable conflict');
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }

  getOptional(key: string, maximumBytes: number): Promise<Buffer | null> {
    const value = this.objects.get(key);
    if (value === undefined) return Promise.resolve(null);
    if (value.length > maximumBytes) throw new Error('oversized');
    return Promise.resolve(Buffer.from(value));
  }

  get(key: string, maximumBytes: number): Promise<Buffer> {
    const value = this.objects.get(key);
    if (value === undefined || value.length > maximumBytes) throw new Error('not found');
    return Promise.resolve(Buffer.from(value));
  }
}

class BlockingPutStorage extends MemoryStorage {
  private releasePut = (): void => undefined;
  private markStarted = (): void => undefined;
  readonly putStarted = new Promise<void>((resolve) => { this.markStarted = resolve; });
  private readonly putReleased = new Promise<void>((resolve) => { this.releasePut = resolve; });

  override async put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    this.markStarted();
    let rejectAbort: (reason?: unknown) => void;
    const aborted = new Promise<void>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = (): void => rejectAbort(signal?.reason ?? new Error('aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await Promise.race([this.putReleased, aborted]);
      await super.put(key, bytes, signal);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  release(): void {
    this.releasePut();
  }
}

class MixedFailureStorage extends MemoryStorage {
  siblingAborted = false;

  override put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    void bytes;
    if (key.endsWith('/report.tex')) return Promise.reject(new Error('fast storage failure'));
    return new Promise<void>((_resolve, reject) => {
      const abort = (): void => {
        this.siblingAborted = true;
        reject(new Error('aborted'));
      };
      if (signal?.aborted === true) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

function compiler(implementation: (source: string) => Promise<Buffer> = () => Promise.resolve(pdf)): LatexCompiler {
  return { compile: jest.fn(implementation) };
}

describe('report artifact processor', () => {
  const email = 'day10-worker@example.test';
  let reportId: string;
  let userId: string;

  async function clean(): Promise<void> {
    const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    await prisma.report.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { email } });
  }

  beforeAll(async () => prisma.$connect());
  beforeEach(async () => {
    await clean();
    const user = await prisma.user.create({
      data: { username: `day10-${Date.now()}`, email, passwordHash: 'unused' },
    });
    userId = user.id;
    reportId = (await prisma.report.create({
      data: { userId: user.id, reportDate: new Date('2026-08-13T00:00:00.000Z'), timezone: 'UTC', inputSnapshot: snapshot },
    })).id;
  });
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('stores immutable artifacts and completes only after persistence and an atomic fenced finalization', async () => {
    const storage = new MemoryStorage();
    const generate = new ReportProcessor(prisma, new DeterministicReportProvider());
    const processor = new ReportArtifactProcessor(prisma, generate, compiler(), storage);

    await processor.process(reportId);
    await processor.process(reportId);

    const report = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: { currentRevision: true, artifacts: { orderBy: { kind: 'asc' } } },
    });
    expect(report).toMatchObject({
      status: 'completed', error: null,
      renderRevision: null, renderPublishedAt: null, processingToken: null,
    });
    expect(report.latexPath).toMatch(new RegExp(`^users/${userId}/reports/${reportId}/revisions/1/generations/1/attempts/[a-f0-9-]+/report\\.tex$`));
    expect(report.pdfPath).toMatch(new RegExp(`^users/${userId}/reports/${reportId}/revisions/1/generations/1/attempts/[a-f0-9-]+/report\\.pdf$`));
    expect(report.completedAt).toBeInstanceOf(Date);
    expect(report.currentRevision).toMatchObject({ revision: 1, source: 'ai' });
    expect(report.artifacts).toHaveLength(2);
    expect(new Set(report.artifacts.map((artifact) => artifact.revisionId))).toEqual(new Set([report.currentRevision?.id]));
    expect(storage.objects.size).toBe(2);
  });

  it('fails closed instead of rewriting mismatched existing artifact metadata', async () => {
    const storage = new MemoryStorage();
    const generate = new ReportProcessor(prisma, new DeterministicReportProvider());
    await generate.process(reportId);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { currentRevision: true } });
    const revisionId = report.currentRevision?.id;
    if (revisionId === undefined) throw new Error('missing generated revision');
    const original = await prisma.reportArtifact.create({ data: {
      reportId,
      revisionId,
      kind: 'latex',
      storageKey: `users/${userId}/reports/${reportId}/immutable-existing.tex`,
      sizeBytes: 1,
      checksum: '0'.repeat(64),
    } });
    const processor = new ReportArtifactProcessor(prisma, generate, compiler(), storage);

    await expect(processor.process(reportId)).rejects.toThrow('REPORT_RENDER_RETRY');

    expect(await prisma.reportArtifact.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
      storageKey: original.storageKey,
      sizeBytes: original.sizeBytes,
      checksum: original.checksum,
    });
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'processing', renderRevision: 1,
    });
  });

  it('keeps database transactions and the report advisory lock free while storage is stalled', async () => {
    const storage = new BlockingPutStorage();
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(),
      storage,
    );
    const processing = processor.process(reportId);
    await storage.putStarted;
    const contender = new PrismaClient();
    let acquired = false;
    try {
      acquired = await contender.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${reportId}, 0)) AS "acquired"
        `;
        return rows[0]?.acquired === true;
      });
    } finally {
      storage.release();
      await processing;
      await contender.$disconnect();
    }

    expect(acquired).toBe(true);
    expect([...storage.objects.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/generations\/1\/attempts\/[a-f0-9-]+\/report\.tex$/),
      expect.stringMatching(/\/generations\/1\/attempts\/[a-f0-9-]+\/report\.pdf$/),
    ]));
  });

  it('aborts a stalled storage write before its lease and leaves a retryable obligation', async () => {
    const storage = new BlockingPutStorage();
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(),
      storage,
      30_000,
      50,
    );
    const startedAt = Date.now();

    await expect(processor.process(reportId)).rejects.toThrow('REPORT_RENDER_RETRY');

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(report).toMatchObject({ status: 'processing', processingToken: null });
    await expect(prisma.reportArtifact.count({ where: { reportId } })).resolves.toBe(0);
  });

  it('aborts and settles a hanging sibling when another artifact write fails quickly', async () => {
    const storage = new MixedFailureStorage();
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(),
      storage,
    );

    await expect(processor.process(reportId)).rejects.toThrow('REPORT_RENDER_RETRY');

    expect(storage.siblingAborted).toBe(true);
    await expect(prisma.report.findUniqueOrThrow({ where: { id: reportId } })).resolves.toMatchObject({
      status: 'processing', processingToken: null, processingExpiresAt: null,
    });
    await expect(prisma.reportArtifact.count({ where: { reportId } })).resolves.toBe(0);
  });

  it('reuses frozen source and artifacts across same-revision deployment regeneration', async () => {
    const storage = new MemoryStorage();
    const compileMock = jest.fn(() => Promise.resolve(pdf));
    const latexCompiler: LatexCompiler = { compile: compileMock };
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      latexCompiler,
      storage,
    );
    await processor.process(reportId);
    const frozen = await prisma.reportRevision.findFirstOrThrow({ where: { reportId } });
    expect(frozen.latexSource).toContain('Engineering Activity Report');
    const originalObjects = new Map([...storage.objects].map(([key, value]) => [key, Buffer.from(value)]));
    const originalArtifacts = await prisma.reportArtifact.findMany({
      where: { reportId },
      orderBy: { kind: 'asc' },
      select: { id: true, kind: true, storageKey: true, sizeBytes: true, checksum: true },
    });
    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'processing',
        completedAt: null,
        renderRevision: 1,
        renderGeneration: { increment: 1 },
        renderPublishedAt: null,
      },
    });

    await processor.process(reportId);

    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'completed', renderRevision: null,
    });
    expect(await prisma.reportArtifact.findMany({
      where: { reportId },
      orderBy: { kind: 'asc' },
      select: { id: true, kind: true, storageKey: true, sizeBytes: true, checksum: true },
    })).toEqual(originalArtifacts);
    expect(storage.objects).toEqual(originalObjects);
    expect(compileMock).toHaveBeenCalledTimes(1);
  });

  it('leaves a truthful processing obligation after transient storage failure and retries idempotently', async () => {
    const storage = new MemoryStorage();
    storage.failNextPut = true;
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(),
      storage,
    );

    await expect(processor.process(reportId)).rejects.toThrow('REPORT_RENDER_RETRY');
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'processing', completedAt: null, renderRevision: 1, processingToken: null,
    });
    expect(await prisma.reportArtifact.count({ where: { reportId } })).toBe(0);

    await processor.process(reportId);
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'completed', renderRevision: null,
    });
    expect(await prisma.reportArtifact.count({ where: { reportId } })).toBe(2);
  });

  it('rejects stale compiled output after the authoritative revision and generation advance', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const delayedCompiler = compiler(async () => { await wait; return pdf; });
    const storage = new MemoryStorage();
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      delayedCompiler,
      storage,
    );
    const processing = processor.process(reportId);
    await new Promise((resolve) => setTimeout(resolve, 75));

    await prisma.$transaction(async (transaction) => {
      const report = await transaction.report.findUniqueOrThrow({ where: { id: reportId }, include: { currentRevision: true } });
      const next = await transaction.reportRevision.create({
        data: { reportId, revision: 2, source: 'manual', content: report.currentRevision?.content ?? {} },
      });
      await transaction.report.update({
        where: { id: reportId },
        data: {
          currentRevisionId: next.id,
          renderRevision: 2,
          renderGeneration: { increment: 1 },
          processingToken: null,
          processingExpiresAt: null,
        },
      });
    });
    release?.();
    await expect(processing).rejects.toThrow('REPORT_RENDER_RETRY');

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { currentRevision: true } });
    expect(report).toMatchObject({ status: 'processing', renderRevision: 2 });
    expect(report.currentRevision?.revision).toBe(2);
    expect(await prisma.reportArtifact.count({ where: { reportId } })).toBe(0);
    expect([...storage.objects.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/revisions\/1\/generations\/1\/attempts\/[a-f0-9-]+\/report\.tex$/),
      expect.stringMatching(/\/revisions\/1\/generations\/1\/attempts\/[a-f0-9-]+\/report\.pdf$/),
    ]));
    expect(report.latexPath).toBeNull();
    expect(report.pdfPath).toBeNull();
  });

  it('isolates stale same-generation attempt objects from a replacement lease holder', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let markCompilerStarted: (() => void) | undefined;
    const compilerStarted = new Promise<void>((resolve) => { markCompilerStarted = resolve; });
    const storage = new MemoryStorage();
    const stale = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(async () => {
        markCompilerStarted?.();
        await wait;
        return pdf;
      }),
      storage,
    );
    const staleProcessing = stale.process(reportId);
    await compilerStarted;
    await prisma.report.update({
      where: { id: reportId },
      data: { processingToken: null, processingExpiresAt: null },
    });
    release?.();
    await expect(staleProcessing).rejects.toThrow('REPORT_RENDER_RETRY');

    const replacementDocument = await PDFDocument.create();
    replacementDocument.addPage([400, 250]);
    const replacementPdf = Buffer.from(await replacementDocument.save({ useObjectStreams: false }));
    await new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(() => Promise.resolve(replacementPdf)),
      storage,
    ).process(reportId);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { artifacts: true } });
    expect(report).toMatchObject({ status: 'completed', renderRevision: null, processingToken: null });
    expect(report.artifacts).toHaveLength(2);
    expect(storage.objects.size).toBe(4);
    expect(report.artifacts.every(({ storageKey }) => storageKey.includes('/attempts/'))).toBe(true);
  });

  it('rejects finalization when only the render-revision obligation changes', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(async () => { await wait; return pdf; }),
      new MemoryStorage(),
    );
    const processing = processor.process(reportId);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await prisma.report.update({ where: { id: reportId }, data: { renderRevision: 99 } });
    release?.();

    await expect(processing).rejects.toThrow('REPORT_RENDER_RETRY');
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'processing', renderRevision: 99,
    });
    expect(await prisma.reportArtifact.count({ where: { reportId } })).toBe(0);
  });

  it('enforces artifact ownership, checksum, size, and per-revision-kind uniqueness in PostgreSQL', async () => {
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(),
      new MemoryStorage(),
    );
    await processor.process(reportId);
    const report = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: { currentRevision: true, artifacts: true },
    });
    const revisionId = report.currentRevision?.id;
    expect(revisionId).toBeDefined();
    const integrityRevision = await prisma.reportRevision.create({
      data: {
        reportId,
        revision: 2,
        source: 'manual',
        content: report.currentRevision?.content ?? {},
      },
    });
    await expect(prisma.reportArtifact.create({
      data: {
        reportId, revisionId: revisionId!, kind: 'pdf', storageKey: `reports/${reportId}/revisions/1/duplicate.pdf`,
        sizeBytes: 1, checksum: 'a'.repeat(64),
      },
    })).rejects.toThrow();
    await expect(prisma.reportArtifact.create({
      data: {
        reportId, revisionId: integrityRevision.id, kind: 'pdf', storageKey: `reports/${reportId}/revisions/2/invalid-size.pdf`,
        sizeBytes: 0, checksum: 'a'.repeat(64),
      },
    })).rejects.toThrow();
    await expect(prisma.reportArtifact.create({
      data: {
        reportId, revisionId: integrityRevision.id, kind: 'latex', storageKey: `reports/${reportId}/revisions/2/invalid-checksum.tex`,
        sizeBytes: 1, checksum: 'INVALID',
      },
    })).rejects.toThrow();
  });

  it('retries instead of consuming the job when compiler failure occurs after lease expiry', async () => {
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(async () => {
        await prisma.report.update({ where: { id: reportId }, data: { processingExpiresAt: new Date(0) } });
        throw new Error('compile timeout');
      }),
      new MemoryStorage(),
    );

    await expect(processor.process(reportId)).rejects.toThrow('REPORT_RENDER_RETRY');
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'processing', completedAt: null, renderRevision: 1,
    });
  });

  it('records a terminal render error that redelivery cannot revive without a new generation', async () => {
    const storage = new MemoryStorage();
    const processor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      compiler(() => Promise.reject(new Error('compiler leaked /tmp/path and secret'))),
      storage,
    );
    await processor.process(reportId);
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'failed', completedAt: null, error: 'Report rendering failed.', renderRevision: 1,
      processingToken: null, latexPath: null, pdfPath: null,
    });
    expect(await prisma.reportArtifact.count({ where: { reportId } })).toBe(0);

    const compileAfterRedelivery = jest.fn(() => Promise.resolve(pdf));
    const succeedingProcessor = new ReportArtifactProcessor(
      prisma,
      new ReportProcessor(prisma, new DeterministicReportProvider()),
      { compile: compileAfterRedelivery },
      storage,
    );
    await succeedingProcessor.process(reportId);
    expect(compileAfterRedelivery).not.toHaveBeenCalled();
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'failed', renderRevision: 1, renderGeneration: 1,
    });

    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'processing', error: null, renderGeneration: { increment: 1 }, renderPublishedAt: null,
      },
    });
    await succeedingProcessor.process(reportId);
    expect(compileAfterRedelivery).toHaveBeenCalledTimes(1);
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: 'completed', renderRevision: null, renderGeneration: 2,
    });
  });
});
