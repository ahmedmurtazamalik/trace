import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Prisma, PrismaService } from '@trace/database';
import { reportContentSchema } from '@trace/shared';
import { TRACE_CONFIG } from '../../common/config/config.token';

const MAX_SLACK_SUMMARY_LENGTH = 3_000;
const SLACK_TIMEOUT_MS = 5_000;
const SLACK_TRANSACTION_TIMEOUT_MS = 15_000;
const SLACK_TRANSACTION_COMMIT_MARGIN_MS = 2_000;

interface SlackReportMessage {
  workspaceName: string;
  reportDate: string;
  executiveSummary: string;
  reportUrl: string;
}

function escapeSlack(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(channel|here|everyone)\b/gi, '@\u200b$1');
}

export function formatSlackReportMessage(input: SlackReportMessage) {
  const summary = input.executiveSummary.length > MAX_SLACK_SUMMARY_LENGTH
    ? `${input.executiveSummary.slice(0, MAX_SLACK_SUMMARY_LENGTH - 1).trimEnd()}…`
    : input.executiveSummary;
  return [
    `*${escapeSlack(input.workspaceName)} — Trace report for ${input.reportDate}*`,
    '',
    escapeSlack(summary),
    '',
    `<${input.reportUrl}|Open report and download the PDF in Trace>`,
  ].join('\n');
}

@Injectable()
export class WorkspaceReportSlackService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
  ) {}

  async share(userId: string, workspaceId: string, reportId: string): Promise<{ sent: true }> {
    const webhookUrl = this.config.slack.reportWebhookUrl;

    let slackPosted = false;
    try {
      const delivered = await this.prisma.$transaction(async (transaction) => {
        const transactionStartedAt = Date.now();
        await transaction.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
        const workspaces = await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`,
        );
        if (workspaces.length === 0) this.workspaceNotFound();

        const membership = await transaction.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId } },
        });
        if (membership === null) this.workspaceNotFound();
        if (membership.role !== 'MANAGER') {
          throw new HttpException({ code: 'WORKSPACE_MANAGER_REQUIRED', message: 'Manager access required.' }, HttpStatus.FORBIDDEN);
        }
        const workspace = await transaction.workspace.findUnique({ where: { id: workspaceId }, select: { archivedAt: true } });
        if (workspace === null) this.workspaceNotFound();
        if (workspace.archivedAt !== null) {
          throw new HttpException({ code: 'WORKSPACE_ARCHIVED', message: 'Archived workspaces are read-only.' }, HttpStatus.CONFLICT);
        }
        if (webhookUrl === undefined) {
          throw new HttpException({ code: 'SLACK_NOT_CONFIGURED', message: 'Slack report sharing is not configured.' }, HttpStatus.SERVICE_UNAVAILABLE);
        }

        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
        const report = await transaction.report.findFirst({
          where: {
            id: reportId,
            workspaceId,
            status: 'completed',
            workspace: {
              is: {
                archivedAt: null,
                memberships: { some: { userId, role: 'MANAGER' } },
              },
            },
          },
          select: {
            reportDate: true,
            workspace: { select: { name: true } },
            currentRevision: {
              select: {
                id: true,
                content: true,
                artifacts: { where: { kind: 'pdf' }, select: { id: true }, take: 1 },
              },
            },
          },
        });
        if (report === null || report.workspace === null || report.currentRevision === null || report.currentRevision.artifacts.length !== 1) {
          throw new HttpException({ code: 'REPORT_NOT_FOUND', message: 'Completed report not found.' }, HttpStatus.NOT_FOUND);
        }
        const content = reportContentSchema.safeParse(report.currentRevision.content);
        if (!content.success) this.deliveryFailed();

        const reportUrl = new URL(
          `/workspaces/${encodeURIComponent(workspaceId)}/reports/${encodeURIComponent(reportId)}`,
          `${this.config.frontendOrigin.replace(/\/$/, '')}/`,
        ).toString();
        const text = formatSlackReportMessage({
          workspaceName: report.workspace.name,
          reportDate: report.reportDate.toISOString().slice(0, 10),
          executiveSummary: content.data.executiveSummary,
          reportUrl,
        });

        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'workspace.report_slack_share_attempted',
            targetType: 'report',
            targetId: reportId,
            metadata: {
              workspaceId,
              revisionId: report.currentRevision.id,
              artifactId: report.currentRevision.artifacts[0]!.id,
            },
          },
        });

        const remainingTransactionMs = SLACK_TRANSACTION_TIMEOUT_MS
          - (Date.now() - transactionStartedAt)
          - SLACK_TRANSACTION_COMMIT_MARGIN_MS;
        if (remainingTransactionMs <= 0) return false;
        const posted = await this.postToSlack(webhookUrl, text, Math.min(SLACK_TIMEOUT_MS, remainingTransactionMs));
        slackPosted = posted;
        return posted;
      }, { timeout: SLACK_TRANSACTION_TIMEOUT_MS });

      if (!delivered) this.deliveryFailed();
      return { sent: true };
    } catch (error) {
      // If Slack accepted the request but the transaction commit failed, report
      // success so the Manager is not encouraged to create a duplicate post.
      if (slackPosted) return { sent: true };
      throw error;
    }
  }

  private async postToSlack(webhookUrl: string, text: string, timeoutMs: number): Promise<boolean> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private workspaceNotFound(): never {
    throw new HttpException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' }, HttpStatus.NOT_FOUND);
  }

  private deliveryFailed(): never {
    throw new HttpException({ code: 'SLACK_DELIVERY_FAILED', message: 'Slack delivery failed.' }, HttpStatus.BAD_GATEWAY);
  }
}
