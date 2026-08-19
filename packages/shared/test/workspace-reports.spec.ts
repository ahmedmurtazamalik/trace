import {
  workspaceReportGenerateRequestSchema,
  workspaceReportOccurrenceSchema,
  workspaceReportScheduleRequestSchema,
  workspaceReportDetailResponseSchema,
  nextWorkspaceReportRun,
  resolveWorkspaceLocalDateTime,
} from '../src';

const timestamp = '2026-08-18T17:00:00.000Z';

describe('workspace report contracts', () => {
  it('accepts an immutable manual occurrence body while keeping idempotency in the header', () => {
    expect(workspaceReportGenerateRequestSchema.parse({
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: timestamp,
    })).toEqual({
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: timestamp,
    });
    expect(workspaceReportGenerateRequestSchema.safeParse({
      idempotencyKey: 'must-be-an-http-header',
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: timestamp,
    }).success).toBe(false);
    expect(workspaceReportGenerateRequestSchema.safeParse({
      windowStart: '2026-08-17T00:00:00.000Z',
      windowEnd: timestamp,
      scheduleId: 'must-not-be-client-controlled',
    }).success).toBe(false);

    expect(workspaceReportOccurrenceSchema.parse({
      id: 'occurrence-1', workspaceId: 'workspace-1', scheduleId: null, scheduleVersion: null,
      trigger: 'MANUAL', scheduledFor: null, intendedLocalDateTime: null,
      windowStart: '2026-08-17T00:00:00.000Z', windowEnd: timestamp, dataCutoffAt: timestamp,
      requestedById: 'manager-1', status: 'PENDING', reportId: null,
      idempotencyKey: 'manual-2026-08-18-01', noActivity: null, recoveredAt: null,
      createdAt: timestamp, startedAt: null, completedAt: null, error: null,
    }).trigger).toBe('MANUAL');
  });

  it('exposes frozen workspace report evidence without operational identities', () => {
    const response = {
      report: {
        id: 'report-1', reportDate: '2026-08-18', timezone: 'UTC', status: 'completed' as const,
        createdAt: timestamp, completedAt: timestamp, errorMessage: null, revision: 1,
        downloadAvailable: true, revisionSource: 'ai' as const,
        content: { executiveSummary: 'No code activity was recorded.', repositories: [] },
        facts: { repositoryCount: 1, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
        artifacts: [{ id: 'pdf-1', revision: 1, kind: 'pdf' as const, fileName: 'workspace.pdf', contentType: 'application/pdf' as const, sizeBytes: 4, checksum: 'a'.repeat(64) }],
      },
      workspaceEvidence: {
        workspaceId: 'workspace-1', workspaceName: 'Product Delivery', trigger: 'RECOVERY' as const,
        scheduleVersion: 2, scheduledFor: timestamp, intendedLocalDateTime: '2026-08-18T17:00',
        windowStart: '2026-08-17T17:00:00.000Z', windowEnd: timestamp, dataCutoffAt: timestamp,
        recoveredAt: timestamp, noActivity: true,
        repositories: [{
          repositoryId: 'repository-1', fullName: 'trace/web', accessState: 'ACTIVE' as const,
          coverage: { totalFiles: 2, eligibleFiles: 2, analyzedFiles: 2, excludedFiles: 0, totalBytes: 20, analyzedBytes: 20, truncatedFiles: 0 },
          baselineOnly: false, activityCount: 0,
        }],
      },
    };
    expect(workspaceReportDetailResponseSchema.parse(response)).toEqual(response);
    expect(workspaceReportDetailResponseSchema.safeParse({
      ...response,
      workspaceEvidence: { ...response.workspaceEvidence, requestedById: 'manager-1', idempotencyKey: 'secret-operation-key', error: 'provider failure' },
    }).success).toBe(false);
  });

  it('resolves normal, spring-gap, and fall-fold local times deterministically', () => {
    expect(resolveWorkspaceLocalDateTime('2026-02-01', '17:00', 'America/Los_Angeles').toISOString())
      .toBe('2026-02-02T01:00:00.000Z');
    expect(resolveWorkspaceLocalDateTime('2026-03-08', '02:30', 'America/Los_Angeles').toISOString())
      .toBe('2026-03-08T10:00:00.000Z');
    expect(resolveWorkspaceLocalDateTime('2026-11-01', '01:30', 'America/Los_Angeles').toISOString())
      .toBe('2026-11-01T08:30:00.000Z');
  });

  it('computes daily, weekday, and selected-day runs strictly after the evaluation instant', () => {
    expect(nextWorkspaceReportRun({ frequency: 'DAILY', selectedDays: [], localTime: '17:00', timezone: 'America/Los_Angeles' }, new Date('2026-08-18T23:00:00.000Z')).toISOString())
      .toBe('2026-08-19T00:00:00.000Z');
    expect(nextWorkspaceReportRun({ frequency: 'WEEKDAYS', selectedDays: [], localTime: '09:00', timezone: 'UTC' }, new Date('2026-08-21T10:00:00.000Z')).toISOString())
      .toBe('2026-08-24T09:00:00.000Z');
    expect(nextWorkspaceReportRun({ frequency: 'SELECTED_DAYS', selectedDays: [1, 3], localTime: '09:00', timezone: 'UTC' }, new Date('2026-08-18T10:00:00.000Z')).toISOString())
      .toBe('2026-08-19T09:00:00.000Z');
  });

  it('requires canonical IANA schedules and selected ISO weekdays only when selected', () => {
    const daily = workspaceReportScheduleRequestSchema.parse({
      enabled: true, frequency: 'DAILY', selectedDays: [], localTime: '17:00', timezone: 'America/Los_Angeles',
    });
    expect(daily.timezone).toBe('America/Los_Angeles');
    expect(workspaceReportScheduleRequestSchema.safeParse({ ...daily, timezone: 'PST' }).success).toBe(false);
    expect(workspaceReportScheduleRequestSchema.safeParse({ ...daily, localTime: '5:00' }).success).toBe(false);
    expect(workspaceReportScheduleRequestSchema.safeParse({ ...daily, selectedDays: [1] }).success).toBe(false);
    expect(workspaceReportScheduleRequestSchema.parse({
      ...daily, frequency: 'SELECTED_DAYS', selectedDays: [5, 1, 3],
    }).selectedDays).toEqual([1, 3, 5]);
    expect(workspaceReportScheduleRequestSchema.safeParse({
      ...daily, frequency: 'SELECTED_DAYS', selectedDays: [1, 1],
    }).success).toBe(false);
  });
});
