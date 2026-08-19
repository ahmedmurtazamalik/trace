'use client';

import { use } from 'react';
import { PageShell } from '@/components/page-shell';
import { WorkspaceReportRoute } from '@/features/workspaces/workspace-report-route';

export default function WorkspaceReportPage({ params }: { params: Promise<{ workspaceId: string; reportId: string }> }) {
  const { workspaceId, reportId } = use(params);
  return <PageShell eyebrow="Workspace evidence" title="Workspace report" description="Review the current authorized report snapshot, verified files, and role-appropriate actions.">
    <WorkspaceReportRoute workspaceId={workspaceId} reportId={reportId} />
  </PageShell>;
}