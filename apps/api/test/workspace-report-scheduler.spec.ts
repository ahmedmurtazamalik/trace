import type { PrismaService } from '@trace/database';
import { resolveWorkspaceLocalDateTime } from '@trace/shared';
import type { ReportPublisher } from '../src/modules/reports/report.publisher';
import {
  latestMissedWorkspaceReportRun,
  isWorkspaceReportRecovery,
  previousWorkspaceReportRun,
  WorkspaceReportScheduler,
} from '../src/modules/workspaces/workspace-report.scheduler';
import type { WorkspaceReportsService } from '../src/modules/workspaces/workspace-reports.service';

describe('workspace report schedule runtime', () => {
  it('classifies one overdue run beyond bounded polling grace as recovery', () => {
    const scheduledFor = new Date('2026-08-18T17:00:00.000Z');
    expect(isWorkspaceReportRecovery(scheduledFor, new Date('2026-08-18T17:00:11.000Z'))).toBe(true);
    expect(isWorkspaceReportRecovery(scheduledFor, new Date('2026-08-18T17:00:09.999Z'))).toBe(false);
  });

  it('keeps latest-only recovery and prior windows linked to spring gaps and fall folds', () => {
    const springRule = { frequency: 'DAILY' as const, selectedDays: [], localTime: '02:30', timezone: 'America/New_York' };
    const firstSpring = resolveWorkspaceLocalDateTime('2026-03-07', '02:30', springRule.timezone);
    const recovered = latestMissedWorkspaceReportRun(
      springRule,
      firstSpring,
      new Date('2026-03-09T12:00:00.000Z'),
    );
    expect(recovered.scheduledFor.toISOString()).toBe('2026-03-09T06:30:00.000Z');
    expect(recovered.nextRunAt.toISOString()).toBe('2026-03-10T06:30:00.000Z');
    expect(recovered.skippedRuns).toBe(2);
    expect(previousWorkspaceReportRun(springRule, resolveWorkspaceLocalDateTime('2026-03-08', '02:30', springRule.timezone)).toISOString())
      .toBe('2026-03-07T07:30:00.000Z');

    const foldRule = { frequency: 'DAILY' as const, selectedDays: [], localTime: '01:30', timezone: 'America/New_York' };
    const fold = resolveWorkspaceLocalDateTime('2026-11-01', '01:30', foldRule.timezone);
    expect(fold.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(previousWorkspaceReportRun(foldRule, fold).toISOString()).toBe('2026-10-31T05:30:00.000Z');
  });

  it('waits for an in-flight reconciliation during module shutdown', async () => {
    let release = (): void => undefined;
    const blocked = new Promise<{ claimed: false }>((resolve) => { release = () => resolve({ claimed: false }); });
    const prisma = { $transaction: jest.fn(() => blocked) } as unknown as PrismaService;
    const scheduler = new WorkspaceReportScheduler(
      prisma,
      {} as WorkspaceReportsService,
      {} as ReportPublisher,
    );
    scheduler.onApplicationBootstrap();
    await Promise.resolve();

    let stopped = false;
    const shutdown = scheduler.onModuleDestroy().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await shutdown;
    expect(stopped).toBe(true);
  });
});
