'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card } from '@trace/ui';
import type {
  WorkspaceInvitation,
  WorkspaceInvitationAcceptResponse,
  WorkspaceInvitationDecisionResponse,
  WorkspaceInvitationDetailResponse,
  WorkspaceInvitationListResponse,
} from '@trace/shared';

interface WorkspaceInvitationCenterProps {
  csrfToken: string;
  invitationId?: string;
  loadInvitations(options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationListResponse>;
  loadInvitation(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationDetailResponse>;
  acceptInvitation(id: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationAcceptResponse>;
  declineInvitation(id: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationDecisionResponse>;
  onAccepted?(workspaceId: string): void;
}

function roleLabel(role: WorkspaceInvitation['role']) {
  return role === 'MANAGER' ? 'Manager' : 'Developer';
}

function statusLabel(status: WorkspaceInvitation['status']) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function WorkspaceInvitationCenter({
  csrfToken,
  invitationId,
  loadInvitations,
  loadInvitation,
  acceptInvitation,
  declineInvitation,
  onAccepted,
}: WorkspaceInvitationCenterProps) {
  const [items, setItems] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [joinedWorkspaceId, setJoinedWorkspaceId] = useState<string>();
  const mutationController = useRef<AbortController>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    const request = invitationId
      ? loadInvitation(invitationId, { signal: controller.signal }).then((response) => [response.invitation])
      : loadInvitations({ signal: controller.signal }).then((response) => response.items);
    request.then(setItems).catch((reason: unknown) => {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setItems([]);
        setError(invitationId ? 'This invitation is unavailable. It may be expired, revoked, already used, or intended for another Trace account.' : 'Trace could not load your workspace invitations. Please try again.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [invitationId, loadInvitation, loadInvitations]);

  useEffect(() => () => mutationController.current?.abort(), []);

  async function decide(invitation: WorkspaceInvitation, decision: 'accept' | 'decline') {
    mutationController.current?.abort();
    const controller = new AbortController();
    mutationController.current = controller;
    setSubmittingId(invitation.id);
    setError(undefined);
    setStatus(undefined);
    try {
      const response = decision === 'accept'
        ? await acceptInvitation(invitation.id, csrfToken, { signal: controller.signal })
        : await declineInvitation(invitation.id, csrfToken, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems((current) => current.map((item) => item.id === invitation.id ? response.invitation : item));
      if (decision === 'accept') {
        setJoinedWorkspaceId(invitation.workspace.id);
        setStatus(`You joined ${invitation.workspace.name}.`);
        onAccepted?.(invitation.workspace.id);
      } else {
        setStatus(`You declined the invitation to ${invitation.workspace.name}.`);
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError('Trace could not complete this invitation decision. Refresh the invitation and try again.');
      }
    } finally {
      if (mutationController.current === controller) {
        mutationController.current = undefined;
        setSubmittingId(undefined);
      }
    }
  }

  return <section className="workspace-invitation-center" aria-labelledby={invitationId ? 'workspace-invitation-title' : 'workspace-invitations-title'}>
    <div className="section-heading-row">
      <div><span className="eyebrow">Consent required</span><h2 id={invitationId ? 'workspace-invitation-title' : 'workspace-invitations-title'}>{invitationId && items[0] ? `Invitation to ${items[0].workspace.name}` : 'Workspace invitations'}</h2></div>
      {!invitationId ? <Badge>{items.filter((item) => item.status === 'PENDING').length} pending</Badge> : null}
    </div>
    {error ? <div className="inline-alert error" role="alert">{error}</div> : null}
    {status ? <div className="inline-alert success" role="status">{status}{joinedWorkspaceId ? <> <Link aria-label={`Open ${items.find((item) => item.workspace.id === joinedWorkspaceId)?.workspace.name ?? 'joined'} workspace`} href="/workspaces">Open workspace</Link></> : null}</div> : null}
    {loading ? <Card><p>Loading invitations…</p></Card>
      : !error && items.length === 0 ? <Card className="empty-state"><h3>No workspace invitations</h3><p>New invitations from Trace Managers will appear here.</p></Card>
      : <div className="workspace-invitation-grid">{items.map((invitation) => <Card key={invitation.id} className="workspace-invitation-card">
        <div className="workspace-card-heading"><Badge>{roleLabel(invitation.role)}</Badge><Badge>{statusLabel(invitation.status)}</Badge></div>
        <h3>{invitation.workspace.name}</h3>
        <p>{invitation.invitedBy.displayName ?? `@${invitation.invitedBy.username}`} invited you as a {roleLabel(invitation.role)}.</p>
        <p className="muted">Membership and workspace access begin only if you accept.</p>
        {invitation.status === 'PENDING' ? <div className="workspace-row-actions">
          <Button type="button" disabled={Boolean(submittingId)} aria-label={`Accept ${invitation.workspace.name} invitation`} onClick={() => void decide(invitation, 'accept')}>Accept</Button>
          <Button className="secondary" type="button" disabled={Boolean(submittingId)} aria-label={`Decline ${invitation.workspace.name} invitation`} onClick={() => void decide(invitation, 'decline')}>Decline</Button>
        </div> : null}
      </Card>)}</div>}
  </section>;
}
