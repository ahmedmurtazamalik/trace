import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceReportDetailResponse, WorkspaceDetailResponse } from '@trace/shared';
import { AuthSessionProvider } from '@/auth/session-provider';
import { WorkspaceReportRoute } from './workspace-report-route';

const session = {
  user: { id: 'user_1', username: 'ali.manager', displayName: 'Ali', email: null, createdAt: '2026-08-18T00:00:00.000Z' },
  csrfToken: 'csrf-live', expiresAt: '2026-08-19T00:00:00.000Z',
};
const workspace = (role: 'MANAGER' | 'DEVELOPER'): WorkspaceDetailResponse => ({
  workspace: { id: 'workspace/1', name: 'Product Delivery', slug: 'product-delivery', role, memberCount: 2, repositoryCount: 1, archivedAt: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' },
  members: [], repositories: [],
});
const report: WorkspaceReportDetailResponse = { report: {
  id: 'report/1', reportDate: '2026-08-18', timezone: 'UTC', status: 'completed', createdAt: '2026-08-18T00:00:00.000Z', completedAt: '2026-08-18T01:00:00.000Z', errorMessage: null,
  revision: 1, downloadAvailable: true, revisionSource: 'ai', content: { executiveSummary: 'No code activity was recorded.', repositories: [] },
  facts: { repositoryCount: 1, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  artifacts: [{ id: 'pdf-1', revision: 1, kind: 'pdf', fileName: 'workspace-report.pdf', contentType: 'application/pdf', sizeBytes: 4, checksum: 'a'.repeat(64) }],
}, workspaceEvidence: {
  workspaceId: 'workspace/1', workspaceName: 'Product Delivery', trigger: 'RECOVERY', scheduleVersion: 2,
  scheduledFor: '2026-08-18T17:00:00.000Z', intendedLocalDateTime: '2026-08-18T17:00',
  windowStart: '2026-08-17T17:00:00.000Z', windowEnd: '2026-08-18T17:00:00.000Z', dataCutoffAt: '2026-08-18T17:00:00.000Z',
  recoveredAt: '2026-08-18T17:01:00.000Z', noActivity: true,
  repositories: [{ repositoryId: 'repo-1', fullName: 'trace/web', accessState: 'ACCESS_REMOVED', coverage: null, baselineOnly: false, activityCount: 0 }],
} };

function renderRoute(role: 'MANAGER' | 'DEVELOPER', reportResponse: WorkspaceReportDetailResponse = report) {
  const clients = {
    loadWorkspace: vi.fn().mockResolvedValue(workspace(role)),
    loadReport: vi.fn().mockResolvedValue(reportResponse),
    saveRevision: vi.fn().mockResolvedValue(report),
    regenerateReport: vi.fn().mockResolvedValue(report),

    downloadArtifact: vi.fn().mockResolvedValue({ blob: new Blob(['pdf']), fileName: 'workspace-report.pdf' }),
  };
  render(<AuthSessionProvider initialSession={session}><WorkspaceReportRoute workspaceId="workspace/1" reportId="report/1" clients={clients} /></AuthSessionProvider>);
  return clients;
}

describe('workspace report route', () => {
  it('gives Developers completed report content and download without edit or regenerate operations', async () => {
    const clients = renderRoute('DEVELOPER');
    expect(await screen.findByText('No activity recorded')).toBeInTheDocument();
    expect(screen.getByText('Revision 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Code analysis' })).toBeInTheDocument();
    expect(screen.getByText('No repository analysis is available for this report.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Executive summary' })).toBeInTheDocument();
    expect(screen.getByText('No code activity was recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Frozen report evidence' })).not.toBeInTheDocument();
    expect(screen.queryByText(/manager-1|idempotency|provider failure/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate report' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Structured report editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(clients.downloadArtifact).toHaveBeenCalled());
  });

  it('keeps report actions unavailable while a report with an older PDF is processing', async () => {
    const processing: WorkspaceReportDetailResponse = {
      ...report,
      report: { ...report.report, status: 'processing', completedAt: null },
    };
    renderRoute('MANAGER', processing);

    expect(await screen.findByText('Building your report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate report' })).toBeDisabled();
  });

  it('provides Manager-only regeneration and read-only report content without exposing the removed narrative editor', async () => {
    const clients = renderRoute('MANAGER');
    await screen.findByRole('heading', { name: 'Code analysis' });
    expect(screen.getByLabelText('Executive summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save revision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to Slack' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate report' }));
    await waitFor(() => expect(clients.regenerateReport).toHaveBeenCalledWith('workspace/1', 'report/1', { expectedRevision: 1 }, 'csrf-live', expect.any(AbortSignal)));
  });
});