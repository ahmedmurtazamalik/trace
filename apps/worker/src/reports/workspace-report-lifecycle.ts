import type { Prisma } from '@trace/database';

export async function markWorkspaceReportProcessing(transaction: Prisma.TransactionClient, reportId: string): Promise<void> {
  await transaction.$executeRaw`
    UPDATE "workspace_report_occurrences"
    SET "status" = 'PROCESSING',
        "started_at" = COALESCE("started_at", clock_timestamp()),
        "completed_at" = NULL,
        "error" = NULL
    WHERE "report_id" = ${reportId}
      AND "status" IN ('PENDING', 'QUEUED', 'PROCESSING')
  `;
}

export async function markWorkspaceReportPending(transaction: Prisma.TransactionClient, reportId: string): Promise<void> {
  await transaction.$executeRaw`
    UPDATE "workspace_report_occurrences"
    SET "status" = 'PENDING',
        "started_at" = NULL,
        "completed_at" = NULL,
        "error" = NULL
    WHERE "report_id" = ${reportId}
      AND "status" IN ('PENDING', 'QUEUED', 'PROCESSING')
  `;
}

export async function markWorkspaceReportFailed(transaction: Prisma.TransactionClient, reportId: string): Promise<void> {
  await transaction.$executeRaw`
    UPDATE "workspace_report_occurrences" occurrence
    SET "status" = 'FAILED',
        "started_at" = COALESCE(occurrence."started_at", report."created_at"),
        "completed_at" = COALESCE(report."completed_at", occurrence."completed_at", clock_timestamp()),
        "error" = LEFT(report."error", 500)
    FROM "reports" report
    WHERE occurrence."report_id" = ${reportId}
      AND report."id" = occurrence."report_id"
      AND report."status" = 'failed'
      AND occurrence."status" IN ('PENDING', 'QUEUED', 'PROCESSING')
  `;
}

export async function markWorkspaceReportCompleted(transaction: Prisma.TransactionClient, reportId: string): Promise<void> {
  await transaction.$executeRaw`
    UPDATE "workspace_report_occurrences" occurrence
    SET "status" = 'COMPLETED',
        "started_at" = COALESCE(occurrence."started_at", report."created_at"),
        "completed_at" = report."completed_at",
        "error" = NULL
    FROM "reports" report
    WHERE occurrence."report_id" = ${reportId}
      AND report."id" = occurrence."report_id"
      AND report."status" = 'completed'
      AND occurrence."status" IN ('PENDING', 'QUEUED', 'PROCESSING')
  `;
}
