import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const slug = 'workspace-reports-db-test';

describe('workspace report persistence', () => {
  beforeEach(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: slug } } });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: slug } } });
    await prisma.$disconnect();
  });

  it('enforces manual and scheduled occurrence idempotency while preserving snapshots', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Workspace reports DB', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
    } });
    const schedule = await prisma.workspaceReportSchedule.create({ data: {
      workspaceId: workspace.id, enabled: true, frequency: 'DAILY', selectedDays: [],
      localTime: '17:00', timezone: 'America/Los_Angeles', version: 1, configuredById: user.id,
      nextRunAt: new Date('2026-08-19T00:00:00.000Z'),
    } });
    const occurrenceData = {
      workspaceId: workspace.id, scheduleId: schedule.id, scheduleVersion: 1, trigger: 'SCHEDULED' as const,
      scheduledFor: new Date('2026-08-19T00:00:00.000Z'), intendedLocalDateTime: '2026-08-18T17:00',
      windowStart: new Date('2026-08-18T00:00:00.000Z'), windowEnd: new Date('2026-08-19T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-19T00:00:00.000Z'), requestedById: user.id,
      idempotencyKey: 'schedule:1:2026-08-19T00:00:00.000Z', evidenceSnapshot: { version: 1, repositories: [] },
    };
    const occurrence = await prisma.workspaceReportOccurrence.create({ data: occurrenceData });
    await expect(prisma.workspaceReportOccurrence.create({ data: { ...occurrenceData, idempotencyKey: 'different-key' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.workspaceReportOccurrence.create({ data: { ...occurrenceData, scheduleId: null, scheduleVersion: null, trigger: 'MANUAL', scheduledFor: null, intendedLocalDateTime: null } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { scheduleVersion: 2 },
    })).rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    await expect(prisma.workspaceReportSchedule.delete({ where: { id: schedule.id } }))
      .rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    expect((await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } })).evidenceSnapshot).toEqual({ version: 1, repositories: [] });
  });

  it('rejects direct mutation of a workspace report input snapshot', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Immutable report DB', slug: `${slug}-report-immutable`, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
    } });
    const report = await prisma.report.create({ data: {
      userId: user.id, workspaceId: workspace.id, reportDate: new Date('2026-08-18T00:00:00.000Z'),
      timezone: 'UTC', inputSnapshot: { version: 1, facts: { commitCount: 1 } },
    } });

    await expect(prisma.report.update({
      where: { id: report.id }, data: { inputSnapshot: { version: 1, facts: { commitCount: 999 } } },
    })).rejects.toThrow(/workspace report input snapshot is immutable/i);
  });

  it('rejects direct mutation and deletion of occurrence snapshots', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Immutable occurrence DB', slug: `${slug}-immutable`, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
    } });
    const occurrence = await prisma.workspaceReportOccurrence.create({ data: {
      workspaceId: workspace.id, trigger: 'MANUAL',
      windowStart: new Date('2026-08-17T00:00:00.000Z'), windowEnd: new Date('2026-08-18T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-18T00:00:00.000Z'), requestedById: user.id,
      idempotencyKey: 'immutable-manual', evidenceSnapshot: { version: 1, repositories: ['repo-1'] }, noActivity: false,
    } });

    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { windowEnd: new Date('2026-08-19T00:00:00.000Z') },
    })).rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { evidenceSnapshot: { version: 2, repositories: [] } },
    })).rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { dataCutoffAt: new Date('2026-08-17T12:00:00.000Z') },
    })).rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { idempotencyKey: 'tampered-request-identity' },
    })).rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { recoveredAt: new Date('2026-08-18T01:00:00.000Z') },
    })).rejects.toThrow(/workspace report occurrence snapshot is immutable/i);
    await expect(prisma.workspaceReportOccurrence.delete({ where: { id: occurrence.id } }))
      .rejects.toThrow(/workspace report occurrence snapshot cannot be deleted/i);
  });

  it('allows occurrence lifecycle and report-linkage fields to advance legally', async () => {
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Occurrence lifecycle DB', slug: `${slug}-lifecycle`, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
    } });
    const report = await prisma.report.create({ data: {
      userId: user.id, workspaceId: workspace.id, reportDate: new Date('2026-08-18T00:00:00.000Z'),
      timezone: 'UTC', inputSnapshot: {},
    } });
    const occurrence = await prisma.workspaceReportOccurrence.create({ data: {
      workspaceId: workspace.id, trigger: 'MANUAL',
      windowStart: new Date('2026-08-17T00:00:00.000Z'), windowEnd: new Date('2026-08-18T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-18T00:00:00.000Z'), requestedById: user.id,
      idempotencyKey: 'lifecycle-manual', evidenceSnapshot: { version: 1, repositories: [] },
    } });
    const startedAt = new Date('2026-08-18T00:01:00.000Z');
    await prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { status: 'QUEUED', publishedAt: startedAt, reportId: report.id },
    });
    await prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { status: 'PROCESSING', startedAt },
    });
    const completedAt = new Date('2026-08-18T00:02:00.000Z');
    const completed = await prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { status: 'COMPLETED', completedAt, error: null },
    });
    expect(completed).toMatchObject({ reportId: report.id, status: 'COMPLETED', startedAt, completedAt });
    await expect(prisma.workspaceReportOccurrence.update({
      where: { id: occurrence.id }, data: { status: 'PROCESSING', completedAt: null },
    })).rejects.toThrow(/terminal workspace report occurrence is immutable/i);

    await expect(prisma.report.delete({ where: { id: report.id } }))
      .rejects.toThrow(/foreign key constraint/i);
    expect(await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } }))
      .toMatchObject({ reportId: report.id, status: 'COMPLETED' });
  });
});
