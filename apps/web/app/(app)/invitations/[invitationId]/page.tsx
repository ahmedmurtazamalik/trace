'use client';

import { use } from 'react';
import { PageShell } from '@/components/page-shell';
import { WorkspaceInvitationRoute } from '@/features/workspaces/workspace-invitation-route';

export default function WorkspaceInvitationPage({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = use(params);
  return <PageShell eyebrow="Workspace invitation" title="Review invitation" description="Review who invited you and choose whether to join. Workspace access begins only after you accept.">
    <WorkspaceInvitationRoute invitationId={invitationId} />
  </PageShell>;
}
