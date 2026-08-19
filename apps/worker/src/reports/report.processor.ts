import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@trace/database';
import {
  reportInputSnapshotSchema,
  validateGroundedReportContent,
  type ReportContent,
  type StructuredReportProvider,
} from './report-provider';
import {
  markWorkspaceReportFailed,
  markWorkspaceReportPending,
  markWorkspaceReportProcessing,
} from './workspace-report-lifecycle';
import { DIRECT_REPORT_DELIVERY, type ReportDeliveryContext } from './report-delivery';

export interface ReportProcessorOptions {
  maximumAttempts?: number;
  leaseDurationMs?: number;
}

const SAFE_FAILURE = 'Report generation failed.';
const RETRYABLE_PROCESSING_ERROR = 'REPORT_PROCESSING_RETRY';

export class ReportProcessor {
  private readonly leaseDurationMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: StructuredReportProvider,
    options: ReportProcessorOptions = {},
  ) {
    const configuredAttempts = options.maximumAttempts ?? 3;
    this.leaseDurationMs = options.leaseDurationMs ?? 180_000;
    if (!Number.isInteger(configuredAttempts) || configuredAttempts < 1 || configuredAttempts > 5) {
      throw new Error('Report provider attempts must be between 1 and 5.');
    }
    if (!Number.isInteger(this.leaseDurationMs) || this.leaseDurationMs < 30_000 || this.leaseDurationMs > 600_000) {
      throw new Error('Report processing lease must be between 30 and 600 seconds.');
    }
  }

  async process(reportId: string, delivery: ReportDeliveryContext = DIRECT_REPORT_DELIVERY): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(reportId)) return;
    const token = randomUUID();
    let claim: Awaited<ReturnType<ReportProcessor['claim']>>;
    try {
      claim = await this.claim(reportId, token);
    } catch {
      throw new Error(RETRYABLE_PROCESSING_ERROR);
    }
    if (claim.kind === 'done') return;
    if (claim.kind === 'busy') throw new Error(RETRYABLE_PROCESSING_ERROR);

    try {
      const parsedSnapshot = reportInputSnapshotSchema.safeParse(claim.inputSnapshot);
      if (!parsedSnapshot.success) {
        return this.finishGenerationFailure(reportId, token, delivery, false);
      }

      let content: ReportContent;
      try {
        content = validateGroundedReportContent(await this.provider.generate(parsedSnapshot.data), parsedSnapshot.data);
      } catch (error) {
        return this.finishGenerationFailure(reportId, token, delivery, permanentFailure(error));
      }
      await this.persistClaim(reportId, token, content);
    } catch {
      await this.releaseClaim(reportId, token).catch(() => undefined);
      throw new Error(RETRYABLE_PROCESSING_ERROR);
    }
  }

  private async finishGenerationFailure(
    reportId: string,
    token: string,
    delivery: ReportDeliveryContext,
    permanent: boolean,
  ): Promise<void> {
    if (permanent || delivery.finalDelivery) {
      await this.failClaim(reportId, token);
      return;
    }
    await this.releaseClaim(reportId, token);
    throw new Error(RETRYABLE_PROCESSING_ERROR);
  }

  private async claim(reportId: string, token: string): Promise<
    { kind: 'claimed'; inputSnapshot: Prisma.JsonValue } | { kind: 'busy' } | { kind: 'done' }
  > {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      const report = await transaction.report.findUnique({
        where: { id: reportId },
        select: { status: true, inputSnapshot: true, revisions: { select: { id: true }, take: 1 } },
      });
      if (report === null || report.revisions.length > 0 || report.status === 'completed' || report.status === 'failed') return { kind: 'done' };
      const busy = await transaction.$queryRaw<Array<{ busy: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM "reports"
          WHERE "id" = ${reportId}
            AND "processing_token" IS NOT NULL
            AND "processing_expires_at" > clock_timestamp()
        ) AS "busy"
      `;
      if (busy[0]?.busy === true) return { kind: 'busy' };
      const claimed = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'processing',
            "processing_token" = ${token},
            "processing_expires_at" = clock_timestamp() + (${this.leaseDurationMs} * interval '1 millisecond'),
            "error" = NULL,
            "completed_at" = NULL
        WHERE "id" = ${reportId}
          AND "status" IN ('pending', 'processing')
          AND NOT EXISTS (SELECT 1 FROM "report_revisions" WHERE "report_id" = ${reportId})
      `;
      if (claimed !== 1) return { kind: 'done' };
      await markWorkspaceReportProcessing(transaction, reportId);
      return { kind: 'claimed', inputSnapshot: report.inputSnapshot };
    });
  }

  private async failClaim(reportId: string, token: string): Promise<void> {
    await this.withReportLock(reportId, async (transaction) => {
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'failed',
            "error" = ${SAFE_FAILURE},
            "completed_at" = NULL,
            "ai_output" = NULL,
            "processing_token" = NULL,
            "processing_expires_at" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM "report_revisions" WHERE "report_id" = ${reportId})
      `;
      if (updated !== 1) throw new Error(RETRYABLE_PROCESSING_ERROR);
      await markWorkspaceReportFailed(transaction, reportId);
    });
  }

  private async persistClaim(reportId: string, token: string, content: ReportContent): Promise<void> {
    await this.withReportLock(reportId, async (transaction) => {
      const owner = await transaction.$queryRaw<Array<{ owned: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM "reports"
          WHERE "id" = ${reportId}
            AND "processing_token" = ${token}
            AND "processing_expires_at" > clock_timestamp()
            AND "status" = 'processing'
            AND NOT EXISTS (SELECT 1 FROM "report_revisions" WHERE "report_id" = ${reportId})
        ) AS "owned"
      `;
      if (owner[0]?.owned !== true) throw new Error(RETRYABLE_PROCESSING_ERROR);
      const revision = await transaction.reportRevision.create({ data: { reportId, revision: 1, source: 'ai', content } });
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'processing',
            "ai_output" = ${JSON.stringify(content)}::jsonb,
            "current_revision_id" = ${revision.id},
            "render_revision" = 1,
            "render_generation" = "render_generation" + 1,
            "render_published_at" = NULL,
            "error" = NULL,
            "completed_at" = NULL,
            "processing_token" = NULL,
            "processing_expires_at" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
      `;
      if (updated !== 1) throw new Error(RETRYABLE_PROCESSING_ERROR);
    });
  }

  private async releaseClaim(reportId: string, token: string): Promise<void> {
    await this.withReportLock(reportId, async (transaction) => {
      const updated = await transaction.$executeRaw`
        UPDATE "reports"
        SET "status" = 'pending',
            "processing_token" = NULL,
            "processing_expires_at" = NULL,
            "error" = NULL
        WHERE "id" = ${reportId}
          AND "status" = 'processing'
          AND "processing_token" = ${token}
          AND "processing_expires_at" > clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM "report_revisions" WHERE "report_id" = ${reportId})
      `;
      if (updated !== 1) throw new Error(RETRYABLE_PROCESSING_ERROR);
      await markWorkspaceReportPending(transaction, reportId);
    });
  }

  private async withReportLock(
    reportId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      await operation(transaction);
    });
  }
}

function permanentFailure(error: unknown): boolean {
  return error instanceof Error && (
    error.message === 'REPORT_PROVIDER_POLICY'
    || error.message === 'REPORT_PROVIDER_AUTH'
    || error.message === 'REPORT_PROVIDER_REQUEST_TOO_LARGE'
  );
}
