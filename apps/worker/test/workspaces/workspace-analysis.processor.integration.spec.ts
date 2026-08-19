import { PrismaClient } from '@trace/database';
import { WorkspaceAnalysisProcessor } from '../../src/workspaces/workspace-analysis.processor';

const prisma = new PrismaClient();
const slug = 'workspace-analysis-worker-test';

describe('WorkspaceAnalysisProcessor', () => {
  afterEach(async () => { await prisma.workspace.deleteMany({ where: { slug } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('claims a durable pending run and makes duplicate delivery a no-op', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis worker', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', fromSha: null, toSha: null, dataCutoffAt: new Date('2026-08-18T17:00:00.000Z'), status: 'PENDING', evidence: {},
    } });
    const collect = jest.fn().mockResolvedValue({
      toSha: 'a'.repeat(40), dataCutoffAt: new Date('2026-08-18T17:00:00.000Z'),
      coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
      evidence: { version: 1 as const, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} },
    });
    const processor = new WorkspaceAnalysisProcessor(prisma, {
      resolveHead: jest.fn().mockResolvedValue({ toSha: 'a'.repeat(40), dataCutoffAt: new Date('2026-08-18T17:00:00.000Z') }),
      collect,
    });

    await processor.process(run.id);
    await processor.process(run.id);

    expect(collect).toHaveBeenCalledTimes(1);
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'COMPLETED', toSha: 'a'.repeat(40) });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({ status: 'COMPLETED', baselineSha: 'a'.repeat(40), lastAnalyzedSha: 'a'.repeat(40) });
  });

  it('reclaims an expired processing run after a crash without duplicating evidence or regressing the watermark', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis crash recovery', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const pinnedSha = '9'.repeat(40);
    const cutoff = new Date('2026-08-18T17:30:00.000Z');
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PROCESSING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', fromSha: null, toSha: pinnedSha, dataCutoffAt: cutoff, status: 'PROCESSING', evidence: {},
      processingToken: 'crashed-owner', processingExpiresAt: new Date(0),
    } });
    const evidence = { version: 1 as const, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} };
    const collect = jest.fn().mockResolvedValue({
      toSha: pinnedSha, dataCutoffAt: cutoff,
      coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
      evidence,
    });

    await new WorkspaceAnalysisProcessor(prisma, { resolveHead: jest.fn(), collect }).process(run.id);
    await new WorkspaceAnalysisProcessor(prisma, { resolveHead: jest.fn(), collect }).process(run.id);

    expect(collect).toHaveBeenCalledTimes(1);
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED', toSha: pinnedSha, dataCutoffAt: cutoff, evidence,
      processingToken: null, processingExpiresAt: null,
    });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({
      status: 'COMPLETED', baselineSha: pinnedSha, lastAnalyzedSha: pinnedSha,
    });
  });

  it('promotes an incremental run to a fresh baseline when continuity cannot be proven', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis fallback', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const priorSha = 'a'.repeat(40);
    const nextSha = 'b'.repeat(40);
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: {
      workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING',
      baselineSha: priorSha, lastAnalyzedSha: priorSha,
    } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'INCREMENTAL', fromSha: priorSha, toSha: null,
      dataCutoffAt: new Date('2026-08-18T18:00:00.000Z'), status: 'PENDING', evidence: {},
    } });
    const collect = jest.fn().mockResolvedValue({
      toSha: nextSha, dataCutoffAt: new Date('2026-08-18T18:00:00.000Z'),
      coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
      evidence: { version: 1, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: { 'incremental-continuity-unproven': 1 } },
    });

    await new WorkspaceAnalysisProcessor(prisma, {
      resolveHead: jest.fn().mockResolvedValue({ toSha: nextSha, dataCutoffAt: new Date('2026-08-18T18:00:00.000Z') }),
      collect,
    }).process(run.id);

    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED', kind: 'BASELINE', fromSha: null, toSha: nextSha,
    });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({
      status: 'COMPLETED', baselineSha: nextSha, lastAnalyzedSha: nextSha,
    });
  });

  it('never begins collection until an immutable branch target has been resolved and persisted', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis requires pin', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', fromSha: null, toSha: null, dataCutoffAt: new Date(), status: 'PENDING', evidence: {},
    } });
    const collect = jest.fn();

    await expect(new WorkspaceAnalysisProcessor(prisma, { collect }).process(run.id, false)).rejects.toThrow('WORKSPACE_ANALYSIS_RETRY');

    expect(collect).not.toHaveBeenCalled();
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'PENDING', toSha: null });
  });

  it('does not pin a resolved target or persist retry failure after its processing lease expires', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis expired pin', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', dataCutoffAt: new Date('2026-08-18T18:15:00.000Z'), status: 'PENDING', evidence: {},
    } });
    const target = { toSha: 'f'.repeat(40), dataCutoffAt: new Date('2026-08-18T18:16:00.000Z') };
    const collect = jest.fn();
    const processor = new WorkspaceAnalysisProcessor(prisma, {
      resolveHead: jest.fn(async () => {
        await prisma.workspaceAnalysisRun.update({ where: { id: run.id }, data: { processingExpiresAt: new Date(0) } });
        return target;
      }),
      collect,
    });

    await expect(processor.process(run.id, false)).rejects.toThrow('WORKSPACE_ANALYSIS_RETRY');

    expect(collect).not.toHaveBeenCalled();
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'PROCESSING', toSha: null, error: null,
    });
  });

  it('does not complete a run after its processing lease expires', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis expired completion', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const target = { toSha: '8'.repeat(40), dataCutoffAt: new Date('2026-08-18T18:17:00.000Z') };
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', toSha: target.toSha, dataCutoffAt: target.dataCutoffAt, status: 'PENDING', evidence: {},
    } });
    const coverage = { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 };
    const evidence = { version: 1 as const, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} };
    const processor = new WorkspaceAnalysisProcessor(prisma, {
      collect: jest.fn(async () => {
        await prisma.workspaceAnalysisRun.update({ where: { id: run.id }, data: { processingExpiresAt: new Date(0) } });
        return { ...target, coverage, evidence };
      }),
    });

    await expect(processor.process(run.id)).rejects.toThrow('WORKSPACE_ANALYSIS_RETRY');

    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'PROCESSING', evidence: {}, completedAt: null,
    });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({
      status: 'PROCESSING', baselineSha: null, lastAnalyzedSha: null,
    });
    expect(await prisma.auditLog.count({ where: { targetId: workspace.id, action: 'workspace.analysis.baseline.completed' } })).toBe(0);
  });

  it('pins the branch head and cutoff before collection so a retry cannot follow an advanced branch', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis pinned retry', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', fromSha: null, toSha: null, dataCutoffAt: new Date('2026-08-18T18:30:00.000Z'), status: 'PENDING', evidence: {},
    } });
    const pinned = { toSha: 'd'.repeat(40), dataCutoffAt: new Date('2026-08-18T18:31:00.000Z') };
    const advanced = { toSha: 'e'.repeat(40), dataCutoffAt: new Date('2026-08-18T18:32:00.000Z') };
    const resolveHead = jest.fn().mockResolvedValueOnce(pinned).mockResolvedValueOnce(advanced);
    const successful = {
      ...pinned,
      coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
      evidence: { version: 1 as const, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} },
    };
    const collect = jest.fn().mockRejectedValueOnce(new Error('crash after pin')).mockResolvedValueOnce(successful);
    const processor = new WorkspaceAnalysisProcessor(prisma, { resolveHead, collect });

    await expect(processor.process(run.id, false)).rejects.toThrow('WORKSPACE_ANALYSIS_RETRY');
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'PENDING', toSha: pinned.toSha, dataCutoffAt: pinned.dataCutoffAt,
    });
    await processor.process(run.id);

    expect(resolveHead).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenNthCalledWith(1, expect.any(Object), null, pinned);
    expect(collect).toHaveBeenNthCalledWith(2, expect.any(Object), null, pinned);
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED', toSha: pinned.toSha, dataCutoffAt: pinned.dataCutoffAt,
    });
  });

  it('keeps transient collector failures retryable before completing on a later attempt', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ where: { accessRemovedAt: null }, orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis retry', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', fromSha: null, toSha: null,
      dataCutoffAt: new Date('2026-08-18T19:00:00.000Z'), status: 'PENDING', evidence: {},
    } });
    const successful = {
      toSha: 'c'.repeat(40), dataCutoffAt: new Date('2026-08-18T19:00:00.000Z'),
      coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
      evidence: { version: 1 as const, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} },
    };
    const collect = jest.fn().mockRejectedValueOnce(new Error('temporary GitHub failure')).mockResolvedValueOnce(successful);
    const processor = new WorkspaceAnalysisProcessor(prisma, {
      resolveHead: jest.fn().mockResolvedValue({ toSha: successful.toSha, dataCutoffAt: successful.dataCutoffAt }),
      collect,
    });

    await expect(processor.process(run.id, false)).rejects.toThrow('WORKSPACE_ANALYSIS_RETRY');
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'PENDING', completedAt: null, error: 'temporary GitHub failure',
    });

    await processor.process(run.id, true);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED', toSha: successful.toSha, error: null,
    });
  });

  it('blocks a split-member authority where repository access and installation ownership belong to different members', async () => {
    const users = await prisma.user.findMany({ take: 2, orderBy: { createdAt: 'asc' } });
    const owner = users[0]!;
    const accessor = users[1]!;
    const repository = await prisma.repository.findFirstOrThrow({
      where: { accessRemovedAt: null, installation: { githubAccount: { userId: owner.id, unlinkedAt: null }, suspendedAt: null } },
      orderBy: { createdAt: 'asc' },
    });
    await prisma.userRepository.upsert({
      where: { userId_repositoryId: { userId: accessor.id, repositoryId: repository.id } },
      create: { userId: accessor.id, repositoryId: repository.id },
      update: { accessRemovedAt: null, removedAt: null },
    });
    await prisma.userRepository.updateMany({ where: { userId: owner.id, repositoryId: repository.id }, data: { accessRemovedAt: new Date() } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis split authority', slug, createdById: owner.id,
      memberships: { createMany: { data: [{ userId: owner.id, role: 'MANAGER' }, { userId: accessor.id, role: 'DEVELOPER' }] } },
      repositories: { create: { repositoryId: repository.id, assignedById: owner.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', dataCutoffAt: new Date(), status: 'PENDING', evidence: {},
    } });
    const collect = jest.fn();

    await new WorkspaceAnalysisProcessor(prisma, { collect }).process(run.id);

    expect(collect).not.toHaveBeenCalled();
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'BLOCKED_ACCESS', accessState: 'ACCESS_REMOVED', evidence: {} });
    await prisma.userRepository.updateMany({ where: { userId: owner.id, repositoryId: repository.id }, data: { accessRemovedAt: null } });
    await prisma.userRepository.delete({ where: { userId_repositoryId: { userId: accessor.id, repositoryId: repository.id } } });
  });

  it('revalidates authority after collection and preserves historical evidence when access is lost', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({
      where: { accessRemovedAt: null, users: { some: { userId: user.id, accessRemovedAt: null, removedAt: null } }, installation: { githubAccount: { userId: user.id, unlinkedAt: null }, suspendedAt: null } },
      orderBy: { createdAt: 'asc' },
    });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis post collection revoke', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const historicalSha = '1'.repeat(40);
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: {
      workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING', baselineSha: historicalSha, lastAnalyzedSha: historicalSha,
      coverage: { totalFiles: 1 },
    } });
    const pinned = { toSha: '2'.repeat(40), dataCutoffAt: new Date('2026-08-18T19:30:00.000Z') };
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'INCREMENTAL', fromSha: historicalSha, dataCutoffAt: new Date(), status: 'PENDING', evidence: {},
    } });
    const collect = jest.fn().mockImplementation(async () => {
      await prisma.userRepository.update({
        where: { userId_repositoryId: { userId: user.id, repositoryId: repository.id } },
        data: { accessRemovedAt: new Date() },
      });
      return {
        ...pinned,
        coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
        evidence: { version: 1, defaultBranch: repository.defaultBranch, baselineOnly: false, files: [], changes: [], exclusions: {} },
      };
    });

    await new WorkspaceAnalysisProcessor(prisma, { resolveHead: jest.fn().mockResolvedValue(pinned), collect }).process(run.id);

    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'BLOCKED_ACCESS', accessState: 'ACCESS_REMOVED', toSha: pinned.toSha, evidence: {} });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({
      status: 'BLOCKED_ACCESS', accessState: 'ACCESS_REMOVED', baselineSha: historicalSha, lastAnalyzedSha: historicalSha, coverage: { totalFiles: 1 },
    });
    await prisma.userRepository.update({
      where: { userId_repositoryId: { userId: user.id, repositoryId: repository.id } },
      data: { accessRemovedAt: null },
    });
  });

  it('does not let a stale completion overwrite a newer analysis watermark', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({
      where: { accessRemovedAt: null, users: { some: { userId: user.id, accessRemovedAt: null, removedAt: null } }, installation: { githubAccount: { userId: user.id, unlinkedAt: null }, suspendedAt: null } },
      orderBy: { createdAt: 'asc' },
    });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Analysis monotonic watermark', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({ data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' } });
    const older = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', dataCutoffAt: new Date('2026-08-18T20:00:00.000Z'), status: 'PENDING', evidence: {},
    } });
    let releaseOlder!: () => void;
    const olderCollected = new Promise<void>((resolve) => { releaseOlder = resolve; });
    let signalOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => { signalOlderStarted = resolve; });
    const coverage = { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 };
    const olderTarget = { toSha: '3'.repeat(40), dataCutoffAt: new Date('2026-08-18T20:00:30.000Z') };
    const olderProcessor = new WorkspaceAnalysisProcessor(prisma, {
      resolveHead: jest.fn().mockResolvedValue(olderTarget),
      collect: jest.fn(async () => {
        signalOlderStarted();
        await olderCollected;
        return { ...olderTarget, coverage, evidence: { version: 1 as const, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} } };
      }),
    });
    const olderPromise = olderProcessor.process(older.id);
    await olderStarted;
    const newer = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', toSha: '4'.repeat(40), dataCutoffAt: new Date('2026-08-18T20:01:30.000Z'),
      status: 'COMPLETED', coverage, evidence: { version: 1, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [], changes: [], exclusions: {} },
      completedAt: new Date('2026-08-18T20:01:30.000Z'),
    } });
    await prisma.workspaceRepositoryAnalysis.update({ where: { id: analysis.id }, data: {
      status: 'COMPLETED', baselineSha: newer.toSha, lastAnalyzedSha: newer.toSha, coverage,
    } });
    releaseOlder();
    await olderPromise;

    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: older.id } })).toMatchObject({ status: 'COMPLETED', toSha: '3'.repeat(40) });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({
      status: 'COMPLETED', baselineSha: '4'.repeat(40), lastAnalyzedSha: '4'.repeat(40),
    });
  });
});
