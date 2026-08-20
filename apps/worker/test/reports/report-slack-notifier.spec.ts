import { AutomaticSlackReportNotifier, formatSlackReportMessage } from '../../src/reports/report-slack-notifier';

const configuration = {
  frontendOrigin: 'https://trace.example',
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/secret',
};

function notifier() {
  const auditCreate = jest.fn().mockResolvedValue({});
  const auditFindFirst = jest.fn().mockResolvedValue(null);
  const executeRaw = jest.fn().mockResolvedValue(1);
  const queryRaw = jest.fn().mockResolvedValue([]);
  const revisionFindFirst = jest.fn().mockResolvedValue(null);
  const transaction = { auditLog: { create: auditCreate, findFirst: auditFindFirst }, $executeRaw: executeRaw };
  const prisma = {
    auditLog: { create: auditCreate },
    reportRevision: { findFirst: revisionFindFirst },
    $transaction: jest.fn((operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction)),
    $queryRaw: queryRaw,
  };
  return {
    instance: new AutomaticSlackReportNotifier(prisma as never, configuration),
    auditCreate,
    auditFindFirst,
    executeRaw,
    queryRaw,
    revisionFindFirst,
  };
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
  renderGeneration: 1,
  reportDate: '2026-08-20',
  executiveSummary: 'Authentication <work> is complete. @channel',
  workspaceId: 'workspace/1',
  workspaceName: 'Product & Delivery',
};

const personalReport = {
  reportId: 'personal/1',
  revisionId: 'revision-personal-1',
  renderGeneration: 1,
  reportDate: '2026-08-20',
  executiveSummary: 'A personal summary.',
  workspaceId: null,
  workspaceName: null,
};

const workspaceMetadata = {
  scope: 'workspace',
  reportId: workspaceReport.reportId,
  workspaceId: workspaceReport.workspaceId,
  workspaceName: workspaceReport.workspaceName,
  reportDate: workspaceReport.reportDate,
  revisionId: workspaceReport.revisionId,
  renderGeneration: workspaceReport.renderGeneration,
  executiveSummary: workspaceReport.executiveSummary,
};

describe('automatic Slack report notifications', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('stages the bounded notification snapshot in the report-finalization transaction', async () => {
    const { instance, auditCreate } = notifier();
    await instance.stage({ auditLog: { create: auditCreate } } as never, workspaceReport);

    expect(auditCreate).toHaveBeenCalledWith({ data: {
      actorUserId: null,
      action: 'report.slack_delivery_pending',
      targetType: 'reportRenderGeneration',
      targetId: 'revision-1:1',
      metadata: workspaceMetadata,
    } });
  });

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
      targetType: 'reportRenderGeneration',
      targetId: 'revision-1:1',
      metadata: workspaceMetadata,
    } });
    expect(auditCreate).toHaveBeenNthCalledWith(2, { data: {
      actorUserId: null,
      action: 'report.slack_delivery_succeeded',
      targetType: 'reportRenderGeneration',
      targetId: 'revision-1:1',
      metadata: workspaceMetadata,
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
      targetType: 'reportRenderGeneration',
      targetId: 'revision-1:1',
      metadata: workspaceMetadata,
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
    retrying.auditFindFirst.mockResolvedValue(null);
    await expect(retrying.instance.notify(workspaceReport)).resolves.toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries an accepted post when durable success evidence cannot be recorded', async () => {
    const ambiguous = notifier();
    ambiguous.auditCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('audit unavailable'));
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(ambiguous.instance.notify(workspaceReport)).resolves.toBe('retry');
  });

  it('suppresses any recorded success even when a later audit row exists', async () => {
    const succeeded = notifier();
    succeeded.auditFindFirst.mockResolvedValue({ action: 'report.slack_delivery_succeeded' });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(succeeded.instance.notify(workspaceReport)).resolves.toBe('delivered');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(succeeded.auditCreate).not.toHaveBeenCalled();
    expect(succeeded.auditFindFirst).toHaveBeenCalledWith({
      where: {
        targetType: 'reportRenderGeneration',
        targetId: 'revision-1:1',
        action: 'report.slack_delivery_succeeded',
      },
      select: { id: true },
    });

    const attempted = notifier();
    attempted.auditFindFirst.mockResolvedValue(null);
    await expect(attempted.instance.notify(workspaceReport)).resolves.toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers the oldest unresolved finalized generation from its authenticated durable snapshot', async () => {
    const { instance, queryRaw, revisionFindFirst } = notifier();
    const pending = {
      ...workspaceMetadata,
      reportId: 'report-1',
      workspaceId: 'workspace-1',
    };
    queryRaw.mockResolvedValue([{ action: 'report.slack_delivery_pending', targetId: 'revision-1:1', metadata: pending }]);
    revisionFindFirst.mockResolvedValue({
      content: { executiveSummary: workspaceReport.executiveSummary, repositories: [] },
      report: {
        reportDate: new Date('2026-08-20T00:00:00.000Z'),
        workspaceId: 'workspace-1',
        workspace: { name: workspaceReport.workspaceName },
      },
    });

    await expect(instance.recoverPending('report-1')).resolves.toEqual({
      reportId: 'report-1',
      revisionId: 'revision-1',
      renderGeneration: 1,
      reportDate: '2026-08-20',
      executiveSummary: workspaceReport.executiveSummary,
      workspaceId: 'workspace-1',
      workspaceName: workspaceReport.workspaceName,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(revisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'revision-1', reportId: 'report-1' },
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
  });

  it('rejects an attempted-only row as a delivery obligation', async () => {
    const { instance, queryRaw } = notifier();
    queryRaw.mockResolvedValue([{
      action: 'report.slack_delivery_attempted',
      targetId: 'revision-1:1',
      metadata: { ...workspaceMetadata, reportId: 'report-1', workspaceId: 'workspace-1' },
    }]);

    await expect(instance.recoverPending('report-1')).rejects.toThrow('REPORT_SLACK_OBLIGATION_INVALID');
  });

  it.each([
    ['cross-report snapshot', { ...workspaceMetadata, reportId: 'other-report', workspaceId: 'workspace-1' }, 'revision-1:1', null],
    ['mismatched target id', { ...workspaceMetadata, reportId: 'report-1', workspaceId: 'workspace-1' }, 'other-revision:1', null],
    ['nonexistent revision', { ...workspaceMetadata, reportId: 'report-1', workspaceId: 'workspace-1' }, 'revision-1:1', null],
    ['forged summary', { ...workspaceMetadata, reportId: 'report-1', workspaceId: 'workspace-1', executiveSummary: 'Forged' }, 'revision-1:1', {
      content: { executiveSummary: workspaceReport.executiveSummary, repositories: [] },
      report: {
        reportDate: new Date('2026-08-20T00:00:00.000Z'),
        workspaceId: 'workspace-1',
        workspace: { name: workspaceReport.workspaceName },
      },
    }],
    ['mismatched declared scope', {
      ...workspaceMetadata,
      scope: 'personal',
      reportId: 'report-1',
      workspaceId: 'workspace-1',
    }, 'revision-1:1', null],
    ['mismatched database scope', { ...workspaceMetadata, reportId: 'report-1', workspaceId: 'workspace-1' }, 'revision-1:1', {
      content: { executiveSummary: workspaceReport.executiveSummary, repositories: [] },
      report: {
        reportDate: new Date('2026-08-20T00:00:00.000Z'),
        workspaceId: 'other-workspace',
        workspace: { name: workspaceReport.workspaceName },
      },
    }],
  ])('rejects a syntactically valid %s obligation', async (_label, metadata, targetId, revision) => {
    const { instance, queryRaw, revisionFindFirst } = notifier();
    queryRaw.mockResolvedValue([{ action: 'report.slack_delivery_pending', targetId, metadata }]);
    revisionFindFirst.mockResolvedValue(revision);

    await expect(instance.recoverPending('report-1')).rejects.toThrow('REPORT_SLACK_OBLIGATION_INVALID');
  });

  it('preserves the frozen workspace title when the workspace is renamed before retry', async () => {
    const { instance, queryRaw, revisionFindFirst } = notifier();
    const frozen = {
      ...workspaceMetadata,
      reportId: 'report-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Workspace name at finalization',
    };
    queryRaw.mockResolvedValue([{
      action: 'report.slack_delivery_pending',
      targetId: 'revision-1:1',
      metadata: frozen,
    }]);
    revisionFindFirst.mockResolvedValue({
      content: { executiveSummary: workspaceReport.executiveSummary, repositories: [] },
      report: {
        reportDate: new Date('2026-08-20T00:00:00.000Z'),
        workspaceId: 'workspace-1',
      },
    });

    await expect(instance.recoverPending('report-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      workspaceName: 'Workspace name at finalization',
    });
  });

  it('delivers a new render generation of the same report revision', async () => {
    const regenerated = notifier();
    regenerated.auditFindFirst.mockImplementation(({ where }: { where: { targetId: string } }) => (
      Promise.resolve(where.targetId.endsWith(':1')
        ? { action: 'report.slack_delivery_succeeded' }
        : null)
    ));
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(regenerated.instance.notify(workspaceReport)).resolves.toBe('delivered');
    await expect(regenerated.instance.notify({ ...workspaceReport, renderGeneration: 2 })).resolves.toBe('delivered');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(regenerated.auditCreate.mock.calls)).toContain(
      '"targetType":"reportRenderGeneration","targetId":"revision-1:2"',
    );
  });

  it('preserves the complete validated executive summary', () => {
    const executiveSummary = 'A'.repeat(20_000);
    expect(formatSlackReportMessage({ ...personalReport, executiveSummary }, configuration.frontendOrigin))
      .toContain(executiveSummary);
  });
});
