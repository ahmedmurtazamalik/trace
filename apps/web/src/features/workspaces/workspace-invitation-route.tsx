'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptWorkspaceInvitation,
  declineWorkspaceInvitation,
  getWorkspaceInvitation,
  listMyWorkspaceInvitations,
} from '@/api/workspaces';
import { useAuthSession } from '@/auth/session-provider';
import { WorkspaceInvitationCenter } from './workspace-invitation-center';

const TOKEN_FRAGMENT = /^#token=([A-Za-z0-9_-]{43})$/;

export function WorkspaceInvitationRoute({ invitationId }: { invitationId: string }) {
  const { user, csrfToken } = useAuthSession();
  const [token, setToken] = useState<string | null>();

  useEffect(() => {
    const match = TOKEN_FRAGMENT.exec(window.location.hash);
    setToken(match?.[1] ?? null);
  }, []);

  const loadInvitation = useCallback(
    (id: string, options?: { signal?: AbortSignal }) => {
      if (!token) return Promise.reject(new Error('Missing invitation token'));
      return getWorkspaceInvitation(id, token, options);
    },
    [token],
  );
  const acceptInvitation = useCallback(
    (id: string, csrfToken: string, options?: { signal?: AbortSignal }) => {
      if (!token) return Promise.reject(new Error('Missing invitation token'));
      return acceptWorkspaceInvitation(id, csrfToken, token, options);
    },
    [token],
  );
  const declineInvitation = useCallback(
    (id: string, csrfToken: string, options?: { signal?: AbortSignal }) => {
      if (!token) return Promise.reject(new Error('Missing invitation token'));
      return declineWorkspaceInvitation(id, csrfToken, token, options);
    },
    [token],
  );

  if (!user || !csrfToken) return null;
  if (token === undefined) return <div className="session-loading" role="status">Checking invitation link…</div>;
  if (token === null) {
    return <section className="workspace-invitation-center"><div className="error-banner" role="alert">This invitation link is incomplete or invalid. Ask the workspace manager for a fresh link, or use your in-app invitation inbox.</div></section>;
  }

  return <WorkspaceInvitationCenter
    csrfToken={csrfToken}
    invitationId={invitationId}
    loadInvitations={listMyWorkspaceInvitations}
    loadInvitation={loadInvitation}
    acceptInvitation={acceptInvitation}
    declineInvitation={declineInvitation}
  />;
}
