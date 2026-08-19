import { PrismaService } from '@trace/database';
import { nextWorkspaceReportRun } from '@trace/shared';
import { ReportPublisher } from '../src/modules/reports/report.publisher';
import type { ReportQueue } from '../src/modules/reports/report.queue';
import { WorkspaceReportScheduler } from '../src/modules/workspaces/workspace-report.scheduler';
import { WorkspaceReportsService } from '../src/modules/workspaces/workspace-reports.service';

const prisma = new PrismaService();
const emailSuffix = '@workspace-scheduler.example.test';

async function clean(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { endsWith: emailSuffix } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  await prisma.workspace.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function databaseNow(): Promise<Date> {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  if (rows[0] === undefined) throw new Error('database clock unavailable');
  return rows[0].now;
}

async function fixture(index: number, options: { enabled?: boolean; archived?: boolean; daysMissed?: number } = {}) {
  const now = await databaseNow();
  const user = await prisma.user.create({ data: {
    username: `workspace-scheduler-${index}-${Date.now()}`, email: `${index}-${Date.now()}${emailSuffix}`, passwordHash: 'unused',
  } });
  const workspace = await prisma.workspace.create({ data: {
    name: `Scheduled workspace ${index}`, slug: `scheduled-${index}-${Date.now()}`, createdById: user.id,
    archivedAt: options.archived === true ? now : null,
    memberships: { create: { userId: user.id, role: 'MANAGER' } },
  } });
  const rule = { frequency: 'DAILY' as const, selectedDays: [] as number[], localTime: '00:00', timezone: 'UTC' };
  const due = nextWorkspaceReportRun(rule, new Date(now.getTime() - (options.daysMissed ?? 1) * 86_400_000 - 60_000));
  const schedule = await prisma.workspaceReportSchedule.create({ data: {
    workspaceId: workspace.id, configuredById: user.id, enabled: options.enabled ?? true, ...rule, nextRunAt: due,
  } });
  return { now, user, workspace, schedule, rule };
}

function scheduler(published: string[]): WorkspaceReportScheduler {
  const publisher = { publishOneBounded: (reportId: string) => { published.push(reportId); return Promise.resolve(); } } as ReportPublisher;
  const reports = new WorkspaceReportsService(prisma, publisher, {} as never);
  return new WorkspaceReportScheduler(prisma, reports, publisher);
}

describe('workspace report scheduler', () => {
  beforeAll(async () => prisma.$connect());
  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('uses skip-locked claims and the unique due key to publish one occurrence under concurrent and duplicate runs', async () => {
    const first = await fixture(1);
    const second = await fixture(2);
    const published: string[] = [];

    await Promise.all([scheduler(published).runDue(), scheduler(published).runDue()]);
    await scheduler(published).runDue();

    const workspaceIds = [first.workspace.id, second.workspace.id];
    const occurrences = await prisma.workspaceReportOccurrence.findMany({
      where: { workspaceId: { in: workspaceIds } },
      orderBy: { workspaceId: 'asc' },
    });
    expect(occurrences).toHaveLength(2);
    expect(new Set(occurrences.map(({ workspaceId }) => workspaceId))).toEqual(new Set(workspaceIds));
    expect(new Set(published)).toEqual(new Set(occurrences.map(({ reportId }) => reportId)));
    expect(published).toHaveLength(2);
    expect(await prisma.report.count({ where: { workspaceId: { in: [first.workspace.id, second.workspace.id] } } })).toBe(2);
  });

  it('recovers only the latest missed instant, records skipped metadata, and advances after database time', async () => {
    const value = await fixture(3, { daysMissed: 5 });
    const published: string[] = [];

    await scheduler(published).runDue();

    const occurrence = await prisma.workspaceReportOccurrence.findFirstOrThrow({ where: { workspaceId: value.workspace.id } });
    const schedule = await prisma.workspaceReportSchedule.findUniqueOrThrow({ where: { id: value.schedule.id } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: value.workspace.id, action: 'workspace.report_recovered' } });
    expect(occurrence).toMatchObject({ trigger: 'RECOVERY', scheduleVersion: 1, status: 'PENDING', noActivity: true });
    expect(occurrence.recoveredAt).toBeInstanceOf(Date);
    expect(occurrence.scheduledFor!.getTime()).toBeGreaterThan(value.schedule.nextRunAt!.getTime());
    expect(schedule.nextRunAt!.getTime()).toBeGreaterThan((await databaseNow()).getTime());
    if (typeof audit.metadata !== 'object' || audit.metadata === null || Array.isArray(audit.metadata)) throw new Error('missing recovery audit metadata');
    const metadata = audit.metadata as Record<string, unknown>;
    expect(typeof metadata.recoveredAt).toBe('string');
    const skippedRuns = metadata.skippedRuns;
    expect(typeof skippedRuns).toBe('number');
    if (typeof skippedRuns !== 'number') throw new Error('invalid skipped run count');
    expect(skippedRuns).toBeGreaterThan(0);
    expect(published).toEqual([occurrence.reportId]);
  });

  it('reconciles a committed pending report after a crash before queue publication', async () => {
    const value = await fixture(6);
    const crashingPublisher = { publishOneBounded: () => Promise.reject(new Error('simulated process crash')) } as unknown as ReportPublisher;
    const reports = new WorkspaceReportsService(prisma, crashingPublisher, {} as never);

    await expect(new WorkspaceReportScheduler(prisma, reports, crashingPublisher).runDue()).rejects.toThrow('simulated process crash');

    const occurrence = await prisma.workspaceReportOccurrence.findFirstOrThrow({ where: { workspaceId: value.workspace.id } });
    const enqueue = jest.fn().mockResolvedValue(undefined);
    await new ReportPublisher(prisma, { enqueue } as unknown as ReportQueue).publishOwed();
    expect(occurrence.status).toBe('PENDING');
    expect(enqueue).toHaveBeenCalledWith(occurrence.reportId);
  });

  it('does not run disabled schedules and disables an archived schedule with skipped audit metadata', async () => {
    const disabled = await fixture(4, { enabled: false });
    const archived = await fixture(5, { archived: true });
    const published: string[] = [];

    await scheduler(published).runDue();

    expect(await prisma.workspaceReportOccurrence.count({ where: { workspaceId: { in: [disabled.workspace.id, archived.workspace.id] } } })).toBe(0);
    expect(published).toEqual([]);
    expect(await prisma.workspaceReportSchedule.findUniqueOrThrow({ where: { id: disabled.schedule.id } })).toMatchObject({ enabled: false });
    expect(await prisma.workspaceReportSchedule.findUniqueOrThrow({ where: { id: archived.schedule.id } })).toMatchObject({ enabled: false, nextRunAt: null });
    const skippedAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: archived.workspace.id, action: 'workspace.schedule_run_skipped' } });
    if (typeof skippedAudit.metadata !== 'object' || skippedAudit.metadata === null || Array.isArray(skippedAudit.metadata)) throw new Error('missing skipped audit metadata');
    expect((skippedAudit.metadata as Record<string, unknown>).reason).toBe('WORKSPACE_ARCHIVED');
  });
});
