import { AutomaticSlackReportNotifier, formatSlackReportMessage } from '../../src/reports/report-slack-notifier';

const configuration = {
  frontendOrigin: 'https://trace.example',
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/secret',
};

function notifier() {
  const auditCreate = jest.fn().mockResolvedValue({});
  const auditFindFirst = jest.fn().mockResolvedValue(null);
  const executeRaw = jest.fn().mockResolvedValue(1);
  const transaction = { auditLog: { create: auditCreate, findFirst: auditFindFirst }, $executeRaw: executeRaw };
  const prisma = {
    auditLog: { create: auditCreate },
    $transaction: jest.fn((operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction)),
  };
  return { instance: new AutomaticSlackReportNotifier(prisma as never, configuration), auditCreate, auditFindFirst, executeRaw };
}

function postedText(fetchMock: jest.SpiedFunction<typeof fetch>): string {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON Slack request body.');
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== 'object' || !('text' in parsed) || typeof parsed.text !== 'string') {
    throw new Error('Expected a Slack text payload.');
  }
  return parsed.text;
}

const workspaceReport = {
  reportId: 'report/1',
  revisionId: 'revision-1',
  reportDate: '2026-08-20',
  executiveSummary: 'Authentication <work> is complete. @channel',
  workspaceId: 'workspace/1',
  workspaceName: 'Product & Delivery',
};

const personalReport = {
  reportId: 'personal/1',
  revisionId: 'revision-personal-1',
  reportDate: '2026-08-20',
  executiveSummary: 'A personal summary.',
  workspaceId: null,
  workspaceName: null,
};

describe('automatic Slack report notifications', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('posts a finalized workspace report with only its stored summary and authenticated Trace link', async () => {
    const { instance, auditCreate, executeRaw } = notifier();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(instance.notify(workspaceReport)).resolves.toBe('delivered');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(configuration.webhookUrl, expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
    }));
    const text = postedText(fetchMock);
    expect(text).toBe([
      '*Product &amp; Delivery — Trace report for 2026-08-20*',
      '',
      'Authentication &lt;work&gt; is complete. @\u200bchannel',
      '',
      '<https://trace.example/workspaces/workspace%2F1/reports/report%2F1|Open report and download the PDF in Trace>',
    ].join('\n'));
    expect(text).not.toMatch(/repositories|contributors|commits|files changed|additions|deletions/i);
    expect(auditCreate).toHaveBeenNthCalledWith(1, { data: {
      actorUserId: null,
      action: 'report.slack_delivery_attempted',
      targetType: 'reportRevision',
      targetId: 'revision-1',
      metadata: { scope: 'workspace', workspaceId: 'workspace/1', revisionId: 'revision-1' },
    } });
    expect(auditCreate).toHaveBeenNthCalledWith(2, { data: {
      actorUserId: null,
      action: 'report.slack_delivery_succeeded',
      targetType: 'reportRevision',
      targetId: 'revision-1',
      metadata: { scope: 'workspace', workspaceId: 'workspace/1', revisionId: 'revision-1' },
    } });
  });

  it('posts finalized personal reports to their authenticated personal report route', async () => {
    const { instance } = notifier();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await instance.notify(personalReport);

    const text = postedText(fetchMock);
    expect(text).toContain('*Personal Trace report for 2026-08-20*');
    expect(text).toContain('<https://trace.example/reports/personal%2F1|Open report and download the PDF in Trace>');
  });

  it('keeps Slack failure non-fatal, records a sanitized failure, and performs no automatic HTTP retry', async () => {
    const { instance, auditCreate } = notifier();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('provider secret detail', { status: 500 }));

    await expect(instance.notify(workspaceReport)).resolves.toBe('retry');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenLastCalledWith({ data: {
      actorUserId: null,
      action: 'report.slack_delivery_failed',
      targetType: 'reportRevision',
      targetId: 'revision-1',
      metadata: { scope: 'workspace', workspaceId: 'workspace/1', revisionId: 'revision-1' },
    } });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('provider secret detail');
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('/T000/B000/secret');
  });

  it('retries an attempted-only state when persisting a definitive failure outcome was unavailable', async () => {
    const retrying = notifier();
    retrying.auditCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('audit unavailable'));
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await expect(retrying.instance.notify(workspaceReport)).resolves.toBe('retry');
    retrying.auditFindFirst.mockResolvedValue({ action: 'report.slack_delivery_attempted' });
    await expect(retrying.instance.notify(workspaceReport)).resolves.toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('suppresses recorded successes but retries an ambiguous attempted-only delivery', async () => {
    const succeeded = notifier();
    succeeded.auditFindFirst.mockResolvedValue({ action: 'report.slack_delivery_succeeded' });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(succeeded.instance.notify(workspaceReport)).resolves.toBe('delivered');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(succeeded.auditCreate).not.toHaveBeenCalled();

    const attempted = notifier();
    attempted.auditFindFirst.mockResolvedValue({ action: 'report.slack_delivery_attempted' });
    await expect(attempted.instance.notify(workspaceReport)).resolves.toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the complete validated executive summary', () => {
    const executiveSummary = 'A'.repeat(20_000);
    expect(formatSlackReportMessage({ ...personalReport, executiveSummary }, configuration.frontendOrigin))
      .toContain(executiveSummary);
  });
});
