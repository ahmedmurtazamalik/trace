import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RepositoryListResponse, WorkspaceDetailResponse, WorkspaceListResponse, WorkspaceReportOccurrence } from '@trace/shared';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceApiError } from '@/api/workspaces';
import { WorkspaceExperience } from './workspace-experience';

const managerSummary = {
  id: 'workspace_1', name: 'Product Delivery', slug: 'product-delivery-a1b2c3', role: 'MANAGER' as const,
  memberCount: 2, repositoryCount: 1, archivedAt: null, createdAt: '2026-08-18T08:00:00.000Z', updatedAt: '2026-08-18T08:00:00.000Z',
};
const developerSummary = { ...managerSummary, id: 'workspace_2', name: 'Mobile Team', role: 'DEVELOPER' as const };
const managerDetail: WorkspaceDetailResponse = {
  workspace: managerSummary,
  members: [
    { userId: 'user_1', username: 'ali.manager', displayName: 'Ali', role: 'MANAGER', joinedAt: '2026-08-18T08:00:00.000Z' },
    { userId: 'user_2', username: 'ali.dev', displayName: null, role: 'DEVELOPER', joinedAt: '2026-08-18T08:05:00.000Z' },
  ],
  repositories: [{ id: 'repo_1', fullName: 'trace/web', private: true, defaultBranch: 'main', url: 'https://github.com/trace/web', accessState: 'ACTIVE' }],
};
const repositories: RepositoryListResponse = {
  items: [
    { id: 'repo_1', owner: 'trace', name: 'web', fullName: 'trace/web', private: true, defaultBranch: 'main', url: null, accessible: true, trackingEnabled: true, removed: false, lastActivityAt: null, contributorCount: 2 },
    { id: 'repo_2', owner: 'trace', name: 'api', fullName: 'trace/api', private: true, defaultBranch: 'main', url: null, accessible: true, trackingEnabled: true, removed: false, lastActivityAt: null, contributorCount: 2 },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

const analysis = {
  workspaceId: 'workspace_1', repositoryId: 'repo_1', repositoryFullName: 'trace/web', status: 'UNINITIALIZED' as const,
  baselineSha: null, lastAnalyzedSha: null, baselineStartedAt: null, baselineCompletedAt: null, lastAnalyzedAt: null,
  accessState: 'ACTIVE' as const, coverage: null, lastError: null, latestRun: null,
};
const schedule = {
  id: 'schedule_1', workspaceId: 'workspace_1', enabled: true, frequency: 'WEEKDAYS' as const, selectedDays: [],
  localTime: '09:30', timezone: 'America/Los_Angeles', version: 1, configuredById: 'user_1',
  nextRunAt: '2026-08-19T16:30:00.000Z', nextRunLocal: '2026-08-19T09:30:00',
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
};
const occurrence: WorkspaceReportOccurrence = {
  id: 'occurrence_1', workspaceId: 'workspace_1', scheduleId: schedule.id, scheduleVersion: 1,
  trigger: 'RECOVERY', scheduledFor: '2026-08-18T16:30:00.000Z', intendedLocalDateTime: '2026-08-18T09:30:00',
  windowStart: '2026-08-17T16:30:00.000Z', windowEnd: '2026-08-18T16:30:00.000Z', dataCutoffAt: '2026-08-18T16:30:00.000Z',
  requestedById: 'user_1', status: 'FAILED', reportId: 'report_1', idempotencyKey: 'recovery-phase7', noActivity: true,
  recoveredAt: '2026-08-18T17:00:00.000Z', createdAt: '2026-08-18T17:00:00.000Z', startedAt: '2026-08-18T17:00:01.000Z', completedAt: '2026-08-18T17:00:02.000Z', error: 'Report generation failed safely.',
};
const completedReport = {
  id: 'report_2', reportDate: '2026-08-18', timezone: 'UTC', status: 'completed' as const,
  createdAt: '2026-08-18T17:00:00.000Z', completedAt: '2026-08-18T17:01:00.000Z', errorMessage: null,
  revision: 1, downloadAvailable: true,
};

function renderExperience(overrides: Partial<React.ComponentProps<typeof WorkspaceExperience>> = {}) {
  const props = {
    csrfToken: 'csrf-live',
    loadWorkspaces: vi.fn().mockResolvedValue({ items: [managerSummary, developerSummary] } satisfies WorkspaceListResponse),
    loadWorkspace: vi.fn().mockImplementation(async (id: string) => id === managerSummary.id ? managerDetail : { ...managerDetail, workspace: developerSummary }),
    createWorkspace: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ workspace: { ...managerSummary, id: 'workspace_new', name } })),
    addMember: vi.fn().mockResolvedValue({ member: { userId: 'user_3', username: 'new.developer', displayName: null, role: 'DEVELOPER', joinedAt: '2026-08-18T08:10:00.000Z' } }),
    assignRepository: vi.fn().mockResolvedValue({ repository: repositories.items[1] }),
    updateWorkspace: vi.fn().mockResolvedValue({ workspace: { ...managerSummary, name: 'Delivery Platform' } }),
    archiveWorkspace: vi.fn().mockResolvedValue({ workspace: { ...managerSummary, archivedAt: '2026-08-18T09:00:00.000Z' } }),
    updateMemberRole: vi.fn().mockResolvedValue({ member: { ...managerDetail.members[1], role: 'MANAGER' } }),
    removeMember: vi.fn().mockResolvedValue({ removed: true }),
    removeRepository: vi.fn().mockResolvedValue({ removed: true }),
    loadRepositories: vi.fn().mockResolvedValue(repositories),
    loadAnalysis: vi.fn().mockResolvedValue({ items: [analysis] }),
    startBaseline: vi.fn().mockResolvedValue({ analysis: { ...analysis, status: 'PENDING' }, run: { id: 'run_1', workspaceId: 'workspace_1', repositoryId: 'repo_1', kind: 'BASELINE', fromSha: null, toSha: null, dataCutoffAt: '2026-08-18T18:00:00.000Z', status: 'PENDING', coverage: null, accessState: 'ACTIVE', startedAt: null, completedAt: null, error: null } }),
    generateReport: vi.fn().mockResolvedValue({ occurrence: { ...occurrence, id: 'manual_1', trigger: 'MANUAL', status: 'PENDING', noActivity: false, recoveredAt: null, error: null } }),
    loadSchedule: vi.fn().mockResolvedValue({ schedule }),
    saveSchedule: vi.fn().mockResolvedValue({ schedule }),
    disableSchedule: vi.fn().mockResolvedValue({ schedule: { ...schedule, enabled: false, nextRunAt: null, nextRunLocal: null } }),
    loadOccurrences: vi.fn().mockResolvedValue({ items: [occurrence] }),
    loadReports: vi.fn().mockResolvedValue({ items: [completedReport], pageInfo: { hasNextPage: false, nextCursor: null } }),
    pollIntervalMs: 50,
    ...overrides,
  };
  render(<WorkspaceExperience {...props} />);
  return props;
}

describe('workspace experience', () => {
  it('shows role-aware workspace summaries and opens a manager command center', async () => {
    renderExperience();
    expect(await screen.findByRole('button', { name: /Open Product Delivery/i })).toBeInTheDocument();
    expect(screen.getByText('Developer access')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Open Product Delivery/i }));
    expect(await screen.findByRole('heading', { name: 'Product Delivery', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('@ali.dev')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'trace/web' })).toHaveAttribute('href', 'https://github.com/trace/web');
    expect(screen.getByRole('heading', { name: 'Manager tools' })).toBeInTheDocument();
  });

  it('shows safe repository-analysis run details without exposing source contents', async () => {
    const completedAnalysis = {
      ...analysis,
      status: 'COMPLETED' as const,
      baselineSha: 'a'.repeat(40),
      lastAnalyzedSha: 'a'.repeat(40),
      baselineCompletedAt: '2026-08-18T18:02:00.000Z',
      lastAnalyzedAt: '2026-08-18T18:02:00.000Z',
      coverage: { totalFiles: 12, eligibleFiles: 10, analyzedFiles: 10, excludedFiles: 2, totalBytes: 2048, analyzedBytes: 1024, truncatedFiles: 1 },
      latestRun: {
        id: 'run_completed', workspaceId: 'workspace_1', repositoryId: 'repo_1', kind: 'BASELINE' as const,
        fromSha: null, toSha: 'a'.repeat(40), dataCutoffAt: '2026-08-18T18:00:00.000Z', status: 'COMPLETED' as const,
        coverage: { totalFiles: 12, eligibleFiles: 10, analyzedFiles: 10, excludedFiles: 2, totalBytes: 2048, analyzedBytes: 1024, truncatedFiles: 1 },
        accessState: 'ACTIVE' as const, startedAt: '2026-08-18T18:00:00.000Z', completedAt: '2026-08-18T18:02:00.000Z', error: null,
      },
    };
    renderExperience({ loadAnalysis: vi.fn().mockResolvedValue({ items: [completedAnalysis] }) });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    await userEvent.click(await screen.findByText('View analysis details'));

    expect(screen.getByText('Baseline run')).toBeInTheDocument();
    expect(screen.getByText(`Commit ${'a'.repeat(8)}`)).toBeInTheDocument();
    expect(screen.getByText('10 analyzed · 10 eligible · 2 excluded · 1 truncated')).toBeInTheDocument();
    expect(screen.getByText('1,024 of 2,048 bytes analyzed')).toBeInTheDocument();
    expect(screen.getByText('Completed Aug 18, 2026 at 11:02:00 PM PKT')).toBeInTheDocument();
    expect(screen.queryByText(/source contents/i)).not.toBeInTheDocument();
  });

  it('offers a clear retry when repository code analysis fails', async () => {
    const failedAnalysis = { ...analysis, status: 'FAILED' as const, lastError: 'GitHub returned binary content for an eligible source file.' };
    const props = renderExperience({ loadAnalysis: vi.fn().mockResolvedValue({ items: [failedAnalysis] }) });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));

    expect(await screen.findByText('Code analysis did not complete.')).toBeInTheDocument();
    expect(screen.queryByText('Coverage is not available yet.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry code analysis for trace/web' }));
    expect(props.startBaseline).toHaveBeenCalledWith('workspace_1', 'repo_1', 'csrf-live', { signal: expect.any(AbortSignal) });
  });

  it('fails closed instead of rendering a poisoned stored repository URL', async () => {
    const poisoned = {
      ...managerDetail,
      repositories: [{ ...managerDetail.repositories[0]!, url: 'javascript:alert(document.domain)' }],
    } as WorkspaceDetailResponse;
    renderExperience({ loadWorkspace: vi.fn().mockResolvedValue(poisoned) });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));

    expect(await screen.findByRole('heading', { name: 'Product Delivery', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'trace/web' })).not.toBeInTheDocument();
  });

  it('creates a workspace and sends manager mutations with the session CSRF token', async () => {
    const props = renderExperience();
    await screen.findByText('Product Delivery');
    await userEvent.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Release Team');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(props.createWorkspace).toHaveBeenCalledWith({ name: 'Release Team' }, 'csrf-live');

    await userEvent.click(screen.getByRole('button', { name: /Open Product Delivery/i }));
    await screen.findByRole('heading', { name: 'Manager tools' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Trace username' }), 'new.developer');
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(props.addMember).toHaveBeenCalledWith('workspace_1', { username: 'new.developer', role: 'DEVELOPER' }, 'csrf-live', { signal: expect.any(AbortSignal) });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Repository' }), 'repo_2');
    await userEvent.click(screen.getByRole('button', { name: 'Assign repository' }));
    expect(props.assignRepository).toHaveBeenCalledWith('workspace_1', { repositoryId: 'repo_2' }, 'csrf-live', { signal: expect.any(AbortSignal) });
    expect(await screen.findByRole('status')).toHaveTextContent(/assigned trace\/api/i);
    expect(screen.getByText('3 members · 2 repositories')).toBeInTheDocument();
  });

  it('keeps developer workspaces read-only', async () => {
    renderExperience();
    await userEvent.click(await screen.findByRole('button', { name: /Open Mobile Team/i }));
    expect(await screen.findByText(/Developer access is read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manager tools' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Trace username' })).not.toBeInTheDocument();
  });

  it('clears stale protected detail when authorization changes', async () => {
    const loadWorkspace = vi.fn()
      .mockResolvedValueOnce(managerDetail)
      .mockRejectedValueOnce(new WorkspaceApiError('WORKSPACE_NOT_FOUND', 'This workspace is not available to your Trace account.', 404));
    renderExperience({ loadWorkspace });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    expect(await screen.findByText('@ali.dev')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await waitFor(() => expect(screen.queryByText('@ali.dev')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('not available');
  });

  it('exposes the complete Manager lifecycle and closes controls after archive', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderExperience();
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    await screen.findByRole('heading', { name: 'Manager tools' });

    const rename = screen.getByRole('textbox', { name: 'New workspace name' });
    await userEvent.clear(rename);
    await userEvent.type(rename, 'Delivery Platform');
    await userEvent.click(screen.getByRole('button', { name: 'Save workspace name' }));
    expect(props.updateWorkspace).toHaveBeenCalledWith('workspace_1', { name: 'Delivery Platform' }, 'csrf-live', { signal: expect.any(AbortSignal) });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role for @ali.dev' }), 'MANAGER');
    await waitFor(() => expect(props.updateMemberRole).toHaveBeenCalledWith('workspace_1', 'user_2', { role: 'MANAGER' }, 'csrf-live', { signal: expect.any(AbortSignal) }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove @ali.dev' }));
    expect(props.removeMember).toHaveBeenCalledWith('workspace_1', 'user_2', 'csrf-live', { signal: expect.any(AbortSignal) });

    await userEvent.click(screen.getByRole('button', { name: 'Remove repository trace/web' }));
    expect(props.removeRepository).toHaveBeenCalledWith('workspace_1', 'repo_1', 'csrf-live', { signal: expect.any(AbortSignal) });

    await userEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    expect(props.archiveWorkspace).toHaveBeenCalledWith('workspace_1', 'csrf-live', { signal: expect.any(AbortSignal) });
    expect(await screen.findByText(/Archived workspaces are read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manager tools' })).not.toBeInTheDocument();
  });

  it('shows Developers only completed workspace reports without fetching or rendering operations', async () => {
    const loadAnalysis = vi.fn();
    const loadSchedule = vi.fn();
    const loadOccurrences = vi.fn();
    const props = renderExperience({ loadAnalysis, loadSchedule, loadOccurrences });
    await userEvent.click(await screen.findByRole('button', { name: /Open Mobile Team/i }));

    expect(await screen.findByRole('link', { name: /Open completed report for August 18, 2026/i })).toHaveAttribute('href', '/workspaces/workspace_2/reports/report_2');
    expect(props.loadReports).toHaveBeenCalledWith('workspace_2', { limit: 100, status: 'completed' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(loadAnalysis).not.toHaveBeenCalled();
    expect(loadSchedule).not.toHaveBeenCalled();
    expect(loadOccurrences).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Repository analysis' })).not.toBeInTheDocument();
    expect(screen.queryByText('Recovery')).not.toBeInTheDocument();
    expect(screen.queryByText('Report generation failed safely.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Report schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start baseline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Report schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Report status' })).not.toBeInTheDocument();
  });

  it('lets archived Managers open completed historical reports without operational data or controls', async () => {
    const archived = { ...managerDetail, workspace: { ...managerSummary, archivedAt: '2026-08-18T09:00:00.000Z' } };
    const loadAnalysis = vi.fn();
    const loadSchedule = vi.fn();
    const loadOccurrences = vi.fn();
    const props = renderExperience({ loadWorkspace: vi.fn().mockResolvedValue(archived), loadAnalysis, loadSchedule, loadOccurrences });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));

    expect(await screen.findByRole('link', { name: /Open completed report for August 18, 2026/i })).toHaveAttribute('href', '/workspaces/workspace_1/reports/report_2');
    expect(props.loadReports).toHaveBeenCalledWith('workspace_1', { limit: 100, status: 'completed' }, expect.anything());
    expect(loadAnalysis).not.toHaveBeenCalled();
    expect(loadSchedule).not.toHaveBeenCalled();
    expect(loadOccurrences).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Repository analysis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Report status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manager tools' })).not.toBeInTheDocument();
  });

  it('keeps Manager occurrence report links inside the workspace boundary', async () => {
    renderExperience();
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    expect(await screen.findByRole('link', { name: 'Open report' })).toHaveAttribute('href', '/workspaces/workspace_1/reports/report_1');
  });

  it('lets Managers generate, start a baseline, configure selected weekdays, and disable the schedule', async () => {
    const props = renderExperience();
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    await screen.findByRole('heading', { name: 'Workspace reports' });

    await userEvent.click(screen.getByRole('button', { name: 'Generate now' }));
    expect(props.generateReport).toHaveBeenCalledWith('workspace_1', expect.objectContaining({ windowStart: expect.any(String), windowEnd: expect.any(String) }), expect.stringMatching(/^manual-/), 'csrf-live', { signal: expect.any(AbortSignal) });
    await userEvent.click(screen.getByRole('button', { name: 'Start baseline for trace/web' }));
    expect(props.startBaseline).toHaveBeenCalledWith('workspace_1', 'repo_1', 'csrf-live', { signal: expect.any(AbortSignal) });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Schedule frequency' }), 'SELECTED_DAYS');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Friday' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'IANA timezone' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'IANA timezone' }), 'UTC');
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(props.saveSchedule).toHaveBeenCalledWith('workspace_1', { enabled: true, frequency: 'SELECTED_DAYS', selectedDays: [1, 5], localTime: '09:30', timezone: 'UTC' }, 'csrf-live', { signal: expect.any(AbortSignal) });
    await userEvent.click(screen.getByRole('button', { name: 'Disable schedule' }));
    expect(props.disableSchedule).toHaveBeenCalledWith('workspace_1', 'csrf-live', { signal: expect.any(AbortSignal) });
    expect(await screen.findByRole('status')).toHaveTextContent(/schedule disabled/i);
  });

  it('clears all protected workspace reporting state when an auxiliary authorization request fails', async () => {
    const loadAnalysis = vi.fn()
      .mockResolvedValueOnce({ items: [analysis] })
      .mockRejectedValueOnce(new WorkspaceApiError('WORKSPACE_NOT_FOUND', 'This workspace is not available to your Trace account.', 404));
    renderExperience({ loadAnalysis });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    expect(await screen.findByText('trace/web', { selector: '.analysis-card strong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Workspace reports' })).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('not available');
  });

  it('aborts and ignores stale report completions after another workspace owns the view', async () => {
    let resolveReport!: (value: { occurrence: WorkspaceReportOccurrence }) => void;
    let mutationSignal: AbortSignal | undefined;
    const generateReport = vi.fn((_id, _input, _key, _csrf, options?: { signal?: AbortSignal }) => {
      mutationSignal = options?.signal;
      return new Promise<{ occurrence: WorkspaceReportOccurrence }>((resolve) => { resolveReport = resolve; });
    });
    renderExperience({ generateReport });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    await screen.findByRole('button', { name: 'Generate now' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate now' }));
    expect(mutationSignal).toBeInstanceOf(AbortSignal);
    await userEvent.click(screen.getByRole('button', { name: /Open Mobile Team/i }));
    await screen.findByRole('heading', { name: 'Mobile Team', level: 2 });
    expect(mutationSignal?.aborted).toBe(true);
    await act(async () => resolveReport({ occurrence: { ...occurrence, id: 'stale_manual', trigger: 'MANUAL', status: 'COMPLETED' } }));
    expect(screen.queryByText(/Report generation requested/i)).not.toBeInTheDocument();
  });

  it('clears Manager drafts and re-resolves membership after a deferred authorization failure', async () => {
    let rejectMutation!: (reason: unknown) => void;
    let mutationSignal: AbortSignal | undefined;
    const addMember = vi.fn((_id, _input, _csrf, options?: { signal?: AbortSignal }) => {
      mutationSignal = options?.signal;
      return new Promise<{ member: typeof managerDetail.members[number] }>((_resolve, reject) => { rejectMutation = reject; });
    });
    const developerDetail = { ...managerDetail, workspace: developerSummary };
    const loadWorkspace = vi.fn().mockResolvedValueOnce(managerDetail).mockResolvedValueOnce(developerDetail);
    renderExperience({ addMember, loadWorkspace });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    await screen.findByRole('heading', { name: 'Manager tools' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Trace username' }), 'late.developer');
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(mutationSignal).toBeInstanceOf(AbortSignal);

    await act(async () => rejectMutation(new WorkspaceApiError('WORKSPACE_MANAGER_REQUIRED', 'Only workspace managers can change members or repositories.', 403)));

    expect(await screen.findByText(/Developer access is read-only/i)).toBeInTheDocument();
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
    expect(mutationSignal?.aborted).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Trace username' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manager tools' })).not.toBeInTheDocument();
  });

  it('polls active states until terminal and stops after completion', async () => {
    const active = { ...occurrence, trigger: 'MANUAL' as const, status: 'PROCESSING' as const, error: null, recoveredAt: null };
    const loadOccurrences = vi.fn().mockResolvedValueOnce({ items: [active] }).mockResolvedValueOnce({ items: [{ ...active, status: 'COMPLETED' as const, completedAt: '2026-08-18T18:00:00.000Z' }] });
    renderExperience({ loadOccurrences, pollIntervalMs: 20 });
    await userEvent.click(await screen.findByRole('button', { name: /Open Product Delivery/i }));
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(loadOccurrences).toHaveBeenCalledTimes(2);
  });
});
