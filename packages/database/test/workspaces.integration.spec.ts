import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const prefix = 'workspace-foundation-test';

async function clean(): Promise<void> {
  await prisma.workspace.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
}

describe('workspace database foundation', () => {
  beforeAll(async () => prisma.$connect());
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('stores exactly two roles, unique memberships, lifecycle state, and permits equal Manager powers', async () => {
    const [creator, second] = await Promise.all([
      prisma.user.create({ data: { username: `${prefix}.creator`, passwordHash: 'test-only' } }),
      prisma.user.create({ data: { username: `${prefix}.second`, passwordHash: 'test-only' } }),
    ]);
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Product Delivery',
        slug: `${prefix}-product-delivery`,
        createdById: creator.id,
        memberships: { create: { userId: creator.id, role: 'MANAGER' } },
      },
      include: { memberships: true },
    });
    expect(workspace.memberships).toEqual([expect.objectContaining({ userId: creator.id, role: 'MANAGER' })]);

    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: second.id, role: 'DEVELOPER' },
    });
    await expect(prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: second.id, role: 'MANAGER' },
    })).rejects.toMatchObject({ code: 'P2002' });

    await prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: second.id } },
      data: { role: 'MANAGER' },
    });
    await prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: creator.id } },
      data: { role: 'DEVELOPER' },
    });
    await prisma.workspaceMembership.delete({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: creator.id } },
    });

    const archivedAt = new Date('2026-08-18T18:00:00.000Z');
    const archived = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { name: 'Delivery Platform', archivedAt },
    });
    expect(archived).toMatchObject({ name: 'Delivery Platform', archivedAt });
  });

  it('rejects removing or demoting the last Manager', async () => {
    const creator = await prisma.user.create({
      data: { username: `${prefix}.only-manager`, passwordHash: 'test-only' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'One Manager',
        slug: `${prefix}-one-manager`,
        createdById: creator.id,
        memberships: { create: { userId: creator.id, role: 'MANAGER' } },
      },
    });
    const key = { workspaceId_userId: { workspaceId: workspace.id, userId: creator.id } };

    await expect(prisma.workspaceMembership.update({ where: key, data: { role: 'DEVELOPER' } }))
      .rejects.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    await expect(prisma.workspaceMembership.delete({ where: key }))
      .rejects.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    expect(await prisma.workspaceMembership.findUniqueOrThrow({ where: key })).toMatchObject({ role: 'MANAGER' });
  });
});
