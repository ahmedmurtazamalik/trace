import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaService } from '@trace/database';
import {
  nextWorkspaceReportRun,
  workspaceIntendedLocalDateTime,
  workspaceTimezoneSchema,
  type WorkspaceReportScheduleRule,
} from '@trace/shared';
import { ReportPublisher } from '../reports/report.publisher';
import { WorkspaceReportsService } from './workspace-reports.service';

const SCHEDULE_INTERVAL_MS = 5_000;
const SCHEDULE_RECOVERY_GRACE_MS = SCHEDULE_INTERVAL_MS * 2;
const SCHEDULE_BATCH_SIZE = 25;
const MAX_MISSED_RUNS = 10_000;

type ScheduleRow = {
  id: string;
  workspaceId: string;
  enabled: boolean;
  frequency: 'DAILY' | 'WEEKDAYS' | 'SELECTED_DAYS';
  selectedDays: number[];
  localTime: string;
  timezone: string;
  version: number;
  configuredById: string;
  nextRunAt: Date | null;
  workspace: { archivedAt: Date | null };
};

type ClaimResult = { claimed: false } | { claimed: true; reportId: string | null };

@Injectable()
export class WorkspaceReportScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceReportScheduler.name);
  private interval: NodeJS.Timeout | undefined;
  private reconciliation: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceReports: WorkspaceReportsService,
    private readonly publisher: ReportPublisher,
  ) {}

  onApplicationBootstrap(): void {
    void this.runDue().catch((error: unknown) => this.logFailure('startup reconciliation', error));
    this.interval = setInterval(
      () => void this.runDue().catch((error: unknown) => this.logFailure('interval reconciliation', error)),
      SCHEDULE_INTERVAL_MS,
    );
    this.interval.unref();
  }

  async runDue(): Promise<void> {
    if (this.reconciliation !== undefined) return this.reconciliation;
    this.reconciliation = this.reconcile();
    try {
      await this.reconciliation;
    } finally {
      this.reconciliation = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    await this.reconciliation;
  }

  private async reconcile(): Promise<void> {
    const reportIds: string[] = [];
    for (let index = 0; index < SCHEDULE_BATCH_SIZE; index += 1) {
      const result = await this.claimOne();
      if (!result.claimed) break;
      if (result.reportId !== null) reportIds.push(result.reportId);
    }
    for (const reportId of reportIds) await this.publisher.publishOneBounded(reportId);
  }

  private async claimOne(): Promise<ClaimResult> {
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string; workspaceId: string }>>(Prisma.sql`
        SELECT schedule."id", schedule."workspace_id" AS "workspaceId"
        FROM "workspace_report_schedules" schedule
        WHERE schedule."enabled" = true
          AND schedule."next_run_at" IS NOT NULL
          AND schedule."next_run_at" <= clock_timestamp()
        ORDER BY schedule."next_run_at" ASC, schedule."id" ASC
        LIMIT 1
      `);
      const candidate = candidates[0];
      if (candidate === undefined) return { claimed: false };

      const workspaceRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT workspace."id"
        FROM "workspaces" workspace
        WHERE workspace."id" = ${candidate.workspaceId}
        FOR UPDATE OF workspace SKIP LOCKED
      `);
      if (workspaceRows.length === 0) return { claimed: true, reportId: null };
      await transaction.$queryRaw(Prisma.sql`
        SELECT schedule."id"
        FROM "workspace_report_schedules" schedule
        WHERE schedule."id" = ${candidate.id}
        FOR UPDATE OF schedule
      `);

      const clock = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
      const now = clock[0]?.now;
      if (now === undefined) throw new Error('WORKSPACE_SCHEDULE_DATABASE_CLOCK');
      const schedule = await transaction.workspaceReportSchedule.findUnique({
        where: { id: candidate.id },
        include: { workspace: { select: { archivedAt: true } } },
      }) as ScheduleRow | null;
      if (schedule === null || !schedule.enabled || schedule.nextRunAt === null || schedule.nextRunAt > now) {
        return { claimed: true, reportId: null };
      }
      if (schedule.workspace.archivedAt !== null) {
        await transaction.workspaceReportSchedule.update({
          where: { id: schedule.id },
          data: { enabled: false, nextRunAt: null, lastEvaluatedAt: now },
        });
        await transaction.auditLog.create({ data: {
          actorUserId: schedule.configuredById,
          action: 'workspace.schedule_run_skipped',
          targetType: 'workspace',
          targetId: schedule.workspaceId,
          metadata: { scheduleId: schedule.id, scheduleVersion: schedule.version, reason: 'WORKSPACE_ARCHIVED', skippedAt: now.toISOString() },
        } });
        return { claimed: true, reportId: null };
      }
      if (!workspaceTimezoneSchema.safeParse(schedule.timezone).success) {
        await transaction.workspaceReportSchedule.update({
          where: { id: schedule.id },
          data: { enabled: false, nextRunAt: null, lastEvaluatedAt: now },
        });
        await transaction.auditLog.create({ data: {
          actorUserId: schedule.configuredById,
          action: 'workspace.schedule_run_skipped',
          targetType: 'workspace',
          targetId: schedule.workspaceId,
          metadata: { scheduleId: schedule.id, scheduleVersion: schedule.version, reason: 'TIMEZONE_INVALID', skippedAt: now.toISOString() },
        } });
        return { claimed: true, reportId: null };
      }

      const rule: WorkspaceReportScheduleRule = schedule;
      const missed = latestMissedWorkspaceReportRun(rule, schedule.nextRunAt, now);
      const windowStart = previousWorkspaceReportRun(rule, missed.scheduledFor);
      const frozen = await this.workspaceReports.freezeEvidence(
        transaction,
        schedule.workspaceId,
        windowStart,
        missed.scheduledFor,
        schedule.timezone,
      );
      const report = await transaction.report.create({ data: {
        userId: schedule.configuredById,
        workspaceId: schedule.workspaceId,
        reportDate: new Date(`${workspaceIntendedLocalDateTime(missed.scheduledFor, schedule.timezone).slice(0, 10)}T00:00:00.000Z`),
        timezone: schedule.timezone,
        status: 'pending',
        inputSnapshot: frozen.reportSnapshot,
      } });
      const recoveredAt = isWorkspaceReportRecovery(missed.scheduledFor, now) ? now : null;
      const occurrence = await transaction.workspaceReportOccurrence.create({ data: {
        workspaceId: schedule.workspaceId,
        scheduleId: schedule.id,
        scheduleVersion: schedule.version,
        trigger: recoveredAt === null ? 'SCHEDULED' : 'RECOVERY',
        scheduledFor: missed.scheduledFor,
        intendedLocalDateTime: workspaceIntendedLocalDateTime(missed.scheduledFor, schedule.timezone),
        windowStart,
        windowEnd: missed.scheduledFor,
        dataCutoffAt: missed.scheduledFor,
        requestedById: schedule.configuredById,
        reportId: report.id,
        idempotencyKey: `schedule:${schedule.id}:${missed.scheduledFor.toISOString()}`,
        evidenceSnapshot: frozen.evidenceSnapshot,
        noActivity: frozen.noActivity,
        recoveredAt,
      } });
      await transaction.workspaceReportSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: missed.nextRunAt, lastEvaluatedAt: now },
      });
      await transaction.auditLog.create({ data: {
        actorUserId: schedule.configuredById,
        action: recoveredAt === null ? 'workspace.schedule_run_created' : 'workspace.report_recovered',
        targetType: 'workspace',
        targetId: schedule.workspaceId,
        metadata: {
          scheduleId: schedule.id,
          scheduleVersion: schedule.version,
          occurrenceId: occurrence.id,
          reportId: report.id,
          scheduledFor: missed.scheduledFor.toISOString(),
          recoveredAt: recoveredAt?.toISOString() ?? null,
          skippedRuns: missed.skippedRuns,
        },
      } });
      return { claimed: true, reportId: report.id };
    });
  }

  private logFailure(operation: string, error: unknown): void {
    const type = error instanceof Error ? error.name : 'UnknownError';
    this.logger.error(`Failed workspace report schedule ${operation} (type=${type})`);
  }
}

export function latestMissedWorkspaceReportRun(
  rule: WorkspaceReportScheduleRule,
  firstDue: Date,
  now: Date,
): { scheduledFor: Date; nextRunAt: Date; skippedRuns: number } {
  if (firstDue > now) throw new Error('WORKSPACE_SCHEDULE_NOT_DUE');
  let scheduledFor = firstDue;
  let nextRunAt = nextWorkspaceReportRun(rule, scheduledFor);
  let skippedRuns = 0;
  while (nextRunAt <= now) {
    scheduledFor = nextRunAt;
    nextRunAt = nextWorkspaceReportRun(rule, scheduledFor);
    skippedRuns += 1;
    if (skippedRuns > MAX_MISSED_RUNS) throw new Error('WORKSPACE_SCHEDULE_RECOVERY_LIMIT');
  }
  return { scheduledFor, nextRunAt, skippedRuns };
}

export function isWorkspaceReportRecovery(scheduledFor: Date, now: Date): boolean {
  return now.getTime() - scheduledFor.getTime() >= SCHEDULE_RECOVERY_GRACE_MS;
}

export function previousWorkspaceReportRun(rule: WorkspaceReportScheduleRule, scheduledFor: Date): Date {
  let previous = nextWorkspaceReportRun(rule, new Date(scheduledFor.getTime() - 15 * 86_400_000));
  let next = nextWorkspaceReportRun(rule, previous);
  while (next < scheduledFor) {
    previous = next;
    next = nextWorkspaceReportRun(rule, previous);
  }
  if (next.getTime() !== scheduledFor.getTime()) throw new Error('WORKSPACE_SCHEDULE_PREVIOUS_RUN_NOT_FOUND');
  return previous;
}
