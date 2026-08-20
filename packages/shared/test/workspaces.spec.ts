import {
  workspaceAssignRepositoryRequestSchema,
  workspaceCreateRequestSchema,
  workspaceCreateResponseSchema,
  workspaceDetailResponseSchema,
  workspaceErrorCodeSchema,
  workspaceInvitationAcceptResponseSchema,
  workspaceInvitationCreateRequestSchema,
  workspaceInvitationCreateResponseSchema,
  workspaceInvitationListResponseSchema,
  workspaceInvitationStatusSchema,
  workspaceListResponseSchema,
  workspaceMemberRoleUpdateRequestSchema,
  workspaceRoleSchema,
  workspaceUpdateRequestSchema,
} from '../src/workspaces';

const summary = {
  id: 'workspace_1',
  name: 'Product Delivery',
  slug: 'product-delivery-a1b2c3',
  role: 'MANAGER' as const,
  memberCount: 2,
  repositoryCount: 1,
  archivedAt: null,
  createdAt: '2026-08-18T08:00:00.000Z',
  updatedAt: '2026-08-18T08:00:00.000Z',
};

describe('workspace contract', () => {
  it('allows exactly Manager and Developer roles', () => {
    expect(workspaceRoleSchema.options).toEqual(['MANAGER', 'DEVELOPER']);
    expect(workspaceRoleSchema.safeParse('OWNER').success).toBe(false);
    expect(workspaceRoleSchema.safeParse('ADMIN').success).toBe(false);
  });

  it('accepts bounded names and strict lifecycle mutations', () => {
    expect(workspaceCreateRequestSchema.parse({ name: '  Product Delivery  ' })).toEqual({ name: 'Product Delivery' });
    expect(workspaceCreateRequestSchema.safeParse({ name: 'ab' }).success).toBe(false);
    expect(workspaceCreateRequestSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(workspaceCreateRequestSchema.safeParse({ name: 'Product Delivery', owner: 'user_2' }).success).toBe(false);
    expect(workspaceUpdateRequestSchema.parse({ name: '  Platform  ' })).toEqual({ name: 'Platform' });
    expect(workspaceUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(workspaceUpdateRequestSchema.safeParse({ archived: true }).success).toBe(false);
  });

  it('freezes invitation, membership, and repository mutations', () => {
    expect(workspaceInvitationCreateRequestSchema.parse({ username: ' ali.dev ', role: 'DEVELOPER' })).toEqual({ username: 'ali.dev', role: 'DEVELOPER' });
    expect(workspaceInvitationCreateRequestSchema.safeParse({ username: 'ali.dev', role: 'DEVELOPER', invitedUserId: 'user_2' }).success).toBe(false);
    expect(workspaceMemberRoleUpdateRequestSchema.parse({ role: 'MANAGER' })).toEqual({ role: 'MANAGER' });
    expect(workspaceMemberRoleUpdateRequestSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
    expect(workspaceAssignRepositoryRequestSchema.parse({ repositoryId: 'repo_1' })).toEqual({ repositoryId: 'repo_1' });
    expect(workspaceAssignRepositoryRequestSchema.safeParse({ repositoryId: '', trackingEnabled: true }).success).toBe(false);
  });

  it('freezes consent-based invitation responses without exposing credentials', () => {
    expect(workspaceInvitationStatusSchema.options).toEqual(['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED']);
    const invitation = {
      id: 'invitation_1',
      workspace: { id: 'workspace_1', name: 'Product Delivery' },
      invitedUser: { id: 'user_2', username: 'ali.dev', displayName: null },
      invitedBy: { id: 'user_1', username: 'manager.dev', displayName: 'Manager Dev' },
      role: 'DEVELOPER' as const,
      status: 'PENDING' as const,
      acceptancePath: '/invitations/invitation_1',
      expiresAt: '2026-08-27T08:00:00.000Z',
      createdAt: '2026-08-20T08:00:00.000Z',
      acceptedAt: null,
      declinedAt: null,
      revokedAt: null,
    };
    const copyablePath = '/invitations/invitation_1#token=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
    expect(workspaceInvitationCreateResponseSchema.parse({ invitation, copyablePath })).toEqual({ invitation, copyablePath });
    expect(workspaceInvitationCreateResponseSchema.safeParse({ invitation, copyablePath: '/invitations/invitation_1#token=short' }).success).toBe(false);
    expect(workspaceInvitationListResponseSchema.parse({ items: [invitation] })).toEqual({ items: [invitation] });
    expect(workspaceInvitationAcceptResponseSchema.parse({
      invitation: { ...invitation, status: 'ACCEPTED', acceptedAt: '2026-08-20T08:05:00.000Z' },
      member: { userId: 'user_2', username: 'ali.dev', displayName: null, role: 'DEVELOPER', joinedAt: '2026-08-20T08:05:00.000Z' },
    }).member.userId).toBe('user_2');
    expect(workspaceInvitationCreateResponseSchema.safeParse({ invitation: { ...invitation, token: 'secret' } }).success).toBe(false);
  });

  it('freezes strict list, create, and member-readable detail responses', () => {
    expect(workspaceListResponseSchema.parse({ items: [summary] })).toEqual({ items: [summary] });
    expect(workspaceCreateResponseSchema.parse({ workspace: summary })).toEqual({ workspace: summary });
    const detail = {
      workspace: summary,
      members: [
        { userId: 'user_1', username: 'manager.dev', displayName: 'Manager Dev', role: 'MANAGER', joinedAt: '2026-08-18T08:00:00.000Z' },
        { userId: 'user_2', username: 'ali.dev', displayName: null, role: 'DEVELOPER', joinedAt: '2026-08-18T08:05:00.000Z' },
      ],
      repositories: [{
        id: 'repo_1',
        fullName: 'trace/web',
        private: true,
        defaultBranch: 'main',
        url: 'https://github.com/trace/web',
        accessState: 'ACTIVE',
      }],
    };
    expect(workspaceDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(workspaceDetailResponseSchema.safeParse({ ...detail, secret: 'hidden' }).success).toBe(false);
  });

  it('keeps workspace failures closed and enumerable', () => {
    for (const code of [
      'WORKSPACE_NOT_FOUND',
      'WORKSPACE_MANAGER_REQUIRED',
      'WORKSPACE_ARCHIVED',
      'WORKSPACE_MEMBER_NOT_FOUND',
      'WORKSPACE_MEMBER_EXISTS',
      'WORKSPACE_LAST_MANAGER_REQUIRED',
      'WORKSPACE_REPOSITORY_NOT_AVAILABLE',
      'WORKSPACE_REPOSITORY_NOT_ASSIGNED',
      'WORKSPACE_INVITATION_NOT_FOUND',
      'WORKSPACE_INVITATION_EXISTS',
      'WORKSPACE_INVITATION_EXPIRED',
      'WORKSPACE_INVITATION_NOT_PENDING',
      'WORKSPACE_INVITATION_TARGET_INVALID',
    ]) {
      expect(workspaceErrorCodeSchema.parse(code)).toBe(code);
    }
    expect(workspaceErrorCodeSchema.safeParse('USER_EXISTS').success).toBe(false);
  });
});
