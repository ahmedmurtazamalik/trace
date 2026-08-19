'use client';

import { useAuthSession } from '@/auth/session-provider';
import { listRepositories } from '@/api/repositories';
import {
  addWorkspaceMember,
  archiveWorkspace,
  assignWorkspaceRepository,
  createWorkspace,
  disableWorkspaceReportSchedule,
  generateWorkspaceReport,
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
} from '@/api/workspaces';
import { WorkspaceExperience } from './workspace-experience';

export function WorkspaceRoute() {
  const { csrfToken } = useAuthSession();
  if (!csrfToken) return <div className="inline-alert error" role="alert">Authenticated session is missing CSRF protection.</div>;
  return <WorkspaceExperience
    csrfToken={csrfToken}
    loadWorkspaces={listWorkspaces}
    loadWorkspace={getWorkspace}
    createWorkspace={createWorkspace}
    addMember={addWorkspaceMember}
    assignRepository={assignWorkspaceRepository}
    updateWorkspace={updateWorkspace}
    archiveWorkspace={archiveWorkspace}
    updateMemberRole={updateWorkspaceMemberRole}
    removeMember={removeWorkspaceMember}
    removeRepository={removeWorkspaceRepository}
    loadRepositories={(query, options) => listRepositories(query, options)}
    loadAnalysis={getWorkspaceAnalysis}
    startBaseline={startWorkspaceBaseline}
    generateReport={generateWorkspaceReport}
    loadSchedule={getWorkspaceReportSchedule}
    saveSchedule={updateWorkspaceReportSchedule}
    disableSchedule={disableWorkspaceReportSchedule}
    loadOccurrences={listWorkspaceReportOccurrences}
    loadReports={listWorkspaceReports}
  />;
}
