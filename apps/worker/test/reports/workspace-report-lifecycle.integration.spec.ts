import { PrismaClient } from '@trace/database';
import { markWorkspaceReportFailed } from '../../src/reports/workspace-report-lifecycle';

const prisma = new PrismaClient();
const email = 'workspace-occurrence-failure-time@example.test';
const slug = 'workspace-occurrence-failure-time';

describe('workspace report failure lifecycle', () => {
  afterEach(async () => {
    await prisma.workspace.deleteMany({ where: { slug } });
    await prisma.user.deleteMany({ where: { email } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('records one stable completion timestamp when a failed occurrence is synchronized repeatedly', async () => {
    const user = await prisma.user.create({ data: { username: `occurrence-${Date.now()}`, email, passwordHash: 'unused' } });
    const workspace = await prisma.workspace.create({ data: {
      name: 'Occurrence failure time', slug, createdById: user.id,
      memberships: { create: { userId: user.id, role: 'MANAGER' } },
    } });
    const report = await prisma.report.create({ data: {
      userId: user.id, workspaceId: workspace.id, reportDate: new Date('2026-08-18T00:00:00.000Z'),
      timezone: 'UTC', inputSnapshot: {}, status: 'failed', error: 'Report generation failed.',
    } });
    const occurrence = await prisma.workspaceReportOccurrence.create({ data: {
      workspaceId: workspace.id, trigger: 'MANUAL', windowStart: new Date('2026-08-17T00:00:00.000Z'),
      windowEnd: new Date('2026-08-18T00:00:00.000Z'), dataCutoffAt: new Date('2026-08-18T00:00:00.000Z'),
      requestedById: user.id, status: 'PROCESSING', reportId: report.id,
      idempotencyKey: 'failure-completion-time', evidenceSnapshot: {},
    } });

    await prisma.$transaction((tx) => markWorkspaceReportFailed(tx, report.id));
    const first = await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } });
    await prisma.$transaction((tx) => markWorkspaceReportFailed(tx, report.id));
    const second = await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } });

    expect(first.status).toBe('FAILED');
    expect(first.completedAt).toBeInstanceOf(Date);
    expect(second.completedAt).toEqual(first.completedAt);
  });
});
