import { performance } from 'node:perf_hooks';
import type { TraceConfig } from '@trace/config';
import { WorkspaceReportSlackService, formatSlackReportMessage } from '../src/modules/workspaces/workspace-report-slack.service';

const config = {
  frontendOrigin: 'https://trace.example',
  slack: { reportWebhookUrl: 'https://hooks.slack.com/services/T000/B000/secret' },
} as unknown as TraceConfig;

function slackService(role: 'MANAGER' | 'DEVELOPER' = 'MANAGER', serviceConfig: TraceConfig = config) {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'workspace-1' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    workspaceMembership: { findUnique: jest.fn().mockResolvedValue({ role }) },
    workspace: { findUnique: jest.fn().mockResolvedValue({ archivedAt: null }) },
    report: { findFirst: jest.fn().mockResolvedValue({
      id: 'report/1', reportDate: new Date('2026-08-18T00:00:00.000Z'),
      workspace: { name: 'Product Delivery' },
      currentRevision: {
        id: 'revision-1', content: { executiveSummary: 'Authentication work is complete.', repositories: [] },
        artifacts: [{ id: 'pdf-1' }],
      },
    }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn((operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
  };
  return { instance: new WorkspaceReportSlackService(prisma as never, serviceConfig), prisma, transaction };
}

describe('Slack report message formatting', () => {
  it('shares only the report summary and authenticated Trace link without metrics', () => {
    const message = formatSlackReportMessage({
      workspaceName: 'Product & Delivery',
      reportDate: '2026-08-18',
      executiveSummary: 'Authentication <work> is complete. @channel',
      reportUrl: 'https://trace.example/workspaces/workspace-1/reports/report-1',
    });

    expect(message).toBe([
      '*Product &amp; Delivery — Trace report for 2026-08-18*',
      '',
      'Authentication &lt;work&gt; is complete. @\u200bchannel',
      '',
      '<https://trace.example/workspaces/workspace-1/reports/report-1|Open report and download the PDF in Trace>',
    ].join('\n'));
    expect(message).not.toMatch(/repositories|contributors|commits|files changed|additions|deletions/i);
    expect(message).not.toContain('@channel');
  });

  it('preserves the complete stored executive summary', () => {
    const executiveSummary = 'A'.repeat(20_000);
    const message = formatSlackReportMessage({
      workspaceName: 'Product Delivery',
      reportDate: '2026-08-18',
      executiveSummary,
      reportUrl: 'https://trace.example/workspaces/workspace-1/reports/report-1',
    });

    expect(message).toContain(executiveSummary);
  });
});

describe('workspace report Slack delivery', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('audits the Manager attempt and posts the current report summary and link', async () => {
    const { instance, prisma } = slackService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(instance.share('manager-1', 'workspace/1', 'report/1')).resolves.toEqual({ sent: true });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/T000/B000/secret',
      expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' } }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
    const body: unknown = JSON.parse(init.body);
    if (body === null || typeof body !== 'object' || !('text' in body) || typeof body.text !== 'string') throw new Error('Expected a Slack text payload');
    expect(body.text).toContain('Authentication work is complete.');
    expect(body.text).toContain('https://trace.example/workspaces/workspace%2F1/reports/report%2F1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: {
      actorUserId: 'manager-1',
      action: 'workspace.report_slack_share_attempted',
      targetType: 'report',
      targetId: 'report/1',
      metadata: { workspaceId: 'workspace/1', revisionId: 'revision-1', artifactId: 'pdf-1' },
    } });
    expect(prisma.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
  });

  it('does not start Slack delivery after lock acquisition consumes the transaction safety budget', async () => {
    const { instance, prisma } = slackService();
    jest.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(15_000);
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(instance.share('manager-1', 'workspace-1', 'report-1')).rejects.toMatchObject({
      status: 502,
      response: { code: 'SLACK_DELIVERY_FAILED' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not invite a duplicate retry when Slack accepted the post but the database commit failed', async () => {
    const { instance, prisma, transaction } = slackService();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    prisma.$transaction.mockImplementationOnce(async (operation) => {
      await operation(transaction);
      throw new Error('commit failed');
    });

    await expect(instance.share('manager-1', 'workspace-1', 'report-1')).resolves.toEqual({ sent: true });
  });

  it('sanitizes lock and transaction failures before returning them to the client', async () => {
    const { instance, prisma } = slackService();
    prisma.$transaction.mockRejectedValueOnce(new Error('database lock timeout detail'));

    await expect(instance.share('manager-1', 'workspace-1', 'report-1')).rejects.toMatchObject({
      status: 502,
      response: { code: 'SLACK_DELIVERY_FAILED', message: 'Slack delivery failed.' },
    });
  });

  it('rejects Developers before reading or disclosing a report', async () => {
    const { instance, prisma } = slackService('DEVELOPER');
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(instance.share('developer-1', 'workspace-1', 'report-1')).rejects.toMatchObject({ status: 403 });
    expect(prisma.report.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns sanitized configuration and delivery failures without logging the webhook secret', async () => {
    const unconfigured = { ...config, slack: {} } as TraceConfig;
    const { instance: missingInstance } = slackService('MANAGER', unconfigured);
    await expect(missingInstance.share('manager-1', 'workspace-1', 'report-1')).rejects.toMatchObject({
      status: 503, response: { code: 'SLACK_NOT_CONFIGURED', message: 'Slack report sharing is not configured.' },
    });

    const { instance, prisma } = slackService();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('provider details', { status: 500 }));
    let failure: unknown;
    try { await instance.share('manager-1', 'workspace-1', 'report-1'); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ status: 502, response: { code: 'SLACK_DELIVERY_FAILED', message: 'Slack delivery failed.' } });
    expect(JSON.stringify(failure)).not.toContain('/T000/B000/secret');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: {
      actorUserId: 'manager-1',
      action: 'workspace.report_slack_share_attempted',
      targetType: 'report',
      targetId: 'report-1',
      metadata: { workspaceId: 'workspace-1', revisionId: 'revision-1', artifactId: 'pdf-1' },
    } });
  });
});
