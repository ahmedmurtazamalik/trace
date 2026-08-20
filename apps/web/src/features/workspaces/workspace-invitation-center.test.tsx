import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceInvitation } from '@trace/shared';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceInvitationCenter } from './workspace-invitation-center';

const invitation: WorkspaceInvitation = {
  id: 'invitation_1', workspace: { id: 'workspace_1', name: 'Product Delivery' },
  invitedUser: { id: 'user_2', username: 'ali.dev', displayName: null },
  invitedBy: { id: 'user_1', username: 'manager.dev', displayName: 'Manager Dev' },
  role: 'DEVELOPER', status: 'PENDING', acceptancePath: '/invitations/invitation_1',
  expiresAt: '2026-08-27T08:00:00.000Z', createdAt: '2026-08-20T08:00:00.000Z',
  acceptedAt: null, declinedAt: null, revokedAt: null,
};
const member = { userId: 'user_2', username: 'ali.dev', displayName: null, role: 'DEVELOPER' as const, joinedAt: '2026-08-20T08:05:00.000Z' };

describe('WorkspaceInvitationCenter', () => {
  it('shows the signed-in user pending invitations and creates membership only after explicit acceptance', async () => {
    const accept = vi.fn().mockResolvedValue({ invitation: { ...invitation, status: 'ACCEPTED', acceptedAt: '2026-08-20T08:05:00.000Z' }, member });
    const onAccepted = vi.fn();
    render(<WorkspaceInvitationCenter csrfToken="csrf-live" loadInvitations={vi.fn().mockResolvedValue({ items: [invitation] })} loadInvitation={vi.fn()} acceptInvitation={accept} declineInvitation={vi.fn()} onAccepted={onAccepted} />);

    expect(await screen.findByRole('heading', { name: 'Workspace invitations' })).toBeInTheDocument();
    expect(screen.getByText('Product Delivery')).toBeInTheDocument();
    expect(screen.getByText(/Manager Dev invited you as a Developer/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept Product Delivery invitation' }));

    expect(accept).toHaveBeenCalledWith('invitation_1', 'csrf-live', { signal: expect.any(AbortSignal) });
    expect(onAccepted).toHaveBeenCalledWith('workspace_1');
    expect(await screen.findByRole('status')).toHaveTextContent(/joined Product Delivery/i);
    expect(screen.getByRole('link', { name: 'Open Product Delivery workspace' })).toHaveAttribute('href', '/workspaces');
  });

  it('supports a direct copyable link and decline without creating membership', async () => {
    const decline = vi.fn().mockResolvedValue({ invitation: { ...invitation, status: 'DECLINED', declinedAt: '2026-08-20T08:05:00.000Z' } });
    const loadInvitation = vi.fn().mockResolvedValue({ invitation });
    render(<WorkspaceInvitationCenter invitationId="invitation_1" csrfToken="csrf-live" loadInvitations={vi.fn()} loadInvitation={loadInvitation} acceptInvitation={vi.fn()} declineInvitation={decline} />);

    expect(await screen.findByText('Invitation to Product Delivery')).toBeInTheDocument();
    expect(loadInvitation).toHaveBeenCalledWith('invitation_1', { signal: expect.any(AbortSignal) });
    await userEvent.click(screen.getByRole('button', { name: 'Decline Product Delivery invitation' }));
    expect(decline).toHaveBeenCalledWith('invitation_1', 'csrf-live', { signal: expect.any(AbortSignal) });
    expect(await screen.findByRole('status')).toHaveTextContent(/declined/i);
    expect(screen.queryByRole('link', { name: /Open Product Delivery workspace/i })).not.toBeInTheDocument();
  });

  it('renders a safe unavailable state for expired, revoked, or wrong-account links', async () => {
    render(<WorkspaceInvitationCenter invitationId="unknown" csrfToken="csrf-live" loadInvitations={vi.fn()} loadInvitation={vi.fn().mockRejectedValue(new Error('not found'))} acceptInvitation={vi.fn()} declineInvitation={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation is unavailable');
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });
});
