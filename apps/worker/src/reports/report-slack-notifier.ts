import type { Prisma, PrismaClient } from '@trace/database';
import { reportContentSchema } from '@trace/shared';

const SLACK_TIMEOUT_MS = 5_000;

export interface FinalizedReportNotification {
  reportId: string;
  revisionId: string;
  renderGeneration: number;
  reportDate: string;
  executiveSummary: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

export interface ReportCompletionNotifier {
  stage?(transaction: Prisma.TransactionClient, report: FinalizedReportNotification): Promise<void>;
  notify(report: FinalizedReportNotification): Promise<'delivered' | 'retry'>;
  recoverPending?(reportId: string): Promise<FinalizedReportNotification | null>;
}

interface SlackNotifierConfiguration {
  frontendOrigin: string;
  webhookUrl: string;
}

function escapeSlack(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(channel|here|everyone)\b/gi, '@\u200b$1');
}

export function formatSlackReportMessage(
  report: FinalizedReportNotification,
  frontendOrigin: string,
): string {
  const title = report.workspaceId === null
    ? `Personal Trace report for ${report.reportDate}`
    : `${report.workspaceName ?? 'Workspace'} — Trace report for ${report.reportDate}`;
  const route = report.workspaceId === null
    ? `/reports/${encodeURIComponent(report.reportId)}`
    : `/workspaces/${encodeURIComponent(report.workspaceId)}/reports/${encodeURIComponent(report.reportId)}`;
  const reportUrl = new URL(route, `${frontendOrigin.replace(/\/$/, '')}/`).toString();
  return [
    `*${escapeSlack(title)}*`,
    '',
    escapeSlack(report.executiveSummary),
    '',
    `<${reportUrl}|Open report and download the PDF in Trace>`,
  ].join('\n');
}

export class AutomaticSlackReportNotifier implements ReportCompletionNotifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly configuration: SlackNotifierConfiguration,
  ) {}

  async stage(
    transaction: Prisma.TransactionClient,
    report: FinalizedReportNotification,
  ): Promise<void> {
    await transaction.auditLog.create({ data: {
      actorUserId: null,
      action: 'report.slack_delivery_pending',
      targetType: 'reportRenderGeneration',
      targetId: `${report.revisionId}:${report.renderGeneration}`,
      metadata: this.metadata(report),
    } });
  }

  async notify(report: FinalizedReportNotification): Promise<'delivered' | 'retry'> {
    const deliveryId = `${report.revisionId}:${report.renderGeneration}`;
    const metadata = this.metadata(report);
    let claim: 'send' | 'delivered';
    try {
      claim = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'report-slack:' + deliveryId}, 0))`;
        const succeeded = await transaction.auditLog.findFirst({
          where: {
            targetType: 'reportRenderGeneration',
            targetId: deliveryId,
            action: 'report.slack_delivery_succeeded',
          },
          select: { id: true },
        });
        if (succeeded !== null) return 'delivered' as const;
        await transaction.auditLog.create({ data: {
          actorUserId: null,
          action: 'report.slack_delivery_attempted',
          targetType: 'reportRenderGeneration',
          targetId: deliveryId,
          metadata,
        } });
        return 'send' as const;
      });
    } catch {
      return 'retry';
    }
    if (claim !== 'send') return claim;

    let delivered = false;
    try {
      const response = await fetch(this.configuration.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: formatSlackReportMessage(report, this.configuration.frontendOrigin) }),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
        redirect: 'error',
      });
      delivered = response.ok;
    } catch {
      delivered = false;
    }

    try {
      await this.prisma.auditLog.create({ data: {
        actorUserId: null,
        action: delivered ? 'report.slack_delivery_succeeded' : 'report.slack_delivery_failed',
        targetType: 'reportRenderGeneration',
        targetId: deliveryId,
        metadata,
      } });
    } catch {
      return 'retry';
    }
    return delivered ? 'delivered' : 'retry';
  }

  async recoverPending(reportId: string): Promise<FinalizedReportNotification | null> {
    const rows = await this.prisma.$queryRaw<Array<{ action: string; targetId: string; metadata: unknown }>>`
      SELECT attempted.action, attempted.target_id AS "targetId", attempted.metadata
      FROM audit_logs AS attempted
      WHERE attempted.target_type = 'reportRenderGeneration'
        AND attempted.action = 'report.slack_delivery_pending'
        AND attempted.metadata->>'reportId' = ${reportId}
        AND NOT EXISTS (
          SELECT 1
          FROM audit_logs AS succeeded
          WHERE succeeded.target_type = attempted.target_type
            AND succeeded.target_id = attempted.target_id
            AND succeeded.action = 'report.slack_delivery_succeeded'
        )
      ORDER BY attempted.created_at ASC
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) return null;
    if (row.action !== 'report.slack_delivery_pending') throw new Error('REPORT_SLACK_OBLIGATION_INVALID');
    const notification = this.notification(row.metadata, reportId, row.targetId);
    if (notification === null) throw new Error('REPORT_SLACK_OBLIGATION_INVALID');
    const revision = await this.prisma.reportRevision.findFirst({
      where: { id: notification.revisionId, reportId },
      select: {
        content: true,
        report: {
          select: {
            reportDate: true,
            workspaceId: true,
          },
        },
      },
    });
    const content = reportContentSchema.safeParse(revision?.content);
    if (
      revision === null
      || !content.success
      || content.data.executiveSummary !== notification.executiveSummary
      || revision.report.reportDate.toISOString().slice(0, 10) !== notification.reportDate
      || revision.report.workspaceId !== notification.workspaceId
    ) throw new Error('REPORT_SLACK_OBLIGATION_INVALID');
    return notification;
  }

  private notification(value: unknown, reportId: string, targetId: string): FinalizedReportNotification | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const notification = value as Record<string, unknown>;
    if (
      notification.reportId !== reportId
      || typeof notification.revisionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(notification.revisionId)
      || typeof notification.renderGeneration !== 'number' || !Number.isSafeInteger(notification.renderGeneration)
      || notification.renderGeneration < 1
      || typeof notification.reportDate !== 'string' || !this.reportDate(notification.reportDate)
      || typeof notification.executiveSummary !== 'string' || notification.executiveSummary.length < 1
      || notification.executiveSummary.length > 20_000
      || !(
        (
          notification.scope === 'personal'
          && notification.workspaceId === null
          && notification.workspaceName === null
        )
        || (
          notification.scope === 'workspace'
          && typeof notification.workspaceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(notification.workspaceId)
          && typeof notification.workspaceName === 'string'
          && notification.workspaceName.length >= 1 && notification.workspaceName.length <= 200
        )
      )
      || targetId !== `${notification.revisionId}:${notification.renderGeneration}`
    ) return null;
    return {
      reportId,
      revisionId: notification.revisionId,
      renderGeneration: notification.renderGeneration,
      reportDate: notification.reportDate,
      executiveSummary: notification.executiveSummary,
      workspaceId: notification.workspaceId,
      workspaceName: notification.workspaceName,
    } as FinalizedReportNotification;
  }

  private metadata(report: FinalizedReportNotification) {
    return {
      scope: report.workspaceId === null ? 'personal' : 'workspace',
      reportId: report.reportId,
      workspaceId: report.workspaceId,
      workspaceName: report.workspaceName,
      reportDate: report.reportDate,
      revisionId: report.revisionId,
      renderGeneration: report.renderGeneration,
      executiveSummary: report.executiveSummary,
    };
  }

  private reportDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
}
