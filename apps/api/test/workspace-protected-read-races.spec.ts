import { WorkspaceAnalysisService } from '../src/modules/workspaces/workspace-analysis.service';
import { WorkspaceReportsService } from '../src/modules/workspaces/workspace-reports.service';
import { WorkspacesService } from '../src/modules/workspaces/workspaces.service';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('workspace protected-read authorization races', () => {
  it('does not disclose workspace members or repositories after membership is removed before the protected read', async () => {
    let isMember = true;
    const preliminaryAuthorizationComplete = deferred<void>();
    const continueAfterRevocation = deferred<void>();
    const membership = {
      role: 'DEVELOPER',
      workspace: {
        id: 'workspace-1', name: 'Secret Workspace', slug: 'secret-workspace', archivedAt: null,
        createdAt: new Date('2026-08-18T00:00:00.000Z'), updatedAt: new Date('2026-08-18T00:00:00.000Z'),
        _count: { memberships: 2, repositories: 1 },
      },
    };
    const findMembership = jest.fn().mockImplementation(async () => {
      const result = isMember ? membership : null;
      if (findMembership.mock.calls.length === 1) {
        preliminaryAuthorizationComplete.resolve();
        await continueAfterRevocation.promise;
      }
      return result;
    });
    const findMembers = jest.fn().mockResolvedValue([{ role: 'MANAGER', createdAt: new Date(), user: { id: 'manager-1', username: 'manager', displayName: null } }]);
    const findRepositories = jest.fn().mockResolvedValue([{ repository: { id: 'repository-1', fullName: 'private/repository', private: true, defaultBranch: 'main', htmlUrl: null, accessRemovedAt: null } }]);
    const transaction = {
      workspaceMembership: { findUnique: findMembership, findMany: findMembers },
      workspaceRepository: { findMany: findRepositories },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'workspace-1' }]),
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const service = new WorkspacesService(prisma as never);

    const read = service.detail('developer-1', 'workspace-1');
    await preliminaryAuthorizationComplete.promise;
    isMember = false;
    continueAfterRevocation.resolve();

    await expect(read).rejects.toMatchObject({ status: 404, response: { code: 'WORKSPACE_NOT_FOUND' } });
    expect(findMembers).not.toHaveBeenCalled();
    expect(findRepositories).not.toHaveBeenCalled();
  });

  it('does not upsert or disclose analysis after membership is removed before the protected read', async () => {
    let isMember = true;
    const preliminaryAuthorizationComplete = deferred<void>();
    const continueAfterRevocation = deferred<void>();
    const findMembership = jest.fn().mockImplementation(async () => {
      const result = isMember ? { role: 'DEVELOPER' } : null;
      if (findMembership.mock.calls.length === 1) {
        preliminaryAuthorizationComplete.resolve();
        await continueAfterRevocation.promise;
      }
      return result;
    });
    const findAssignments = jest.fn().mockResolvedValue([{ repositoryId: 'repository-1' }]);
    const upsertAnalysis = jest.fn().mockResolvedValue({ id: 'analysis-1' });
    const findAnalyses = jest.fn().mockResolvedValue([]);
    const transaction = {
      workspaceMembership: { findUnique: findMembership },
      workspaceRepository: { findMany: findAssignments },
      workspaceRepositoryAnalysis: { upsert: upsertAnalysis, findMany: findAnalyses },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'workspace-1' }]),
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const service = new WorkspaceAnalysisService(prisma as never, {} as never);

    const read = service.list('developer-1', 'workspace-1');
    await preliminaryAuthorizationComplete.promise;
    isMember = false;
    continueAfterRevocation.resolve();

    await expect(read).rejects.toMatchObject({ status: 404, response: { code: 'WORKSPACE_NOT_FOUND' } });
    expect(upsertAnalysis).not.toHaveBeenCalled();
    expect(findAnalyses).not.toHaveBeenCalled();
  });

  it('gives Developers completed currentness without Manager analysis telemetry', async () => {
    const coverage = {
      totalFiles: 1, eligibleFiles: 1, analyzedFiles: 1, excludedFiles: 0,
      totalBytes: 10, analyzedBytes: 10, truncatedFiles: 0,
    };
    const completedAt = new Date('2026-08-18T12:00:00.000Z');
    const failedAt = new Date('2026-08-19T12:00:00.000Z');
    const analysis = {
      id: 'analysis-1', workspaceId: 'workspace-1', repositoryId: 'repository-1',
      repository: { fullName: 'private/repository', installation: {} },
      status: 'FAILED', baselineSha: 'a'.repeat(40), lastAnalyzedSha: 'a'.repeat(40),
      baselineStartedAt: completedAt, baselineCompletedAt: completedAt, lastAnalyzedAt: completedAt,
      accessState: 'ACTIVE', coverage, lastError: 'provider token and retry diagnostics',
      runs: [{
        id: 'run-failed', workspaceId: 'workspace-1', repositoryId: 'repository-1', kind: 'INCREMENTAL',
        fromSha: 'a'.repeat(40), toSha: null, dataCutoffAt: failedAt, status: 'FAILED', accessState: 'ACTIVE',
        coverage: null, startedAt: failedAt, completedAt: failedAt, error: 'sensitive provider failure details',
      }],
    };
    const transaction = {
      workspaceMembership: { findUnique: jest.fn().mockResolvedValue({ role: 'DEVELOPER' }) },
      workspaceRepository: { findMany: jest.fn().mockResolvedValue([{ repositoryId: 'repository-1' }]) },
      workspaceRepositoryAnalysis: {
        upsert: jest.fn().mockResolvedValue({ id: 'analysis-1' }),
        findMany: jest.fn().mockResolvedValue([analysis]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'workspace-1' }]),
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const service = new WorkspaceAnalysisService(prisma as never, {} as never);

    const response = await service.list('developer-1', 'workspace-1');

    expect(response.items[0]).toMatchObject({
      status: 'COMPLETED', baselineSha: 'a'.repeat(40), lastAnalyzedSha: 'a'.repeat(40),
      baselineCompletedAt: completedAt.toISOString(), lastAnalyzedAt: completedAt.toISOString(), coverage,
    });
    expect(response.items[0]).not.toHaveProperty('lastError');
    expect(response.items[0]).not.toHaveProperty('latestRun');
  });

  it('does not disclose report schedule telemetry after Manager demotion before the protected read', async () => {
    let role: 'MANAGER' | 'DEVELOPER' = 'MANAGER';
    const preliminaryAuthorizationComplete = deferred<void>();
    const continueAfterDemotion = deferred<void>();
    const findMembership = jest.fn().mockImplementation(async () => {
      const result = { role, workspace: { archivedAt: null } };
      if (findMembership.mock.calls.length === 1) {
        preliminaryAuthorizationComplete.resolve();
        await continueAfterDemotion.promise;
      }
      return result;
    });
    const findSchedule = jest.fn().mockResolvedValue({
      id: 'secret-schedule', workspaceId: 'workspace-1', enabled: true, frequency: 'DAILY', selectedDays: [],
      localTime: '09:00', timezone: 'UTC', version: 1, configuredById: 'manager-1',
      nextRunAt: new Date('2026-08-20T09:00:00.000Z'), createdAt: new Date('2026-08-18T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    });
    const transaction = {
      workspaceMembership: { findUnique: findMembership },
      workspaceReportSchedule: { findFirst: findSchedule, findUnique: findSchedule },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'workspace-1' }]),
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const service = new WorkspaceReportsService(prisma as never, {} as never, {} as never);

    const read = service.getSchedule('manager-1', 'workspace-1');
    await preliminaryAuthorizationComplete.promise;
    role = 'DEVELOPER';
    continueAfterDemotion.resolve();

    await expect(read).rejects.toMatchObject({ status: 403, response: { code: 'WORKSPACE_MANAGER_REQUIRED' } });
    expect(findSchedule).not.toHaveBeenCalled();
  });

  it('does not enumerate report occurrences after membership removal before the protected read', async () => {
    let isMember = true;
    const preliminaryAuthorizationComplete = deferred<void>();
    const continueAfterRemoval = deferred<void>();
    const findMembership = jest.fn().mockImplementation(async () => {
      const result = isMember ? { role: 'MANAGER', workspace: { archivedAt: null } } : null;
      if (findMembership.mock.calls.length === 1) {
        preliminaryAuthorizationComplete.resolve();
        await continueAfterRemoval.promise;
      }
      return result;
    });
    const findOccurrences = jest.fn().mockResolvedValue([]);
    const transaction = {
      workspaceMembership: { findUnique: findMembership },
      workspaceReportOccurrence: { findMany: findOccurrences },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'workspace-1' }]),
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const service = new WorkspaceReportsService(prisma as never, {} as never, {} as never);

    const read = service.listOccurrences('manager-1', 'workspace-1');
    await preliminaryAuthorizationComplete.promise;
    isMember = false;
    continueAfterRemoval.resolve();

    await expect(read).rejects.toMatchObject({ status: 404, response: { code: 'WORKSPACE_NOT_FOUND' } });
    expect(findOccurrences).not.toHaveBeenCalled();
  });
});
