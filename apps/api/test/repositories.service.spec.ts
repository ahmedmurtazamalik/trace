import { RepositoriesService } from '../src/modules/repositories/repositories.service';

describe('repository forgetting', () => {
  it('tombstones a removed repository, stops tracking, removes authorized Workspace assignments, and audits the action', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      userRepository: {
        findUnique: jest.fn().mockResolvedValue({ removedAt: new Date('2026-08-19T00:00:00.000Z'), forgottenAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspaceRepository: {
        findMany: jest.fn().mockResolvedValue([{ id: 'assignment-1', workspace: { memberships: [{ id: 'manager-membership' }] } }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)) };
    const service = new RepositoriesService(prisma as never, {} as never, {} as never);

    await expect(service.forget('ali-user', 'zombie-defense')).resolves.toEqual({ repositoryId: 'zombie-defense', forgotten: true });
    expect(transaction.workspaceRepository.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['assignment-1'] } } });
    expect(transaction.userRepository.update).toHaveBeenCalledWith({
      where: { userId_repositoryId: { userId: 'ali-user', repositoryId: 'zombie-defense' } },
      data: { trackingEnabled: false, forgottenAt: expect.any(Date) as unknown },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorUserId: 'ali-user', action: 'repository.forgotten', targetId: 'zombie-defense',
      metadata: { removedWorkspaceAssignmentCount: 1 },
    }) as unknown });
  });
});
