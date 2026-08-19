import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { hasWorkspaceRepositoryAuthority, Prisma, PrismaService } from '@trace/database';
import {
  nextWorkspaceReportRun,
  workspaceIntendedLocalDateTime,
  workspaceReportGenerateRequestSchema,
  workspaceReportScheduleRequestSchema,
  workspaceReportDetailResponseSchema,
  workspaceReportEvidenceRepositorySchema,
  type WorkspaceReportGenerateResponse,
  type WorkspaceReportOccurrence,
  type WorkspaceReportOccurrenceListResponse,
  type WorkspaceReportScheduleResponse,
  type WorkspaceReportDetailResponse,
  type ReportDetailResponse,
  type ReportListResponse,
} from '@trace/shared';
import { ReportPublisher } from '../reports/report.publisher';
import { ReportsService, type ReportArtifactDownload } from '../reports/reports.service';

const MAX_COMMITS = 10_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

type Transaction = Prisma.TransactionClient;

type WorkspaceReportFactRow = {
  repositoryId: string;
  authorContributorId: string | null;
  authorEmail: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  files: unknown[];
};

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function workspaceReportFacts(rows: WorkspaceReportFactRow[]) {
  return {
    repositoryCount: new Set(rows.map((row) => row.repositoryId)).size,
    contributorCount: new Set(rows.map((row) => row.authorContributorId ?? `git:${row.authorEmail.toLowerCase()}`)).size,
    commitCount: rows.length,
    filesChanged: rows.reduce((total, row) => total + (row.changedFiles ?? row.files.length), 0),
    additions: rows.reduce((total, row) => total + (row.additions ?? 0), 0),
    deletions: rows.reduce((total, row) => total + (row.deletions ?? 0), 0),
  };
}

@Injectable()
export class WorkspaceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: ReportPublisher,
    private readonly reports: ReportsService,
  ) {}

  async list(userId: string, workspaceId: string, input: unknown): Promise<ReportListResponse> {
    await this.requireMember(this.prisma, userId, workspaceId);
    return this.reports.listWorkspace(userId, workspaceId, input);
  }

  async detail(userId: string, workspaceId: string, reportId: string): Promise<WorkspaceReportDetailResponse> {
    const detail = await this.reports.detailWorkspace(userId, workspaceId, reportId);
    const occurrence = await this.prisma.workspaceReportOccurrence.findFirst({
      where: {
        reportId,
        workspaceId,
        workspace: { memberships: { some: { userId } } },
      },
      select: {
        workspaceId: true,
        trigger: true,
        scheduleVersion: true,
        scheduledFor: true,
        intendedLocalDateTime: true,
        windowStart: true,
        windowEnd: true,
        dataCutoffAt: true,
        recoveredAt: true,
        noActivity: true,
        evidenceSnapshot: true,
        workspace: { select: { name: true } },
      },
    });
    if (occurrence === null || occurrence.noActivity === null) this.notFound();
    const snapshot = jsonRecord(occurrence.evidenceSnapshot);
    const rawRepositories = snapshot?.repositories;
    if (!Array.isArray(rawRepositories)) this.notFound();
    try {
      const repositories = rawRepositories.map((value) => {
        const repository = jsonRecord(value);
        if (repository === null) this.notFound();
        return workspaceReportEvidenceRepositorySchema.parse({
          repositoryId: repository.repositoryId,
          fullName: repository.fullName,
          accessState: repository.accessState,
          coverage: repository.coverage ?? null,
          baselineOnly: repository.baselineOnly,
          activityCount: repository.activityCount,
        });
      });
      return workspaceReportDetailResponseSchema.parse({
        ...detail,
        workspaceEvidence: {
          workspaceId: occurrence.workspaceId,
          workspaceName: occurrence.workspace.name,
          trigger: occurrence.trigger,
          scheduleVersion: occurrence.scheduleVersion,
          scheduledFor: occurrence.scheduledFor?.toISOString() ?? null,
          intendedLocalDateTime: occurrence.intendedLocalDateTime,
          windowStart: occurrence.windowStart.toISOString(),
          windowEnd: occurrence.windowEnd.toISOString(),
          dataCutoffAt: occurrence.dataCutoffAt.toISOString(),
          recoveredAt: occurrence.recoveredAt?.toISOString() ?? null,
          noActivity: occurrence.noActivity,
          repositories,
        },
      });
    } catch {
      this.notFound();
    }
  }

  async updateRevision(userId: string, workspaceId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    await this.requireManager(this.prisma, userId, workspaceId);
    return this.reports.updateWorkspaceRevision(userId, workspaceId, reportId, input);
  }

  async regenerate(userId: string, workspaceId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    await this.requireManager(this.prisma, userId, workspaceId);
    return this.reports.regenerateWorkspace(userId, workspaceId, reportId, input);
  }

  async download(userId: string, workspaceId: string, reportId: string, input: unknown): Promise<ReportArtifactDownload> {
    await this.requireMember(this.prisma, userId, workspaceId);
    return this.reports.downloadWorkspace(userId, workspaceId, reportId, input);
  }

  async generate(userId: string, workspaceId: string, idempotencyKey: string | undefined, input: unknown): Promise<{ created: boolean; response: WorkspaceReportGenerateResponse }> {
    const parsed = workspaceReportGenerateRequestSchema.safeParse(input);
    if (!parsed.success || idempotencyKey === undefined || !IDEMPOTENCY_KEY.test(idempotencyKey)) this.validationError();
    const windowStart = new Date(parsed.data.windowStart);
    const windowEnd = new Date(parsed.data.windowEnd);
    const result = await this.withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, userId, workspaceId);
      const existing = await tx.workspaceReportOccurrence.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
      });
      if (existing !== null) {
        if (existing.windowStart.getTime() !== windowStart.getTime() || existing.windowEnd.getTime() !== windowEnd.getTime() || existing.trigger !== 'MANUAL') {
          throw new HttpException({ code: 'WORKSPACE_IDEMPOTENCY_CONFLICT', message: 'Idempotency key was already used for a different request.' }, HttpStatus.CONFLICT);
        }
        return { created: false, occurrence: existing };
      }

      const frozen = await this.freezeEvidence(tx, workspaceId, windowStart, windowEnd);
      const report = await tx.report.create({
        data: {
          userId,
          workspaceId,
          reportDate: new Date(`${parsed.data.windowEnd.slice(0, 10)}T00:00:00.000Z`),
          timezone: 'UTC',
          status: 'pending',
          inputSnapshot: frozen.reportSnapshot,
        },
      });
      const occurrence = await tx.workspaceReportOccurrence.create({
        data: {
          workspaceId,
          trigger: 'MANUAL',
          windowStart,
          windowEnd,
          dataCutoffAt: windowEnd,
          requestedById: userId,
          reportId: report.id,
          idempotencyKey,
          evidenceSnapshot: frozen.evidenceSnapshot,
          noActivity: frozen.noActivity,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'workspace.report_requested',
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: { occurrenceId: occurrence.id, reportId: report.id, trigger: 'MANUAL' },
        },
      });
      return { created: true, occurrence };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (result.created && result.occurrence.reportId !== null) void this.publisher.publishOneBounded(result.occurrence.reportId);
    return { created: result.created, response: { occurrence: this.occurrence(result.occurrence) } };
  }

  async getSchedule(userId: string, workspaceId: string): Promise<WorkspaceReportScheduleResponse> {
    await this.requireManagerRole(this.prisma, userId, workspaceId);
    const schedule = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManagerRole(tx, userId, workspaceId);
      return tx.workspaceReportSchedule.findFirst({
        where: { workspaceId, workspace: { memberships: { some: { userId, role: 'MANAGER' } } } },
      });
    });
    return { schedule: schedule === null ? null : this.schedule(schedule) };
  }

  async putSchedule(userId: string, workspaceId: string, input: unknown): Promise<WorkspaceReportScheduleResponse> {
    const parsed = workspaceReportScheduleRequestSchema.safeParse(input);
    if (!parsed.success) this.validationError();
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, userId, workspaceId);
      const existing = await tx.workspaceReportSchedule.findUnique({ where: { workspaceId } });
      const rule = parsed.data;
      const nextRunAt = rule.enabled ? nextWorkspaceReportRun(rule, now) : null;
      const schedule = existing === null
        ? await tx.workspaceReportSchedule.create({ data: { workspaceId, ...rule, configuredById: userId, nextRunAt } })
        : await tx.workspaceReportSchedule.update({
          where: { id: existing.id },
          data: { ...rule, configuredById: userId, version: { increment: 1 }, nextRunAt, lastEvaluatedAt: now },
        });
      await tx.auditLog.create({ data: {
        actorUserId: userId,
        action: existing === null ? 'workspace.schedule_created' : 'workspace.schedule_updated',
        targetType: 'workspace', targetId: workspaceId,
        metadata: {
          version: schedule.version,
          before: existing === null ? null : { enabled: existing.enabled, frequency: existing.frequency, selectedDays: existing.selectedDays, localTime: existing.localTime, timezone: existing.timezone },
          after: { enabled: schedule.enabled, frequency: schedule.frequency, selectedDays: schedule.selectedDays, localTime: schedule.localTime, timezone: schedule.timezone },
        },
      } });
      return schedule;
    });
    return { schedule: this.schedule(result) };
  }

  async disableSchedule(userId: string, workspaceId: string): Promise<WorkspaceReportScheduleResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, userId, workspaceId);
      const existing = await tx.workspaceReportSchedule.findUnique({ where: { workspaceId } });
      if (existing === null) return null;
      const schedule = await tx.workspaceReportSchedule.update({
        where: { id: existing.id },
        data: { enabled: false, nextRunAt: null, configuredById: userId, version: { increment: 1 }, lastEvaluatedAt: new Date() },
      });
      await tx.auditLog.create({ data: {
        actorUserId: userId, action: 'workspace.schedule_disabled', targetType: 'workspace', targetId: workspaceId,
        metadata: { version: schedule.version },
      } });
      return schedule;
    });
    return { schedule: result === null ? null : this.schedule(result) };
  }

  async listOccurrences(userId: string, workspaceId: string): Promise<WorkspaceReportOccurrenceListResponse> {
    await this.requireManagerRole(this.prisma, userId, workspaceId);
    const occurrences = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManagerRole(tx, userId, workspaceId);
      return tx.workspaceReportOccurrence.findMany({
        where: { workspaceId, workspace: { memberships: { some: { userId, role: 'MANAGER' } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
    });
    return { items: occurrences.map((occurrence) => this.occurrence(occurrence)) };
  }

  async freezeEvidence(tx: Transaction, workspaceId: string, windowStart: Date, windowEnd: Date, timezone = 'UTC'): Promise<{
    reportSnapshot: Prisma.InputJsonValue;
    evidenceSnapshot: Prisma.InputJsonValue;
    noActivity: boolean;
  }> {
    const assignments = await tx.workspaceRepository.findMany({
      where: { workspaceId },
      include: {
        repository: true,
        workspace: { select: { name: true } },
      },
      orderBy: [{ repository: { fullName: 'asc' } }, { repositoryId: 'asc' }],
      take: 100,
    });
    const repositoryIds = assignments.map((assignment) => assignment.repositoryId);
    const authority = new Map<string, boolean>();
    for (const assignment of assignments) {
      authority.set(
        assignment.repositoryId,
        await hasWorkspaceRepositoryAuthority(tx, workspaceId, assignment.repositoryId),
      );
    }
    const [commits, analysisStates] = await Promise.all([
      tx.commit.findMany({
        where: { repositoryId: { in: repositoryIds }, committedAt: { gte: windowStart, lt: windowEnd } },
        include: { authorContributor: true, files: true, repository: true },
        orderBy: [{ committedAt: 'asc' }, { sha: 'asc' }],
        take: MAX_COMMITS + 1,
      }),
      tx.workspaceRepositoryAnalysis.findMany({
        where: { workspaceId, repositoryId: { in: repositoryIds } },
        include: { runs: { where: { status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, take: 1 } },
      }),
    ]);
    if (commits.length > MAX_COMMITS) {
      throw new HttpException({ code: 'WORKSPACE_REPORT_TOO_LARGE', message: 'Workspace report evidence exceeds the safe limit.' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const analysisByRepository = new Map(analysisStates.map((state) => [state.repositoryId, state]));
    const repositories = assignments.map((assignment) => {
      const rows = commits.filter((commit) => commit.repositoryId === assignment.repositoryId);
      const contributorMap = new Map<string, typeof rows>();
      for (const row of rows) {
        const contributorId = row.authorContributorId ?? `git:${row.authorEmail}`;
        contributorMap.set(contributorId, [...(contributorMap.get(contributorId) ?? []), row]);
      }
      const facts = workspaceReportFacts(rows);
      return {
        id: assignment.repository.id,
        fullName: assignment.repository.fullName,
        facts,
        contributors: [...contributorMap.entries()].map(([id, contributorRows]) => ({
          id,
          username: contributorRows[0]?.authorContributor?.username ?? contributorRows[0]?.authorUsername ?? null,
          displayName: contributorRows[0]?.authorContributor?.displayName ?? contributorRows[0]?.authorName ?? null,
          facts: workspaceReportFacts(contributorRows),
        })),
        evidence: rows.map((row) => ({
          activityId: `commit:${row.id}`,
          occurredAt: row.committedAt.toISOString(),
          type: 'commit' as const,
          sha: row.sha,
          message: row.message,
        })),
      };
    });
    const facts = workspaceReportFacts(commits);
    const reportSnapshot = {
      version: 1 as const,
      reportDate: workspaceIntendedLocalDateTime(windowEnd, timezone).slice(0, 10),
      timezone,
      facts,
      repositories,
    };
    const evidenceSnapshot = {
      version: 1 as const,
      window: { start: windowStart.toISOString(), end: windowEnd.toISOString(), dataCutoffAt: windowEnd.toISOString() },
      limits: { repositories: 100, commits: MAX_COMMITS },
      noActivity: commits.length === 0,
      repositories: assignments.map((assignment) => {
        const analysis = analysisByRepository.get(assignment.repositoryId);
        const run = analysis?.runs[0];
        return {
          repositoryId: assignment.repositoryId,
          fullName: assignment.repository.fullName,
          accessState: authority.get(assignment.repositoryId) === true ? 'ACTIVE' : 'ACCESS_REMOVED',
          analysisStatus: analysis?.status ?? 'UNINITIALIZED',
          coverage: run?.coverage ?? analysis?.coverage ?? null,
          analysisRunId: run?.id ?? null,
          baselineOnly: run?.kind === 'BASELINE',
          activityCount: commits.filter((commit) => commit.repositoryId === assignment.repositoryId).length,
        };
      }),
    };
    return { reportSnapshot, evidenceSnapshot, noActivity: commits.length === 0 };
  }


  private schedule(value: {
    id: string; workspaceId: string; enabled: boolean; frequency: 'DAILY' | 'WEEKDAYS' | 'SELECTED_DAYS'; selectedDays: number[];
    localTime: string; timezone: string; version: number; configuredById: string; nextRunAt: Date | null; createdAt: Date; updatedAt: Date;
  }): NonNullable<WorkspaceReportScheduleResponse['schedule']> {
    return {
      id: value.id, workspaceId: value.workspaceId, enabled: value.enabled, frequency: value.frequency,
      selectedDays: value.selectedDays, localTime: value.localTime, timezone: value.timezone, version: value.version,
      configuredById: value.configuredById, nextRunAt: value.nextRunAt?.toISOString() ?? null,
      nextRunLocal: value.nextRunAt === null ? null : workspaceIntendedLocalDateTime(value.nextRunAt, value.timezone),
      createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
    };
  }

  private occurrence(value: {
    id: string; workspaceId: string; scheduleId: string | null; scheduleVersion: number | null; trigger: 'MANUAL' | 'SCHEDULED' | 'RECOVERY';
    scheduledFor: Date | null; intendedLocalDateTime: string | null; windowStart: Date; windowEnd: Date; dataCutoffAt: Date;
    requestedById: string; status: 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'; reportId: string | null;
    idempotencyKey: string; noActivity: boolean | null; recoveredAt: Date | null; createdAt: Date; startedAt: Date | null; completedAt: Date | null; error: string | null;
  }): WorkspaceReportOccurrence {
    return {
      id: value.id, workspaceId: value.workspaceId, scheduleId: value.scheduleId, scheduleVersion: value.scheduleVersion,
      trigger: value.trigger, scheduledFor: value.scheduledFor?.toISOString() ?? null, intendedLocalDateTime: value.intendedLocalDateTime,
      windowStart: value.windowStart.toISOString(), windowEnd: value.windowEnd.toISOString(), dataCutoffAt: value.dataCutoffAt.toISOString(),
      requestedById: value.requestedById, status: value.status, reportId: value.reportId, idempotencyKey: value.idempotencyKey,
      noActivity: value.noActivity, recoveredAt: value.recoveredAt?.toISOString() ?? null,
      createdAt: value.createdAt.toISOString(), startedAt: value.startedAt?.toISOString() ?? null,
      completedAt: value.completedAt?.toISOString() ?? null, error: value.error,
    };
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : undefined;
        if (code !== 'P2034' || attempt === 3) throw error;
      }
    }
    throw new Error('Workspace report transaction retry exhausted.');
  }

  private async lockWorkspace(tx: Transaction, workspaceId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`);
    if (rows.length === 0) this.notFound();
  }

  private async requireMember(client: PrismaService | Transaction, userId: string, workspaceId: string) {
    const membership = await client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (membership === null) this.notFound();
    return membership;
  }

  private async requireManager(client: PrismaService | Transaction, userId: string, workspaceId: string): Promise<void> {
    const membership = await this.requireManagerRole(client, userId, workspaceId);
    if (membership.workspace.archivedAt !== null) throw new HttpException({ code: 'WORKSPACE_ARCHIVED', message: 'Archived workspaces are read-only.' }, HttpStatus.CONFLICT);
  }

  private async requireManagerRole(client: PrismaService | Transaction, userId: string, workspaceId: string) {
    const membership = await this.requireMember(client, userId, workspaceId);
    if (membership.role !== 'MANAGER') throw new HttpException({ code: 'WORKSPACE_MANAGER_REQUIRED', message: 'Manager access required.' }, HttpStatus.FORBIDDEN);
    return membership;
  }

  private validationError(): never {
    throw new HttpException({ code: 'VALIDATION_ERROR', message: 'Workspace report request is invalid.' }, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private notFound(): never {
    throw new HttpException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' }, HttpStatus.NOT_FOUND);
  }
}
