import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const prefix = 'workspace-invitation-test';

async function clean(): Promise<void> {
  await prisma.workspace.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
}

describe('workspace invitation database lifecycle', () => {
  beforeAll(async () => prisma.$connect());
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('persists a unique SHA-256 token hash and never needs the raw invitation secret', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'workspace_invitations' AND column_name = 'token_hash'
    `;
    expect(columns).toEqual([{ column_name: 'token_hash', is_nullable: 'NO' }]);
  });

  it('stores invitation identity and accepted-membership provenance without changing existing memberships', async () => {
    const [manager, recipient] = await Promise.all([
      prisma.user.create({ data: { username: `${prefix}.manager`, passwordHash: 'test-only' } }),
      prisma.user.create({ data: { username: `${prefix}.recipient`, passwordHash: 'test-only' } }),
    ]);
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Invitation Team',
        slug: `${prefix}-provenance`,
        createdById: manager.id,
        memberships: { create: { userId: manager.id, role: 'MANAGER' } },
      },
      include: { memberships: true },
    });
    expect(workspace.memberships[0]).toMatchObject({ userId: manager.id, invitationId: null });

    const invitation = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        invitedUserId: recipient.id,
        invitedById: manager.id,
        role: 'DEVELOPER',
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-08-27T08:00:00.000Z'),
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: recipient.id, role: invitation.role, invitationId: invitation.id },
    });
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date('2026-08-20T08:05:00.000Z') },
    });

    expect(membership.invitationId).toBe(invitation.id);
    await expect(prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: recipient.id, role: 'DEVELOPER', invitationId: invitation.id },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('permits only one pending invitation per workspace recipient while preserving terminal history', async () => {
    const [manager, recipient] = await Promise.all([
      prisma.user.create({ data: { username: `${prefix}.manager2`, passwordHash: 'test-only' } }),
      prisma.user.create({ data: { username: `${prefix}.recipient2`, passwordHash: 'test-only' } }),
    ]);
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Invitation Uniqueness',
        slug: `${prefix}-uniqueness`,
        createdById: manager.id,
        memberships: { create: { userId: manager.id, role: 'MANAGER' } },
      },
    });
    const data = {
      workspaceId: workspace.id,
      invitedUserId: recipient.id,
      invitedById: manager.id,
      role: 'DEVELOPER' as const,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date('2026-08-27T08:00:00.000Z'),
    };

    const first = await prisma.workspaceInvitation.create({ data });
    await expect(prisma.workspaceInvitation.create({ data: { ...data, tokenHash: 'c'.repeat(64) } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.workspaceInvitation.update({ where: { id: first.id }, data: { status: 'DECLINED', declinedAt: new Date() } });
    await expect(prisma.workspaceInvitation.create({ data: { ...data, tokenHash: 'd'.repeat(64) } })).resolves.toMatchObject({ status: 'PENDING' });
  });
});
