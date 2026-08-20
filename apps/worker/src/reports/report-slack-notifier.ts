import type { PrismaClient } from '@trace/database';

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
  notify(report: FinalizedReportNotification): Promise<'delivered' | 'retry'>;
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

  async notify(report: FinalizedReportNotification): Promise<'delivered' | 'retry'> {
    const deliveryId = `${report.revisionId}:${report.renderGeneration}`;
    const metadata = {
      scope: report.workspaceId === null ? 'personal' : 'workspace',
      workspaceId: report.workspaceId,
      revisionId: report.revisionId,
      renderGeneration: report.renderGeneration,
    };
    let claim: 'send' | 'delivered';
    try {
      claim = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'report-slack:' + deliveryId}, 0))`;
        const previous = await transaction.auditLog.findFirst({
          where: {
            targetType: 'reportRenderGeneration',
            targetId: deliveryId,
            action: { in: [
              'report.slack_delivery_attempted',
              'report.slack_delivery_succeeded',
              'report.slack_delivery_failed',
            ] },
          },
          orderBy: { createdAt: 'desc' },
          select: { action: true },
        });
        if (previous?.action === 'report.slack_delivery_succeeded') return 'delivered' as const;
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

    await this.prisma.auditLog.create({ data: {
      actorUserId: null,
      action: delivered ? 'report.slack_delivery_succeeded' : 'report.slack_delivery_failed',
      targetType: 'reportRenderGeneration',
      targetId: deliveryId,
      metadata,
    } }).catch(() => undefined);
    return delivered ? 'delivered' : 'retry';
  }
}
