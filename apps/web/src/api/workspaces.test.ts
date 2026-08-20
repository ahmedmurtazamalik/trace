import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addWorkspaceMember,
  archiveWorkspace,
  assignWorkspaceRepository,
  createWorkspace,
  disableWorkspaceReportSchedule,
  generateWorkspaceReport,
  getWorkspaceReport,
  getWorkspace,
  getWorkspaceAnalysis,
  getWorkspaceReportSchedule,
  listWorkspaceReportOccurrences,
  listWorkspaceReports,
  listWorkspaces,
  removeWorkspaceMember,
  removeWorkspaceRepository,
  updateWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceReportSchedule,
  startWorkspaceBaseline,
  updateWorkspaceReportRevision,
  regenerateWorkspaceReport,
  downloadWorkspaceReportArtifact,

} from './workspaces';

const summary = {
  id: 'workspace_1',
  name: 'Product Delivery',
  slug: 'product-delivery-a1b2c3',
  role: 'MANAGER' as const,
  memberCount: 1,
  repositoryCount: 0,
  archivedAt: null,
  createdAt: '2026-08-18T08:00:00.000Z',
  updatedAt: '2026-08-18T08:00:00.000Z',
};

const completedReport = {
  id: 'report/1', reportDate: '2026-08-18', timezone: 'UTC', status: 'completed' as const,
  createdAt: '2026-08-18T17:00:00.000Z', completedAt: '2026-08-18T17:01:00.000Z',
  errorMessage: null, revision: 1, downloadAvailable: true,
};
const completedReportDetail = {
  report: {
    ...completedReport,
    revisionSource: 'ai' as const,
    content: { executiveSummary: 'Workspace delivery was summarized.', repositories: [] },
    facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
    artifacts: [{ id: 'artifact_safe-1', revision: 1, kind: 'pdf' as const, fileName: 'workspace-report.pdf', contentType: 'application/pdf' as const, sizeBytes: 4, checksum: '0'.repeat(64) }],
  },
};
const completedWorkspaceReportDetail = {
  ...completedReportDetail,
  workspaceEvidence: {
    workspaceId: 'workspace/1', workspaceName: 'Product Delivery', trigger: 'MANUAL' as const,
    scheduleVersion: null, scheduledFor: null, intendedLocalDateTime: null,
    windowStart: '2026-08-17T00:00:00.000Z', windowEnd: '2026-08-18T00:00:00.000Z', dataCutoffAt: '2026-08-18T00:00:00.000Z',
    recoveredAt: null, noActivity: true, repositories: [],
  },
};

const occurrence = {
  id: 'occurrence/1', workspaceId: 'workspace/1', scheduleId: null, scheduleVersion: null,
  trigger: 'MANUAL' as const, scheduledFor: null, intendedLocalDateTime: null,
  windowStart: '2026-08-17T00:00:00.000Z', windowEnd: '2026-08-18T00:00:00.000Z',
  dataCutoffAt: '2026-08-18T00:00:00.000Z', requestedById: 'user_1', status: 'PENDING' as const,
  reportId: 'report_1', idempotencyKey: 'manual-phase7', noActivity: false, recoveredAt: null,
  createdAt: '2026-08-18T00:00:01.000Z', startedAt: null, completedAt: null, error: null,
};

const schedule = {
  id: 'schedule_1', workspaceId: 'workspace/1', enabled: true, frequency: 'SELECTED_DAYS' as const,
  selectedDays: [1, 5], localTime: '09:30', timezone: 'America/Los_Angeles', version: 2,
  configuredById: 'user_1', nextRunAt: '2026-08-21T16:30:00.000Z', nextRunLocal: '2026-08-21T09:30:00',
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:01:00.000Z',
};

const analysis = {
  workspaceId: 'workspace/1', repositoryId: 'repo/1', repositoryFullName: 'trace/web',
  status: 'UNINITIALIZED' as const, baselineSha: null, lastAnalyzedSha: null,
  baselineStartedAt: null, baselineCompletedAt: null, lastAnalyzedAt: null,
  accessState: 'ACTIVE' as const, coverage: null, lastError: null, latestRun: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('workspace API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists and loads only schema-valid workspace responses with cookie credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [summary] }))
      .mockResolvedValueOnce(jsonResponse({ workspace: summary, members: [], repositories: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWorkspaces()).resolves.toEqual({ items: [summary] });
    await expect(getWorkspace('workspace 1')).resolves.toMatchObject({ workspace: summary });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.credentials])).toEqual([
      ['http://localhost:3001/api/v1/workspaces', 'GET', 'include'],
      ['http://localhost:3001/api/v1/workspaces/workspace%201', 'GET', 'include'],
    ]);
  });

  it('creates a workspace and sends manager mutations with JSON and in-memory CSRF', async () => {
    const member = { userId: 'user_2', username: 'ali.dev', displayName: null, role: 'DEVELOPER', joinedAt: '2026-08-18T08:05:00.000Z' };
    const repository = { id: 'repo_1', fullName: 'trace/web', private: true, defaultBranch: 'main', url: null, accessState: 'ACTIVE' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ workspace: summary }, 201))
      .mockResolvedValueOnce(jsonResponse({ member }, 201))
      .mockResolvedValueOnce(jsonResponse({ repository }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await createWorkspace({ name: 'Product Delivery' }, 'csrf-live');
    await addWorkspaceMember('workspace_1', { username: 'ali.dev', role: 'DEVELOPER' }, 'csrf-live');
    await assignWorkspaceRepository('workspace_1', { repositoryId: 'repo_1' }, 'csrf-live');

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.headers, init.body])).toEqual([
      ['http://localhost:3001/api/v1/workspaces', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live' }, JSON.stringify({ name: 'Product Delivery' })],
      ['http://localhost:3001/api/v1/workspaces/workspace_1/members', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live' }, JSON.stringify({ username: 'ali.dev', role: 'DEVELOPER' })],
      ['http://localhost:3001/api/v1/workspaces/workspace_1/repositories', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live' }, JSON.stringify({ repositoryId: 'repo_1' })],
    ]);
  });

  it('rejects malformed success payloads and maps closed workspace errors safely', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'broken' }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 'WORKSPACE_MANAGER_REQUIRED', message: 'raw details', requestId: 'request-1' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWorkspaces()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(addWorkspaceMember('workspace_1', { username: 'ali.dev', role: 'DEVELOPER' }, 'csrf-live')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGER_REQUIRED',
      message: 'Only workspace managers can change members or repositories.',
      status: 403,
      requestId: 'request-1',
    });
  });

  it('sends the complete Manager lifecycle with encoded identifiers and CSRF', async () => {
    const member = { userId: 'user/2', username: 'ali.dev', displayName: null, role: 'MANAGER', joinedAt: '2026-08-18T08:05:00.000Z' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ workspace: { ...summary, name: 'Platform' } }))
      .mockResolvedValueOnce(jsonResponse({ member }))
      .mockResolvedValueOnce(jsonResponse({ removed: true }))
      .mockResolvedValueOnce(jsonResponse({ removed: true }))
      .mockResolvedValueOnce(jsonResponse({ workspace: { ...summary, archivedAt: '2026-08-18T09:00:00.000Z' } }));
    vi.stubGlobal('fetch', fetchMock);

    await updateWorkspace('workspace/1', { name: 'Platform' }, 'csrf-live');
    await updateWorkspaceMemberRole('workspace/1', 'user/2', { role: 'MANAGER' }, 'csrf-live');
    await removeWorkspaceMember('workspace/1', 'user/2', 'csrf-live');
    await removeWorkspaceRepository('workspace/1', 'repo/1', 'csrf-live');
    await archiveWorkspace('workspace/1', 'csrf-live');

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1', 'PATCH'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/members/user%2F2', 'PATCH'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/members/user%2F2', 'DELETE'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/repositories/repo%2F1', 'DELETE'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/archive', 'POST'],
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers).toEqual(expect.objectContaining({ 'x-csrf-token': 'csrf-live' }));
  });

  it('strictly parses analysis, schedules, and occurrences while encoding opaque workspace IDs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [analysis] }))
      .mockResolvedValueOnce(jsonResponse({ schedule }))
      .mockResolvedValueOnce(jsonResponse({ items: [occurrence] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWorkspaceAnalysis('workspace/1')).resolves.toEqual({ items: [analysis] });
    await expect(getWorkspaceReportSchedule('workspace/1')).resolves.toEqual({ schedule });
    await expect(listWorkspaceReportOccurrences('workspace/1')).resolves.toEqual({ items: [occurrence] });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.credentials])).toEqual([
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/analysis', 'GET', 'include'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/report-schedule', 'GET', 'include'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/report-occurrences', 'GET', 'include'],
    ]);
  });

  it('sends report, schedule, disable, and baseline mutations with canonical CSRF and encoded IDs', async () => {
    const runningAnalysis = { ...analysis, status: 'PENDING' as const, latestRun: {
      id: 'run_1', workspaceId: 'workspace/1', repositoryId: 'repo/1', kind: 'BASELINE' as const,
      fromSha: null, toSha: null, dataCutoffAt: '2026-08-18T00:00:00.000Z', status: 'PENDING' as const,
      coverage: null, accessState: 'ACTIVE' as const, startedAt: null, completedAt: null, error: null,
    } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ occurrence }, 201))
      .mockResolvedValueOnce(jsonResponse({ schedule }))
      .mockResolvedValueOnce(jsonResponse({ schedule: { ...schedule, enabled: false, nextRunAt: null, nextRunLocal: null, version: 3 } }))
      .mockResolvedValueOnce(jsonResponse({ analysis: runningAnalysis, run: runningAnalysis.latestRun }));
    vi.stubGlobal('fetch', fetchMock);

    await generateWorkspaceReport('workspace/1', { windowStart: occurrence.windowStart, windowEnd: occurrence.windowEnd }, 'manual-phase7', 'csrf-live');
    await updateWorkspaceReportSchedule('workspace/1', { enabled: true, frequency: 'SELECTED_DAYS', selectedDays: [5, 1], localTime: '09:30', timezone: 'America/Los_Angeles' }, 'csrf-live');
    await disableWorkspaceReportSchedule('workspace/1', 'csrf-live');
    await startWorkspaceBaseline('workspace/1', 'repo/1', 'csrf-live');

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.headers, init.body])).toEqual([
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/reports/generate', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live', 'idempotency-key': 'manual-phase7' }, JSON.stringify({ windowStart: occurrence.windowStart, windowEnd: occurrence.windowEnd })],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/report-schedule', 'PUT', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live' }, JSON.stringify({ enabled: true, frequency: 'SELECTED_DAYS', selectedDays: [1, 5], localTime: '09:30', timezone: 'America/Los_Angeles' })],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/report-schedule', 'DELETE', { 'x-csrf-token': 'csrf-live' }, undefined],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/repositories/repo%2F1/baseline', 'POST', { 'x-csrf-token': 'csrf-live' }, undefined],
    ]);
  });

  it('fails closed on malformed Phase 7 payloads and never exposes backend error details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ ...analysis, unexpected: true }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 'WORKSPACE_REPOSITORY_ACCESS_REMOVED', message: 'secret provider detail', requestId: 'request-phase7' }, 409));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWorkspaceAnalysis('workspace_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(startWorkspaceBaseline('workspace_1', 'repo_1', 'csrf-live')).rejects.toMatchObject({
      code: 'WORKSPACE_REPOSITORY_ACCESS_REMOVED',
      message: 'GitHub access to this workspace repository is unavailable.',
      status: 409,
      requestId: 'request-phase7',
    });
  });

  it('lists and loads runtime-validated reports only through encoded workspace routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [completedReport], pageInfo: { hasNextPage: false, nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse(completedWorkspaceReportDetail));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWorkspaceReports('workspace/1', { limit: 100 })).resolves.toMatchObject({ items: [completedReport] });
    await expect(getWorkspaceReport('workspace/1', 'report/1')).resolves.toEqual(completedWorkspaceReportDetail);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.credentials])).toEqual([
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/reports?limit=100', 'GET', 'include'],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/reports/report%2F1', 'GET', 'include'],
    ]);
  });

  it('sends scoped optimistic revision and regeneration mutations with CSRF and preserves conflicts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(completedReportDetail))
      .mockResolvedValueOnce(jsonResponse(completedReportDetail))
      .mockResolvedValueOnce(jsonResponse({ code: 'REPORT_REVISION_CONFLICT', message: 'raw details', requestId: 'request-conflict' }, 409));
    vi.stubGlobal('fetch', fetchMock);

    const revision = { expectedRevision: 1, prosePatch: { executiveSummary: 'Updated workspace summary.' } };
    await updateWorkspaceReportRevision('workspace/1', 'report/1', revision, 'csrf-live');
    await regenerateWorkspaceReport('workspace/1', 'report/1', { expectedRevision: 1 }, 'csrf-live');
    await expect(updateWorkspaceReportRevision('workspace/1', 'report/1', revision, 'csrf-live')).rejects.toMatchObject({ code: 'REPORT_REVISION_CONFLICT', status: 409, requestId: 'request-conflict' });
    expect(fetchMock.mock.calls.slice(0, 2).map(([url, init]) => [url, init.method, init.headers, init.body])).toEqual([
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/reports/report%2F1/revision', 'PUT', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live' }, JSON.stringify(revision)],
      ['http://localhost:3001/api/v1/workspaces/workspace%2F1/reports/report%2F1/regenerate', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'csrf-live' }, JSON.stringify({ expectedRevision: 1 })],
    ]);
  });


  it('normalizes stale authentication without exposing backend details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'UNAUTHORIZED', message: 'raw session detail', requestId: 'request-auth' }, 401)));
    await expect(getWorkspaceReport('workspace/1', 'report/1')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.', status: 401, requestId: 'request-auth',
    });
  });

  it('downloads from the authorized scoped URL with encoded IDs and trusted artifact metadata', async () => {
    const bytes = new TextEncoder().encode('%PDF');
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const artifact = { ...completedReportDetail.report.artifacts[0], sizeBytes: bytes.byteLength, checksum };
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadWorkspaceReportArtifact('workspace/1', 'report/1', artifact)).resolves.toMatchObject({ fileName: 'workspace-report.pdf' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/workspaces/workspace%2F1/reports/report%2F1/download?artifactId=artifact_safe-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});
