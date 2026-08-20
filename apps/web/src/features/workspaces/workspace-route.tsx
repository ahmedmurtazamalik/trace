'use client';

import { useState } from 'react';
import { useAuthSession } from '@/auth/session-provider';
import { listRepositories } from '@/api/repositories';
import {
  acceptWorkspaceInvitation,
  archiveWorkspace,
  assignWorkspaceRepository,
  createWorkspace,
  createWorkspaceInvitation,
  declineWorkspaceInvitation,
  disableWorkspaceReportSchedule,
  generateWorkspaceReport,
  getWorkspace,
  getWorkspaceAnalysis,
  getWorkspaceInvitation,
  getWorkspaceReportSchedule,
  listMyWorkspaceInvitations,
  listWorkspaceInvitations,
  listWorkspaceReportOccurrences,
  listWorkspaceReports,
  listWorkspaces,
  removeWorkspaceMember,
  removeWorkspaceRepository,
  revokeWorkspaceInvitation,
  updateWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceReportSchedule,
  startWorkspaceBaseline,
} from '@/api/workspaces';
import { WorkspaceExperience } from './workspace-experience';
import { WorkspaceInvitationCenter } from './workspace-invitation-center';

export function WorkspaceRoute() {
  const { csrfToken } = useAuthSession();
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  if (!csrfToken) return <div className="inline-alert error" role="alert">Authenticated session is missing CSRF protection.</div>;
  return <>
    <WorkspaceInvitationCenter csrfToken={csrfToken} loadInvitations={listMyWorkspaceInvitations} loadInvitation={getWorkspaceInvitation} acceptInvitation={acceptWorkspaceInvitation} declineInvitation={declineWorkspaceInvitation} onAccepted={() => setWorkspaceVersion((current) => current + 1)} />
    <WorkspaceExperience
    key={workspaceVersion}
    csrfToken={csrfToken}
    loadWorkspaces={listWorkspaces}
    loadWorkspace={getWorkspace}
    createWorkspace={createWorkspace}
    createInvitation={createWorkspaceInvitation}
    loadInvitations={listWorkspaceInvitations}
    revokeInvitation={revokeWorkspaceInvitation}
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
    />
  </>;
}
