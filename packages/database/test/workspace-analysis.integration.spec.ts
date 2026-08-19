import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const slug = 'workspace-analysis-db-test';

describe('workspace analysis persistence', () => {
  beforeAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: slug } } });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: slug } } });
    await prisma.$disconnect();
  });

  it('keeps one state per assignment and immutable SHA-specific evidence after access loss', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Analysis DB Test', slug, createdById: user.id,
        memberships: { create: { userId: user.id, role: 'MANAGER' } },
        repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
      },
    });

    const analysis = await prisma.workspaceRepositoryAnalysis.create({
      data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'UNINITIALIZED', accessState: 'ACTIVE' },
    });
    await expect(prisma.workspaceRepositoryAnalysis.create({
      data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'UNINITIALIZED', accessState: 'ACTIVE' },
    })).rejects.toMatchObject({ code: 'P2002' });

    const sha = 'a'.repeat(40);
    const run = await prisma.workspaceAnalysisRun.create({
      data: {
        analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
        kind: 'BASELINE', toSha: sha, dataCutoffAt: new Date(), status: 'COMPLETED', accessState: 'ACTIVE',
        coverage: { totalFiles: 1, eligibleFiles: 1, analyzedFiles: 1, excludedFiles: 0, totalBytes: 12, analyzedBytes: 12, truncatedFiles: 0 },
        evidence: { version: 1, defaultBranch: repository.defaultBranch, baselineOnly: true, files: [{ path: 'README.md', blobSha: sha, size: 12, language: 'Markdown', disposition: 'ANALYZED', exclusionReason: null, content: '# Trace' }], changes: [], exclusions: {} },
        startedAt: new Date(), completedAt: new Date(),
      },
    });
    await expect(prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', toSha: sha, dataCutoffAt: new Date(), status: 'COMPLETED', accessState: 'ACTIVE', evidence: {},
    } })).rejects.toMatchObject({ code: 'P2002' });

    await prisma.repository.update({ where: { id: repository.id }, data: { accessRemovedAt: new Date() } });
    await prisma.workspaceRepositoryAnalysis.update({ where: { id: analysis.id }, data: { accessState: 'ACCESS_REMOVED', status: 'BLOCKED_ACCESS' } });
    expect(await prisma.workspaceAnalysisRun.findUnique({ where: { id: run.id } })).toMatchObject({ toSha: sha, status: 'COMPLETED' });
    await prisma.repository.update({ where: { id: repository.id }, data: { accessRemovedAt: null } });
  });

  it('rejects direct mutation and deletion of completed analysis evidence', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Immutable Analysis DB Test', slug: `${slug}-immutable`, createdById: user.id,
        memberships: { create: { userId: user.id, role: 'MANAGER' } },
      },
    });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({
      data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'COMPLETED' },
    });
    const run = await prisma.workspaceAnalysisRun.create({
      data: {
        analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
        kind: 'BASELINE', toSha: 'b'.repeat(40), dataCutoffAt: new Date('2026-08-18T12:00:00.000Z'),
        status: 'COMPLETED', coverage: { analyzedFiles: 1 }, evidence: { version: 1, files: ['README.md'] },
        startedAt: new Date('2026-08-18T12:00:00.000Z'), completedAt: new Date('2026-08-18T12:01:00.000Z'),
      },
    });

    await expect(prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { evidence: { version: 2, files: [] } },
    })).rejects.toThrow(/terminal workspace analysis evidence is immutable/i);
    await expect(prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { toSha: 'c'.repeat(40) },
    })).rejects.toThrow(/terminal workspace analysis evidence is immutable/i);
    await expect(prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { kind: 'INCREMENTAL' },
    })).rejects.toThrow(/terminal workspace analysis evidence is immutable/i);
    await expect(prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { status: 'FAILED', error: 'tampered' },
    })).rejects.toThrow(/terminal workspace analysis evidence is immutable/i);
    await expect(prisma.workspaceAnalysisRun.delete({ where: { id: run.id } }))
      .rejects.toThrow(/terminal workspace analysis evidence cannot be deleted/i);
  });

  it('allows an analysis run to advance through its legal lifecycle before completion', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Analysis Lifecycle DB Test', slug: `${slug}-lifecycle`, createdById: user.id,
        memberships: { create: { userId: user.id, role: 'MANAGER' } },
      },
    });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({
      data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PENDING' },
    });
    const run = await prisma.workspaceAnalysisRun.create({
      data: {
        analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
        kind: 'BASELINE', dataCutoffAt: new Date('2026-08-18T13:00:00.000Z'), status: 'PENDING',
      },
    });

    await expect(prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { status: 'UNINITIALIZED' },
    })).rejects.toThrow(/workspace analysis lifecycle transition is invalid/i);
    await expect(prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { workspaceId: 'tampered-workspace' },
    })).rejects.toThrow(/workspace analysis run identity is immutable/i);

    const startedAt = new Date('2026-08-18T13:01:00.000Z');
    await prisma.workspaceAnalysisRun.update({
      where: { id: run.id }, data: { status: 'PROCESSING', startedAt, publishedAt: startedAt },
    });
    const completedAt = new Date('2026-08-18T13:02:00.000Z');
    const completed = await prisma.workspaceAnalysisRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED', toSha: 'd'.repeat(40), completedAt,
        coverage: { analyzedFiles: 1 }, evidence: { version: 1, files: ['src/index.ts'] },
      },
    });
    expect(completed).toMatchObject({ status: 'COMPLETED', startedAt, completedAt, toSha: 'd'.repeat(40) });
  });
});
