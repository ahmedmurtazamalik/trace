import { PrismaClient } from '@trace/database';
import { WorkspaceAnalysisPublisher } from '../src/modules/workspaces/workspace-analysis.publisher';

const prisma = new PrismaClient();
const slug = 'workspace-analysis-publisher-recovery-test';

describe('WorkspaceAnalysisPublisher recovery', () => {
  afterEach(async () => { await prisma.workspace.deleteMany({ where: { slug } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('reconciles and republishes an expired processing run left by a crashed worker', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const repository = await prisma.repository.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Publisher recovery', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
      repositories: { create: { repositoryId: repository.id, assignedById: user.id } },
    } });
    const analysis = await prisma.workspaceRepositoryAnalysis.create({
      data: { workspaceId: workspace.id, repositoryId: repository.id, status: 'PROCESSING' },
    });
    const run = await prisma.workspaceAnalysisRun.create({ data: {
      analysisId: analysis.id, workspaceId: workspace.id, repositoryId: repository.id,
      kind: 'BASELINE', toSha: '7'.repeat(40), dataCutoffAt: new Date(), status: 'PROCESSING', evidence: {},
      processingToken: 'dead-worker', processingExpiresAt: new Date(0), publishedAt: new Date(0),
    } });
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const publisher = new WorkspaceAnalysisPublisher(prisma as never, { enqueue } as never);

    await publisher.publishOwed();

    expect(enqueue).toHaveBeenCalledWith(run.id);
    expect(await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'PENDING', processingToken: null, processingExpiresAt: null,
    });
    expect(await prisma.workspaceRepositoryAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).toMatchObject({ status: 'PENDING' });
  });
});
