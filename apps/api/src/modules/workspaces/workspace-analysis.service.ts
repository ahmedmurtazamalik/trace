import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { hasWorkspaceRepositoryAuthority, Prisma, PrismaService } from '@trace/database';
import {
  workspaceAnalysisResponseSchema,
  workspaceAnalysisStartResponseSchema,
  workspaceAnalysisCoverageSchema,
  type WorkspaceAnalysisResponse,
  type WorkspaceAnalysisStartResponse,
} from '@trace/shared';
import { WorkspaceAnalysisPublisher } from './workspace-analysis.publisher';

@Injectable()
export class WorkspaceAnalysisService {
  constructor(private readonly prisma: PrismaService, private readonly publisher: WorkspaceAnalysisPublisher) {}

  async list(userId: string, workspaceId: string): Promise<WorkspaceAnalysisResponse> {
    await this.requireMembership(this.prisma, userId, workspaceId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      const membership = await this.requireMembership(tx, userId, workspaceId);
      const assignments = await tx.workspaceRepository.findMany({ where: { workspaceId }, select: { repositoryId: true } });
      for (const assignment of assignments) {
        await tx.workspaceRepositoryAnalysis.upsert({
          where: { workspaceId_repositoryId: { workspaceId, repositoryId: assignment.repositoryId } },
          create: { workspaceId, repositoryId: assignment.repositoryId },
          update: {},
        });
      }
      const analyses = await tx.workspaceRepositoryAnalysis.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        include: { repository: { include: { installation: true } }, runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      const assignedIds = new Set(assignments.map((item) => item.repositoryId));
      return workspaceAnalysisResponseSchema.parse({ items: await Promise.all(analyses.map(async (analysis) => {
        const active = assignedIds.has(analysis.repositoryId)
          && await hasWorkspaceRepositoryAuthority(tx, workspaceId, analysis.repositoryId);
        const currentness = {
          workspaceId: analysis.workspaceId,
          repositoryId: analysis.repositoryId,
          repositoryFullName: analysis.repository.fullName,
          status: active
            ? membership.role === 'MANAGER'
              ? analysis.status
              : analysis.lastAnalyzedSha === null ? 'UNINITIALIZED' : 'COMPLETED'
            : 'BLOCKED_ACCESS',
          baselineSha: analysis.baselineSha,
          lastAnalyzedSha: analysis.lastAnalyzedSha,
          baselineCompletedAt: analysis.baselineCompletedAt?.toISOString() ?? null,
          lastAnalyzedAt: analysis.lastAnalyzedAt?.toISOString() ?? null,
          accessState: active ? 'ACTIVE' : 'ACCESS_REMOVED',
          coverage: analysis.coverage === null ? null : workspaceAnalysisCoverageSchema.parse(analysis.coverage),
        };
        return membership.role === 'MANAGER' ? {
          ...currentness,
          baselineStartedAt: analysis.baselineStartedAt?.toISOString() ?? null,
          lastError: analysis.lastError,
          latestRun: analysis.runs[0] === undefined ? null : this.run(analysis.runs[0]),
        } : currentness;
      })) });
    });
  }

  async start(userId: string, workspaceId: string, repositoryId: string): Promise<WorkspaceAnalysisStartResponse> {
    await this.assignmentForManager(userId, workspaceId, repositoryId);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`);
      await this.requireManager(tx, userId, workspaceId);
      const assignment = await tx.workspaceRepository.findUnique({
        where: { workspaceId_repositoryId: { workspaceId, repositoryId } },
        include: { repository: { include: { installation: true } } },
      });
      if (assignment === null) this.fail('WORKSPACE_REPOSITORY_NOT_ASSIGNED', 'This repository is not assigned to the workspace.', HttpStatus.NOT_FOUND);
      if (!await hasWorkspaceRepositoryAuthority(tx, workspaceId, repositoryId)) {
        await tx.workspaceRepositoryAnalysis.updateMany({ where: { workspaceId, repositoryId }, data: { status: 'BLOCKED_ACCESS', accessState: 'ACCESS_REMOVED', lastError: 'Current GitHub App access is unavailable.' } });
        this.fail('WORKSPACE_REPOSITORY_ACCESS_REMOVED', 'Current GitHub App access to this repository is unavailable.', HttpStatus.CONFLICT);
      }
      const analysis = await tx.workspaceRepositoryAnalysis.upsert({
        where: { workspaceId_repositoryId: { workspaceId, repositoryId } },
        create: { workspaceId, repositoryId }, update: {},
      });
      const active = await tx.workspaceAnalysisRun.findFirst({
        where: { analysisId: analysis.id, status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' },
      });
      if (active !== null) return { run: active, publish: false };
      const kind = analysis.baselineSha === null ? 'BASELINE' : 'INCREMENTAL';
      const run = await tx.workspaceAnalysisRun.create({ data: {
        analysisId: analysis.id, workspaceId, repositoryId, kind,
        fromSha: kind === 'BASELINE' ? null : analysis.lastAnalyzedSha,
        toSha: null, dataCutoffAt: new Date(), status: 'PENDING', accessState: 'ACTIVE', evidence: {},
      } });
      await tx.workspaceRepositoryAnalysis.update({ where: { id: analysis.id }, data: { status: 'PENDING', accessState: 'ACTIVE', lastError: null } });
      await tx.auditLog.create({ data: { actorUserId: userId, action: 'workspace.analysis_started', targetType: 'workspace', targetId: workspaceId, metadata: { repositoryId, runId: run.id, kind } } });
      return { run, publish: true };
    });
    if (result.publish) await this.publisher.publishOne(result.run.id);
    return workspaceAnalysisStartResponseSchema.parse({
      analysis: await this.currentResponseItem(workspaceId, repositoryId),
      run: this.run(result.run),
    });
  }

  private async assignmentForManager(userId: string, workspaceId: string, repositoryId: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { workspace: true } });
    if (membership === null) this.fail('WORKSPACE_NOT_FOUND', 'Workspace not found.', HttpStatus.NOT_FOUND);
    if (membership.role !== 'MANAGER') this.fail('WORKSPACE_MANAGER_REQUIRED', 'A workspace Manager is required.', HttpStatus.FORBIDDEN);
    if (membership.workspace.archivedAt !== null) this.fail('WORKSPACE_ARCHIVED', 'Archived workspaces are read-only.', HttpStatus.CONFLICT);
    const assignment = await this.prisma.workspaceRepository.findUnique({
      where: { workspaceId_repositoryId: { workspaceId, repositoryId } },
      include: { repository: { include: { installation: true } } },
    });
    if (assignment === null) this.fail('WORKSPACE_REPOSITORY_NOT_ASSIGNED', 'This repository is not assigned to the workspace.', HttpStatus.NOT_FOUND);
    if (!await hasWorkspaceRepositoryAuthority(this.prisma, workspaceId, repositoryId)) this.fail('WORKSPACE_REPOSITORY_ACCESS_REMOVED', 'Current GitHub App access to this repository is unavailable.', HttpStatus.CONFLICT);
    const analysis = await this.prisma.workspaceRepositoryAnalysis.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
    return { ...assignment, analysis };
  }

  private async lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`);
    if (rows.length === 0) this.fail('WORKSPACE_NOT_FOUND', 'Workspace not found.', HttpStatus.NOT_FOUND);
  }

  private async requireMembership(client: PrismaService | Prisma.TransactionClient, userId: string, workspaceId: string) {
    const membership = await client.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (membership === null) this.fail('WORKSPACE_NOT_FOUND', 'Workspace not found.', HttpStatus.NOT_FOUND);
    return membership;
  }

  private async requireManager(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    const membership = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { workspace: true } });
    if (membership === null) this.fail('WORKSPACE_NOT_FOUND', 'Workspace not found.', HttpStatus.NOT_FOUND);
    if (membership.role !== 'MANAGER') this.fail('WORKSPACE_MANAGER_REQUIRED', 'A workspace Manager is required.', HttpStatus.FORBIDDEN);
    if (membership.workspace.archivedAt !== null) this.fail('WORKSPACE_ARCHIVED', 'Archived workspaces are read-only.', HttpStatus.CONFLICT);
  }

  private async currentResponseItem(workspaceId: string, repositoryId: string) {
    return this.prisma.$transaction((tx) => this.responseItem(tx, workspaceId, repositoryId));
  }

  private async responseItem(tx: Prisma.TransactionClient, workspaceId: string, repositoryId: string) {
    const analysis = await tx.workspaceRepositoryAnalysis.findUniqueOrThrow({
      where: { workspaceId_repositoryId: { workspaceId, repositoryId } },
      include: { repository: { include: { installation: true } }, runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const active = await hasWorkspaceRepositoryAuthority(tx, workspaceId, repositoryId);
    return {
      workspaceId, repositoryId, repositoryFullName: analysis.repository.fullName,
      status: active ? analysis.status : 'BLOCKED_ACCESS', baselineSha: analysis.baselineSha, lastAnalyzedSha: analysis.lastAnalyzedSha,
      baselineStartedAt: analysis.baselineStartedAt?.toISOString() ?? null, baselineCompletedAt: analysis.baselineCompletedAt?.toISOString() ?? null,
      lastAnalyzedAt: analysis.lastAnalyzedAt?.toISOString() ?? null, accessState: active ? 'ACTIVE' : 'ACCESS_REMOVED',
      coverage: analysis.coverage === null ? null : workspaceAnalysisCoverageSchema.parse(analysis.coverage), lastError: analysis.lastError,
      latestRun: analysis.runs[0] === undefined ? null : this.run(analysis.runs[0]),
    };
  }

  private run(value: { id: string; workspaceId: string; repositoryId: string; kind: 'BASELINE' | 'INCREMENTAL'; fromSha: string | null; toSha: string | null; dataCutoffAt: Date; status: 'UNINITIALIZED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'BLOCKED_ACCESS'; accessState: 'ACTIVE' | 'ACCESS_REMOVED'; coverage: unknown; startedAt: Date | null; completedAt: Date | null; error: string | null }) {
    return {
      id: value.id, workspaceId: value.workspaceId, repositoryId: value.repositoryId, kind: value.kind,
      fromSha: value.fromSha, toSha: value.toSha, dataCutoffAt: value.dataCutoffAt.toISOString(), status: value.status,
      accessState: value.accessState, coverage: value.coverage === null ? null : workspaceAnalysisCoverageSchema.parse(value.coverage),
      startedAt: value.startedAt?.toISOString() ?? null, completedAt: value.completedAt?.toISOString() ?? null, error: value.error,
    };
  }

  private boundedError(error: unknown): string {
    const text = error instanceof Error ? error.message : 'Unknown repository analysis failure.';
    return text.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  }

  private fail(code: string, message: string, status: HttpStatus): never {
    throw new HttpException({ code, message }, status);
  }
}
