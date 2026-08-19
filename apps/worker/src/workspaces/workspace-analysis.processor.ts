import { randomUUID } from 'node:crypto';
import { hasWorkspaceRepositoryAuthority, Prisma, type PrismaClient } from '@trace/database';
import type {
  WorkspaceAnalysisCollection,
  WorkspaceAnalysisRepositoryInput,
  WorkspaceAnalysisTarget,
} from './workspace-analysis.collector';

export interface WorkspaceAnalysisCollectorPort {
  resolveHead?(input: WorkspaceAnalysisRepositoryInput): Promise<WorkspaceAnalysisTarget>;
  collect(input: WorkspaceAnalysisRepositoryInput, fromSha: string | null, target?: WorkspaceAnalysisTarget): Promise<WorkspaceAnalysisCollection>;
}

const SAFE_ACCESS_ERROR = 'Current GitHub App access is unavailable.';

export class WorkspaceAnalysisProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collector: WorkspaceAnalysisCollectorPort,
    private readonly leaseDurationMs = 5 * 60_000,
  ) {}

  async process(runId: string, finalAttempt = true): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) return;
    const token = randomUUID();
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))`;
      const run = await tx.workspaceAnalysisRun.findUnique({
        where: { id: runId },
        include: { repository: { include: { installation: true } }, analysis: true },
      });
      if (run === null || ['COMPLETED', 'FAILED', 'BLOCKED_ACCESS'].includes(run.status)) return null;
      const now = new Date();
      if (run.status === 'PROCESSING' && (run.processingExpiresAt === null || run.processingExpiresAt > now)) {
        throw new Error('WORKSPACE_ANALYSIS_BUSY');
      }
      if (!await this.hasCurrentAuthority(tx, run.workspaceId, run.repositoryId)) {
        await this.blockAccess(tx, run.id, run.analysisId);
        return null;
      }
      const startedAt = run.startedAt ?? now;
      await tx.workspaceAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: 'PROCESSING', startedAt, error: null, processingToken: token,
          processingExpiresAt: new Date(now.getTime() + this.leaseDurationMs),
        },
      });
      await tx.workspaceRepositoryAnalysis.update({
        where: { id: run.analysisId },
        data: { status: 'PROCESSING', accessState: 'ACTIVE', lastError: null, ...(run.kind === 'BASELINE' ? { baselineStartedAt: run.analysis.baselineStartedAt ?? startedAt } : {}) },
      });
      return {
        id: run.id, analysisId: run.analysisId, workspaceId: run.workspaceId, repositoryId: run.repositoryId,
        kind: run.kind, fromSha: run.fromSha, toSha: run.toSha, dataCutoffAt: run.dataCutoffAt, createdAt: run.createdAt,
        repository: { owner: run.repository.owner, name: run.repository.name, defaultBranch: run.repository.defaultBranch, githubInstallationId: run.repository.installation.githubInstallationId },
      };
    });
    if (claimed === null) return;

    let collection: WorkspaceAnalysisCollection;
    try {
      let target = claimed.toSha === null ? null : { toSha: claimed.toSha, dataCutoffAt: claimed.dataCutoffAt };
      if (target === null) {
        if (this.collector.resolveHead === undefined) throw new Error('Workspace analysis target resolver is unavailable.');
        target = await this.collector.resolveHead(claimed.repository);
        const pinned = await this.prisma.$executeRaw`
          UPDATE workspace_analysis_runs
          SET to_sha = ${target.toSha}, data_cutoff_at = ${target.dataCutoffAt}
          WHERE id = ${runId}
            AND status = 'PROCESSING'
            AND processing_token = ${token}
            AND processing_expires_at > clock_timestamp()
        `;
        if (pinned !== 1) throw new Error('WORKSPACE_ANALYSIS_BUSY');
        claimed.toSha = target.toSha;
        claimed.dataCutoffAt = target.dataCutoffAt;
      }
      collection = await this.collector.collect(claimed.repository, claimed.fromSha, target ?? undefined);
      if (target !== null && (collection.toSha !== target.toSha || collection.dataCutoffAt.getTime() !== target.dataCutoffAt.getTime())) {
        throw new Error('Workspace analysis collection did not match its pinned target.');
      }
    } catch (error) {
      const message = this.boundedError(error);
      await this.prisma.$transaction(async (tx) => {
        await this.lockAnalysis(tx, claimed.analysisId);
        const run = await tx.workspaceAnalysisRun.findUnique({ where: { id: runId } });
        if (run?.status !== 'PROCESSING' || run.processingToken !== token) return;
        if (!await this.hasCurrentAuthority(tx, claimed.workspaceId, claimed.repositoryId)) {
          await this.blockAccess(tx, run.id, claimed.analysisId, token);
          return;
        }
        const status = finalAttempt ? 'FAILED' : 'PENDING';
        const failed = await tx.workspaceAnalysisRun.updateMany({
          where: {
            id: runId,
            status: 'PROCESSING',
            processingToken: token,
            processingExpiresAt: { gt: new Date() },
          },
          data: { status, completedAt: finalAttempt ? new Date() : null, error: message, processingToken: null, processingExpiresAt: null },
        });
        if (failed.count !== 1) return;
        if (!await this.hasNewerRun(tx, claimed, ['PENDING', 'PROCESSING', 'COMPLETED'])) {
          await tx.workspaceRepositoryAnalysis.update({ where: { id: claimed.analysisId }, data: { status, lastError: message } });
        }
      });
      throw new Error('WORKSPACE_ANALYSIS_RETRY');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))`;
      await this.lockAnalysis(tx, claimed.analysisId);
      const run = await tx.workspaceAnalysisRun.findUnique({ where: { id: runId } });
      if (run?.status !== 'PROCESSING' || run.processingToken !== token) return;
      if (!await this.hasCurrentAuthority(tx, claimed.workspaceId, claimed.repositoryId)) {
        await this.blockAccess(tx, run.id, claimed.analysisId, token);
        return;
      }
      const now = new Date();
      const fallbackToBaseline = claimed.kind === 'INCREMENTAL' && collection.evidence.baselineOnly;
      const completedKind = fallbackToBaseline ? 'BASELINE' : claimed.kind;
      const completed = await tx.workspaceAnalysisRun.updateMany({ where: {
        id: run.id,
        status: 'PROCESSING',
        processingToken: token,
        processingExpiresAt: { gt: new Date() },
      }, data: {
        kind: completedKind,
        fromSha: fallbackToBaseline ? null : run.fromSha,
        toSha: collection.toSha, dataCutoffAt: collection.dataCutoffAt, status: 'COMPLETED', accessState: 'ACTIVE',
        coverage: collection.coverage, evidence: collection.evidence, completedAt: now, error: null,
        processingToken: null, processingExpiresAt: null,
      } });
      if (completed.count !== 1) throw new Error('WORKSPACE_ANALYSIS_RETRY');
      if (!await this.hasNewerRun(tx, claimed, ['COMPLETED'])) {
        await tx.workspaceRepositoryAnalysis.update({ where: { id: claimed.analysisId }, data: {
          status: 'COMPLETED', accessState: 'ACTIVE', coverage: collection.coverage,
          baselineSha: completedKind === 'BASELINE' ? collection.toSha : undefined,
          baselineCompletedAt: completedKind === 'BASELINE' ? now : undefined,
          lastAnalyzedSha: collection.toSha, lastAnalyzedAt: now, lastError: null,
        } });
      }
      await tx.auditLog.create({ data: {
        action: `workspace.analysis.${completedKind.toLowerCase()}.completed`, targetType: 'workspace', targetId: claimed.workspaceId,
        metadata: { repositoryId: claimed.repositoryId, runId, toSha: collection.toSha, fallbackFromIncremental: fallbackToBaseline },
      } });
    });
  }

  private async hasCurrentAuthority(tx: Prisma.TransactionClient, workspaceId: string, repositoryId: string): Promise<boolean> {
    const assignments = await tx.$queryRaw<Array<{ repositoryId: string }>>(Prisma.sql`
      SELECT wr.repository_id AS "repositoryId"
      FROM workspace_repositories wr
      INNER JOIN workspaces w ON w.id = wr.workspace_id AND w.archived_at IS NULL
      WHERE wr.workspace_id = ${workspaceId} AND wr.repository_id = ${repositoryId}
      FOR SHARE OF wr, w
    `);
    return assignments.length === 1
      && await hasWorkspaceRepositoryAuthority(tx, workspaceId, repositoryId);
  }

  private async blockAccess(tx: Prisma.TransactionClient, runId: string, analysisId: string, token?: string): Promise<void> {
    const blocked = await tx.workspaceAnalysisRun.updateMany({
      where: {
        id: runId,
        status: { in: ['PENDING', 'PROCESSING'] },
        ...(token === undefined ? {} : {
          processingToken: token,
          processingExpiresAt: { gt: new Date() },
        }),
      },
      data: {
        status: 'BLOCKED_ACCESS', accessState: 'ACCESS_REMOVED', completedAt: new Date(), error: SAFE_ACCESS_ERROR,
        processingToken: null, processingExpiresAt: null,
      },
    });
    if (blocked.count !== 1) return;
    await tx.workspaceRepositoryAnalysis.update({
      where: { id: analysisId },
      data: { status: 'BLOCKED_ACCESS', accessState: 'ACCESS_REMOVED', lastError: SAFE_ACCESS_ERROR },
    });
  }

  private async lockAnalysis(tx: Prisma.TransactionClient, analysisId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM workspace_repository_analyses WHERE id = ${analysisId} FOR UPDATE`);
  }

  private async hasNewerRun(
    tx: Prisma.TransactionClient,
    claimed: { id: string; analysisId: string; dataCutoffAt: Date; createdAt: Date },
    statuses: Array<'PENDING' | 'PROCESSING' | 'COMPLETED'>,
  ): Promise<boolean> {
    return await tx.workspaceAnalysisRun.findFirst({
      where: {
        analysisId: claimed.analysisId,
        id: { not: claimed.id },
        status: { in: statuses },
        OR: [
          { dataCutoffAt: { gt: claimed.dataCutoffAt } },
          { dataCutoffAt: claimed.dataCutoffAt, createdAt: { gt: claimed.createdAt } },
          { dataCutoffAt: claimed.dataCutoffAt, createdAt: claimed.createdAt, id: { gt: claimed.id } },
        ],
      },
      select: { id: true },
    }) !== null;
  }

  private boundedError(error: unknown): string {
    const value = error instanceof Error ? error.message : 'Repository analysis failed.';
    return value.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  }
}
