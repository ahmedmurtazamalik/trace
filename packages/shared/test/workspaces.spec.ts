import {
  workspaceAddMemberRequestSchema,
  workspaceAssignRepositoryRequestSchema,
  workspaceCreateRequestSchema,
  workspaceCreateResponseSchema,
  workspaceDetailResponseSchema,
  workspaceErrorCodeSchema,
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

  it('freezes membership and repository mutations', () => {
    expect(workspaceAddMemberRequestSchema.parse({ username: ' ali.dev ', role: 'DEVELOPER' })).toEqual({ username: 'ali.dev', role: 'DEVELOPER' });
    expect(workspaceMemberRoleUpdateRequestSchema.parse({ role: 'MANAGER' })).toEqual({ role: 'MANAGER' });
    expect(workspaceMemberRoleUpdateRequestSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
    expect(workspaceAssignRepositoryRequestSchema.parse({ repositoryId: 'repo_1' })).toEqual({ repositoryId: 'repo_1' });
    expect(workspaceAssignRepositoryRequestSchema.safeParse({ repositoryId: '', trackingEnabled: true }).success).toBe(false);
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
    ]) {
      expect(workspaceErrorCodeSchema.parse(code)).toBe(code);
    }
    expect(workspaceErrorCodeSchema.safeParse('USER_EXISTS').success).toBe(false);
  });
});
