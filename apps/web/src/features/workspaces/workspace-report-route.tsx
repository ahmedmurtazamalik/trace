'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReportArtifact, WorkspaceReportDetailResponse, ReportRegenerationRequest, ReportRegenerationResponse, ReportRevisionUpdateRequest, ReportRevisionUpdateResponse, WorkspaceDetailResponse } from '@trace/shared';
import { Card } from '@trace/ui';
import { useAuthSession } from '@/auth/session-provider';
import {
  downloadWorkspaceReportArtifact,
  getWorkspace,
  getWorkspaceReport,
  regenerateWorkspaceReport,
  updateWorkspaceReportRevision,
  WorkspaceApiError,
  type DownloadedWorkspaceReportArtifact,
} from '@/api/workspaces';
import { ReportDetailView } from '@/features/reports/report-detail';

interface WorkspaceReportClients {
  loadWorkspace(workspaceId: string, options?: { signal?: AbortSignal }): Promise<WorkspaceDetailResponse>;
  loadReport(workspaceId: string, reportId: string, signal?: AbortSignal): Promise<WorkspaceReportDetailResponse>;
  saveRevision(workspaceId: string, reportId: string, input: ReportRevisionUpdateRequest, csrfToken: string, signal?: AbortSignal): Promise<ReportRevisionUpdateResponse>;
  regenerateReport(workspaceId: string, reportId: string, input: ReportRegenerationRequest, csrfToken: string, signal?: AbortSignal): Promise<ReportRegenerationResponse>;
  downloadArtifact(workspaceId: string, reportId: string, artifact: ReportArtifact, signal?: AbortSignal): Promise<DownloadedWorkspaceReportArtifact>;
}

const liveClients: WorkspaceReportClients = {
  loadWorkspace: getWorkspace,
  loadReport: (workspaceId, reportId, signal) => getWorkspaceReport(workspaceId, reportId, { signal }),
  saveRevision: (workspaceId, reportId, input, csrfToken, signal) => updateWorkspaceReportRevision(workspaceId, reportId, input, csrfToken, { signal }),
  regenerateReport: (workspaceId, reportId, input, csrfToken, signal) => regenerateWorkspaceReport(workspaceId, reportId, input, csrfToken, { signal }),
  downloadArtifact: (workspaceId, reportId, artifact, signal) => downloadWorkspaceReportArtifact(workspaceId, reportId, artifact, { signal }),
};

function boundaryMessage(reason: unknown) {
  if (reason instanceof WorkspaceApiError) {
    if (reason.code === 'UNAUTHENTICATED') return 'Your session expired. Sign in again to open this workspace report.';
    return reason.message;
  }
  return 'Trace could not verify access to this workspace report. Try again.';
}

export function WorkspaceReportRoute({ workspaceId, reportId, clients = liveClients }: { workspaceId: string; reportId: string; clients?: WorkspaceReportClients }) {
  const { csrfToken } = useAuthSession();
  const [workspace, setWorkspace] = useState<WorkspaceDetailResponse['workspace']>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(undefined);
    setError(undefined);
    setLoading(true);
    clients.loadWorkspace(workspaceId, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setWorkspace(response.workspace); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(boundaryMessage(reason));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clients, workspaceId]);

  if (loading) return <Card className="report-state-card" role="status">Verifying workspace access…</Card>;
  if (error || !workspace) return <Card className="report-state-card report-state-error" role="alert">{error ?? 'This workspace report is unavailable.'}</Card>;

  const canManage = workspace.role === 'MANAGER' && workspace.archivedAt === null && Boolean(csrfToken);
  const loadReport = (id: string, signal?: AbortSignal) => clients.loadReport(workspaceId, id, signal);
  const saveRevision = canManage ? (id: string, input: ReportRevisionUpdateRequest, signal?: AbortSignal) => clients.saveRevision(workspaceId, id, input, csrfToken!, signal) : undefined;
  const regenerate = canManage ? (id: string, input: ReportRegenerationRequest, signal?: AbortSignal) => clients.regenerateReport(workspaceId, id, input, csrfToken!, signal) : undefined;
  const download = (id: string, artifact: ReportArtifact, signal?: AbortSignal) => clients.downloadArtifact(workspaceId, id, artifact, signal);

  return <div className="workspace-report-detail">
    <div className="workspace-report-context"><div><span className="eyebrow">{workspace.role === 'MANAGER' ? 'Manager access' : 'Developer access'}</span><h2>{workspace.name}</h2><p>This report stays inside the workspace authorization boundary.</p></div><Link href="/workspaces">Back to workspaces</Link></div>
    {workspace.role === 'MANAGER' && !csrfToken ? <div className="inline-alert error" role="alert">Your security session expired. Refresh the page before editing or regenerating; read-only report access remains available.</div> : null}
    {workspace.archivedAt ? <div className="inline-alert" role="status">This workspace is archived. Historical reports remain available, but changes are disabled.</div> : null}
    <ReportDetailView reportId={reportId} loadReport={loadReport} saveRevision={saveRevision} regenerateReport={regenerate} downloadArtifact={download} />
  </div>;
}