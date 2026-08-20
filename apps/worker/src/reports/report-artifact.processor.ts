import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@trace/database';
import type { ArtifactStorage } from '@trace/report-storage';
import { reportContentSchema } from '@trace/shared';
import { MAX_LATEX_BYTES, MAX_PDF_BYTES, validateCompiledPdf, type LatexCompiler } from '../latex/latex-compiler';
import { renderReportLatex } from '../latex/report-latex-renderer';
import { DIRECT_REPORT_DELIVERY, type ReportDeliveryContext } from './report-delivery';
import type { ReportCompletionNotifier } from './report-slack-notifier';
import {
  markWorkspaceReportCompleted,
  markWorkspaceReportFailed,
  markWorkspaceReportProcessing,
} from './workspace-report-lifecycle';

const RENDER_FAILED = 'Report rendering failed.';
const RENDER_RETRY = 'REPORT_RENDER_RETRY';
const DEFAULT_STORAGE_WRITE_TIMEOUT_MS = 30_000;
const NOOP_COMPLETION_NOTIFIER: ReportCompletionNotifier = { notify: () => Promise.resolve('delivered') };

interface CompletionClaim {
  reportId: string;
  revisionId: string;
  reportDate: Date;
  content: Prisma.JsonValue;
  workspaceId: string | null;
  workspaceName: string | null;
}

export interface ReportGenerationProcessor { process(reportId: string, delivery?: ReportDeliveryContext): Promise<void> }

export class ReportArtifactProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly generation: ReportGenerationProcessor,
    private readonly compiler: LatexCompiler,
    private readonly storage: ArtifactStorage,
    private readonly leaseDurationMs = 180_000,
    private readonly storageWriteTimeoutMs = DEFAULT_STORAGE_WRITE_TIMEOUT_MS,
    private readonly completionNotifier: ReportCompletionNotifier = NOOP_COMPLETION_NOTIFIER,
  ) {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 30_000 || leaseDurationMs > 600_000) {
      throw new Error('REPORT_RENDER_CONFIG');
    }
    if (!Number.isInteger(storageWriteTimeoutMs) || storageWriteTimeoutMs < 1 || storageWriteTimeoutMs >= leaseDurationMs) {
      throw new Error('REPORT_RENDER_CONFIG');
    }
  }

  async process(reportId: string, delivery: ReportDeliveryContext = DIRECT_REPORT_DELIVERY): Promise<void> {
    await this.generation.process(reportId, delivery);
    const token = randomUUID();
    const claim = await this.claim(reportId, token);
    if (claim.kind === 'done') return;
    if (claim.kind === 'completed') {
      await this.notifyCompletion({ ...claim, reportId });
      return;
    }
    if (claim.kind === 'busy') throw new Error(RENDER_RETRY);

    const generationBaseKey = `users/${claim.userId}/reports/${reportId}/revisions/${claim.revision}/generations/${claim.generation}/attempts/${token}`;
    const stagedLatexKey = `${generationBaseKey}/report.tex`;
    const stagedPdfKey = `${generationBaseKey}/report.pdf`;
    let storedLatex: Buffer | null;
    let storedPdf: Buffer | null;
    try {
      [storedLatex, storedPdf] = await Promise.all([
        claim.artifactKeys.latex === null
          ? Promise.resolve(null)
          : this.storage.getOptional(claim.artifactKeys.latex, MAX_LATEX_BYTES),
        claim.artifactKeys.pdf === null
          ? Promise.resolve(null)
          : this.storage.getOptional(claim.artifactKeys.pdf, MAX_PDF_BYTES),
      ]);
      if (storedPdf !== null && storedLatex === null && claim.latexSource === null) throw new Error(RENDER_RETRY);
    } catch {
      await this.release(reportId, token, claim).catch(() => undefined);
      throw new Error(RENDER_RETRY);
    }

    let latex: string;
    let latexBytes: Buffer;
    try {
      if (claim.latexSource !== null) {
        latex = claim.latexSource;
        latexBytes = Buffer.from(latex, 'utf8');
        if (storedLatex !== null && !storedLatex.equals(latexBytes)) throw new Error(RENDER_RETRY);
      } else if (storedLatex !== null) {
        latex = new TextDecoder('utf-8', { fatal: true }).decode(storedLatex);
        latexBytes = Buffer.from(latex, 'utf8');
        if (!latexBytes.equals(storedLatex)) throw new Error(RENDER_RETRY);
      } else {
        latex = renderReportLatex(claim.inputSnapshot, reportContentSchema.parse(claim.content), claim.revision);
        latexBytes = Buffer.from(latex, 'utf8');
      }
      if (latexBytes.length < 1 || latexBytes.length > MAX_LATEX_BYTES) throw new Error(RENDER_FAILED);
      await this.freezeLatexSource(reportId, token, claim, latex);
    } catch (error) {
      if (error instanceof Error && error.message === RENDER_RETRY) {
        await this.release(reportId, token, claim).catch(() => undefined);
        throw error;
      }
      await this.fail(reportId, token, claim.revisionId, claim.revision, claim.generation);
      return;
    }

    let pdf: Buffer;
    try {
      pdf = storedPdf === null ? await this.compiler.compile(latex) : await validateCompiledPdf(storedPdf);
    } catch {
      await this.fail(reportId, token, claim.revisionId, claim.revision, claim.generation);
      return;
    }

    try {
      await this.persist(reportId, token, claim, latexBytes, pdf, {
        latex: storedLatex === null ? stagedLatexKey : claim.artifactKeys.latex ?? stagedLatexKey,
        pdf: storedPdf === null ? stagedPdfKey : claim.artifactKeys.pdf ?? stagedPdfKey,
      });
      await this.notifyCompletion({ ...claim, reportId });
    } catch {
      await this.release(reportId, token, claim).catch(() => undefined);
      throw new Error(RENDER_RETRY);
    }
  }

  private async notifyCompletion(claim: CompletionClaim): Promise<void> {
    const content = reportContentSchema.safeParse(claim.content);
    if (!content.success) return;
    const outcome = await this.completionNotifier.notify({
      reportId: claim.reportId,
      revisionId: claim.revisionId,
      reportDate: claim.reportDate.toISOString().slice(0, 10),
      executiveSummary: content.data.executiveSummary,
      workspaceId: claim.workspaceId,
      workspaceName: claim.workspaceName,
    }).catch(() => 'retry' as const);
    if (outcome === 'retry') throw new Error(RENDER_RETRY);
  }

  private async claim(reportId: string, token: string): Promise<
    | { kind: 'done' }
    | ({ kind: 'completed' } & Omit<CompletionClaim, 'reportId'>)
    | { kind: 'busy' }
    | { kind: 'claimed'; userId: string; workspaceId: string | null; workspaceName: string | null; reportDate: Date; revisionId: string; revision: number; generation: number; content: Prisma.JsonValue; inputSnapshot: Prisma.JsonValue; latexSource: string | null; artifactKeys: { latex: string | null; pdf: string | null } }
  > {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      const report = await transaction.report.findUnique({
        where: { id: reportId },
        select: {
          userId: true,
          workspaceId: true,
          reportDate: true,
          workspace: { select: { name: true } },
          status: true,
          inputSnapshot: true,
          processingToken: true,
          processingExpiresAt: true,
          renderRevision: true,
          renderGeneration: true,
          currentRevision: { include: { artifacts: { select: { kind: true, storageKey: true } } } },
        },
      });
      const revision = report?.currentRevision;
      if (report === null || revision === null || revision === undefined) return { kind: 'done' } as const;
      if (report.status === 'completed' && revision.artifacts.some(({ kind }) => kind === 'pdf')) {
        return {
          kind: 'completed',
          revisionId: revision.id,
          reportDate: report.reportDate,
          content: revision.content,
          workspaceId: report.workspaceId,
          workspaceName: report.workspace?.name ?? null,
        } as const;
      }
      if (report.status !== 'processing') return { kind: 'done' } as const;
      const busy = await transaction.$queryRaw<Array<{ busy: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM "reports"
          WHERE "id" = ${reportId}
            AND "processing_token" IS NOT NULL
            AND "processing_expires_at" > clock_timestamp()
        ) AS "busy"
      `;
      if (busy[0]?.busy === true) return { kind: 'busy' } as const;
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'processing',
            "processing_token" = ${token},
            "processing_expires_at" = clock_timestamp() + (${this.leaseDurationMs} * interval '1 millisecond'),
            "completed_at" = NULL,
            "error" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "current_revision_id" = ${revision.id}
          AND "render_revision" = ${revision.revision}
          AND "render_generation" = ${report.renderGeneration}
      `;
      if (updated !== 1) return { kind: 'busy' } as const;
      await markWorkspaceReportProcessing(transaction, reportId);
      return {
        kind: 'claimed',
        userId: report.userId,
        workspaceId: report.workspaceId,
        workspaceName: report.workspace?.name ?? null,
        reportDate: report.reportDate,
        revisionId: revision.id,
        revision: revision.revision,
        generation: report.renderGeneration,
        content: revision.content,
        inputSnapshot: report.inputSnapshot,
        latexSource: revision.latexSource,
        artifactKeys: {
          latex: revision.artifacts.find(({ kind }) => kind === 'latex')?.storageKey ?? null,
          pdf: revision.artifacts.find(({ kind }) => kind === 'pdf')?.storageKey ?? null,
        },
      } as const;
    });
  }

  private async freezeLatexSource(
    reportId: string,
    token: string,
    claim: { revisionId: string; revision: number; generation: number },
    latexSource: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      await transaction.$executeRaw`
        UPDATE "report_revisions" rr
        SET "latex_source" = ${latexSource}
        WHERE rr."id" = ${claim.revisionId}
          AND rr."latex_source" IS NULL
          AND EXISTS (
            SELECT 1 FROM "reports" r
            WHERE r."id" = ${reportId}
              AND r."status" = 'processing'
              AND r."processing_token" = ${token}
              AND r."processing_expires_at" > clock_timestamp()
              AND r."current_revision_id" = ${claim.revisionId}
              AND r."render_revision" = ${claim.revision}
              AND r."render_generation" = ${claim.generation}
          )
      `;
      const frozen = await transaction.reportRevision.findUnique({
        where: { id: claim.revisionId },
        select: { latexSource: true },
      });
      if (frozen?.latexSource !== latexSource) throw new Error(RENDER_RETRY);
    });
  }

  private async persist(
    reportId: string,
    token: string,
    claim: { userId: string; revisionId: string; revision: number; generation: number },
    latex: Buffer,
    pdf: Buffer,
    keys: { latex: string; pdf: string },
  ): Promise<void> {
    const artifacts = [
      { kind: 'latex' as const, bytes: latex, key: keys.latex },
      { kind: 'pdf' as const, bytes: pdf, key: keys.pdf },
    ];
    const storageController = new AbortController();
    const storageTimer = setTimeout(() => storageController.abort(), this.storageWriteTimeoutMs);
    storageTimer.unref();
    let writeFailure: unknown;
    const writes = artifacts.map(async (artifact) => {
      try {
        await this.storage.put(artifact.key, artifact.bytes, storageController.signal);
      } catch (error) {
        writeFailure ??= error;
        storageController.abort();
        throw error;
      }
    });
    try {
      const outcomes = await Promise.allSettled(writes);
      const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      if (rejected !== undefined) throw writeFailure ?? rejected.reason;
    } finally {
      clearTimeout(storageTimer);
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      const renewed = await transaction.$executeRaw`
        UPDATE "reports"
        SET "processing_expires_at" = clock_timestamp() + (${this.leaseDurationMs} * interval '1 millisecond')
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
          AND "current_revision_id" = ${claim.revisionId}
          AND "render_revision" = ${claim.revision}
          AND "render_generation" = ${claim.generation}
      `;
      if (renewed !== 1) throw new Error(RENDER_RETRY);
      for (const artifact of artifacts) {
        const metadata = {
          storageKey: artifact.key,
          sizeBytes: artifact.bytes.length,
          checksum: createHash('sha256').update(artifact.bytes).digest('hex'),
        };
        const existing = await transaction.reportArtifact.findUnique({
          where: { reportId_revisionId_kind: { reportId, revisionId: claim.revisionId, kind: artifact.kind } },
          select: { storageKey: true, sizeBytes: true, checksum: true },
        });
        if (existing === null) {
          await transaction.reportArtifact.create({
            data: {
              reportId,
              revisionId: claim.revisionId,
              kind: artifact.kind,
              ...metadata,
            },
          });
        } else if (
          existing.storageKey !== metadata.storageKey
          || existing.sizeBytes !== metadata.sizeBytes
          || existing.checksum !== metadata.checksum
        ) {
          throw new Error(RENDER_RETRY);
        }
      }
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'completed',
            "latex_path" = ${keys.latex},
            "pdf_path" = ${keys.pdf},
            "completed_at" = clock_timestamp(),
            "error" = NULL,
            "processing_token" = NULL,
            "processing_expires_at" = NULL,
            "render_revision" = NULL,
            "render_published_at" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
          AND "current_revision_id" = ${claim.revisionId}
          AND "render_revision" = ${claim.revision}
          AND "render_generation" = ${claim.generation}
      `;
      if (updated !== 1) throw new Error(RENDER_RETRY);
      await markWorkspaceReportCompleted(transaction, reportId);
    });
  }

  private async fail(
    reportId: string,
    token: string,
    revisionId: string,
    revision: number,
    generation: number,
  ): Promise<void> {
    await this.withLock(reportId, async (transaction) => {
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'failed', "error" = ${RENDER_FAILED}, "completed_at" = NULL,
            "processing_token" = NULL, "processing_expires_at" = NULL,
            "render_published_at" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
          AND "current_revision_id" = ${revisionId}
          AND "render_revision" = ${revision}
          AND "render_generation" = ${generation}
      `;
      if (updated !== 1) throw new Error(RENDER_RETRY);
      await markWorkspaceReportFailed(transaction, reportId);
    });
  }

  private async release(
    reportId: string,
    token: string,
    claim: { revisionId: string; revision: number; generation: number },
  ): Promise<void> {
    await this.withLock(reportId, async (transaction) => {
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "processing_token" = NULL, "processing_expires_at" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
          AND "current_revision_id" = ${claim.revisionId}
          AND "render_revision" = ${claim.revision}
          AND "render_generation" = ${claim.generation}
      `;
      if (updated !== 1) throw new Error(RENDER_RETRY);
    });
  }

  private async withLock(reportId: string, operation: (transaction: Prisma.TransactionClient) => Promise<void>): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      await operation(transaction);
    });
  }
}
