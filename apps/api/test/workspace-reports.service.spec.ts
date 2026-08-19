import { WorkspaceReportsService, workspaceReportFacts } from '../src/modules/workspaces/workspace-reports.service';

describe('workspace report facts', () => {
  it('counts stable contributors instead of hardcoding zero', () => {
    const rows = [
      { repositoryId: 'repo-1', authorContributorId: 'contributor-1', authorEmail: 'one@example.test', additions: 2, deletions: 1, changedFiles: 1, files: [] },
      { repositoryId: 'repo-1', authorContributorId: 'contributor-1', authorEmail: 'alias@example.test', additions: 3, deletions: 0, changedFiles: 1, files: [] },
      { repositoryId: 'repo-2', authorContributorId: null, authorEmail: 'TWO@example.test', additions: null, deletions: null, changedFiles: null, files: [{ id: 'file' }] },
    ];

    expect(workspaceReportFacts(rows)).toEqual({
      repositoryCount: 2,
      contributorCount: 2,
      commitCount: 3,
      filesChanged: 3,
      additions: 5,
      deletions: 1,
    });
  });
});

describe('workspace report access', () => {
  const membership = (role: 'MANAGER' | 'DEVELOPER') => ({ role, workspace: { archivedAt: null } });
  const completedReport = {
    report: {
      id: 'report-1', reportDate: '2026-08-18', timezone: 'UTC', status: 'completed',
      createdAt: '2026-08-18T17:00:00.000Z', completedAt: '2026-08-18T17:00:00.000Z', errorMessage: null,
      revision: 1, downloadAvailable: true, revisionSource: 'ai',
      content: { executiveSummary: 'No activity.', repositories: [] },
      facts: { repositoryCount: 1, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
      artifacts: [{ id: 'pdf-1', revision: 1, kind: 'pdf', fileName: 'workspace.pdf', contentType: 'application/pdf', sizeBytes: 4, checksum: 'a'.repeat(64) }],
    },
  };

  function service(role: 'MANAGER' | 'DEVELOPER') {
    const prisma = {
      workspaceMembership: { findUnique: jest.fn().mockResolvedValue(membership(role)) },
      workspaceReportSchedule: { findUnique: jest.fn() },
      workspaceReportOccurrence: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          workspaceId: 'workspace-1', trigger: 'RECOVERY', scheduleVersion: 2, scheduledFor: new Date('2026-08-18T17:00:00.000Z'),
          intendedLocalDateTime: '2026-08-18T17:00', windowStart: new Date('2026-08-17T17:00:00.000Z'),
          windowEnd: new Date('2026-08-18T17:00:00.000Z'), dataCutoffAt: new Date('2026-08-18T17:00:00.000Z'),
          recoveredAt: new Date('2026-08-18T17:01:00.000Z'), noActivity: true,
          evidenceSnapshot: { version: 1, window: { start: '2026-08-17T17:00:00.000Z', end: '2026-08-18T17:00:00.000Z', dataCutoffAt: '2026-08-18T17:00:00.000Z' }, limits: { repositories: 100, commits: 10_000 }, noActivity: true, repositories: [{ repositoryId: 'repository-1', fullName: 'trace/web', accessState: 'ACTIVE', analysisStatus: 'COMPLETED', coverage: { totalFiles: 2, eligibleFiles: 2, analyzedFiles: 2, excludedFiles: 0, totalBytes: 20, analyzedBytes: 20, truncatedFiles: 0 }, analysisRunId: 'run-1', baselineOnly: false, activityCount: 0 }] },
          workspace: { name: 'Product Delivery' },
        }),
      },
    };
    const reports = {
      listWorkspace: jest.fn().mockResolvedValue({ items: [], pageInfo: { hasNextPage: false, nextCursor: null } }),
      detailWorkspace: jest.fn().mockResolvedValue(completedReport),
      updateWorkspaceRevision: jest.fn().mockResolvedValue({ report: { id: 'report-1' } }),
      regenerateWorkspace: jest.fn().mockResolvedValue({ report: { id: 'report-1' } }),
      downloadWorkspace: jest.fn().mockResolvedValue({ bytes: Buffer.from('pdf') }),
    };
    const instance = new WorkspaceReportsService(prisma as never, {} as never, reports as never);
    return { instance, reports, prisma };
  }

  it('limits Developer list and detail consumption to completed workspace reports', async () => {
    const { instance, reports } = service('DEVELOPER');

    await instance.list('developer-1', 'workspace-1', { limit: '20' });
    await instance.detail('developer-1', 'workspace-1', 'report-1');

    expect(reports.listWorkspace).toHaveBeenCalledWith('developer-1', 'workspace-1', { limit: '20' });
    expect(reports.detailWorkspace).toHaveBeenCalledWith('developer-1', 'workspace-1', 'report-1');
  });

  it('projects immutable workspace evidence without requester or operational fields', async () => {
    const { instance } = service('DEVELOPER');

    const response = await instance.detail('developer-1', 'workspace-1', 'report-1');

    expect(response.workspaceEvidence).toMatchObject({
      workspaceId: 'workspace-1', workspaceName: 'Product Delivery', trigger: 'RECOVERY',
      noActivity: true, repositories: [{ repositoryId: 'repository-1', accessState: 'ACTIVE', baselineOnly: false, activityCount: 0 }],
    });
    expect(response.workspaceEvidence).not.toHaveProperty('requestedById');
    expect(response.workspaceEvidence).not.toHaveProperty('idempotencyKey');
    expect(response.workspaceEvidence.repositories[0]).not.toHaveProperty('analysisStatus');
    expect(response.workspaceEvidence.repositories[0]).not.toHaveProperty('analysisRunId');
  });

  it('allows a Developer to download only through the completed workspace artifact lookup', async () => {
    const { instance, reports } = service('DEVELOPER');

    await instance.download('developer-1', 'workspace-1', 'report-1', { artifactId: 'artifact-1' });

    expect(reports.downloadWorkspace).toHaveBeenCalledWith('developer-1', 'workspace-1', 'report-1', { artifactId: 'artifact-1' });
  });

  it('keeps schedule, occurrences, edits, and regeneration Manager-only', async () => {
    const { instance, reports, prisma } = service('DEVELOPER');

    for (const operation of [
      () => instance.getSchedule('developer-1', 'workspace-1'),
      () => instance.listOccurrences('developer-1', 'workspace-1'),
      () => instance.updateRevision('developer-1', 'workspace-1', 'report-1', { expectedRevision: 1, prosePatch: {} }),
      () => instance.regenerate('developer-1', 'workspace-1', 'report-1', { expectedRevision: 1 }),
    ]) {
      await expect(operation()).rejects.toMatchObject({ status: 403 });
    }
    expect(prisma.workspaceReportSchedule.findUnique).not.toHaveBeenCalled();
    expect(prisma.workspaceReportOccurrence.findMany).not.toHaveBeenCalled();
    expect(reports.updateWorkspaceRevision).not.toHaveBeenCalled();
    expect(reports.regenerateWorkspace).not.toHaveBeenCalled();
  });

  it('passes Manager consumption and mutations through an exact workspace scope', async () => {
    const { instance, reports } = service('MANAGER');

    await instance.list('manager-1', 'workspace-1', {});
    await instance.detail('manager-1', 'workspace-1', 'report-1');
    await instance.updateRevision('manager-1', 'workspace-1', 'report-1', { expectedRevision: 1, prosePatch: {} });
    await instance.regenerate('manager-1', 'workspace-1', 'report-1', { expectedRevision: 1 });

    expect(reports.listWorkspace).toHaveBeenCalledWith('manager-1', 'workspace-1', {});
    expect(reports.detailWorkspace).toHaveBeenCalledWith('manager-1', 'workspace-1', 'report-1');
    expect(reports.updateWorkspaceRevision).toHaveBeenCalledWith('manager-1', 'workspace-1', 'report-1', { expectedRevision: 1, prosePatch: {} });
    expect(reports.regenerateWorkspace).toHaveBeenCalledWith('manager-1', 'workspace-1', 'report-1', { expectedRevision: 1 });
  });
});
