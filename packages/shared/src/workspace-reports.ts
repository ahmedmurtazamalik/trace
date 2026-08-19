import { z } from 'zod';
import { reportDetailSchema } from './reports';
import { workspaceAnalysisAccessStateSchema, workspaceAnalysisCoverageSchema } from './workspace-analysis';

const idSchema = z.string().min(1).max(256);
const instantSchema = z.iso.datetime();
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const isoWeekdaySchema = z.number().int().min(1).max(7);

function isIanaTimezone(value: string): boolean {
  if (!value.includes('/')) return value === 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

export const workspaceReportFrequencySchema = z.enum(['DAILY', 'WEEKDAYS', 'SELECTED_DAYS']);
export const workspaceReportTriggerSchema = z.enum(['MANUAL', 'SCHEDULED', 'RECOVERY']);
export const workspaceReportOccurrenceStatusSchema = z.enum(['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
export const workspaceTimezoneSchema = z.string().min(1).max(100).refine(isIanaTimezone, 'A valid IANA timezone is required.');

export const workspaceReportGenerateRequestSchema = z.object({
  windowStart: instantSchema,
  windowEnd: instantSchema,
}).strict().superRefine((value, context) => {
  if (new Date(value.windowStart) >= new Date(value.windowEnd)) {
    context.addIssue({ code: 'custom', message: 'Report window end must be after its start.' });
  }
});

export const workspaceReportScheduleRequestSchema = z.object({
  enabled: z.boolean(),
  frequency: workspaceReportFrequencySchema,
  selectedDays: z.array(isoWeekdaySchema).max(7),
  localTime: localTimeSchema,
  timezone: workspaceTimezoneSchema,
}).strict().superRefine((value, context) => {
  const unique = new Set(value.selectedDays);
  if (unique.size !== value.selectedDays.length) context.addIssue({ code: 'custom', path: ['selectedDays'], message: 'Selected weekdays must be unique.' });
  if (value.frequency === 'SELECTED_DAYS' && unique.size === 0) context.addIssue({ code: 'custom', path: ['selectedDays'], message: 'Selected weekdays are required.' });
  if (value.frequency !== 'SELECTED_DAYS' && unique.size !== 0) context.addIssue({ code: 'custom', path: ['selectedDays'], message: 'Selected weekdays apply only to selected-day schedules.' });
}).transform((value) => ({ ...value, selectedDays: [...value.selectedDays].sort((left, right) => left - right) }));

export const workspaceReportScheduleSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  enabled: z.boolean(),
  frequency: workspaceReportFrequencySchema,
  selectedDays: z.array(isoWeekdaySchema).max(7),
  localTime: localTimeSchema,
  timezone: workspaceTimezoneSchema,
  version: z.number().int().positive(),
  configuredById: idSchema,
  nextRunAt: instantSchema.nullable(),
  nextRunLocal: z.string().min(1).max(40).nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
}).strict();

export const workspaceReportOccurrenceSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  scheduleId: idSchema.nullable(),
  scheduleVersion: z.number().int().positive().nullable(),
  trigger: workspaceReportTriggerSchema,
  scheduledFor: instantSchema.nullable(),
  intendedLocalDateTime: z.string().min(1).max(40).nullable(),
  windowStart: instantSchema,
  windowEnd: instantSchema,
  dataCutoffAt: instantSchema,
  requestedById: idSchema,
  status: workspaceReportOccurrenceStatusSchema,
  reportId: idSchema.nullable(),
  idempotencyKey: z.string().min(1).max(160),
  noActivity: z.boolean().nullable(),
  recoveredAt: instantSchema.nullable(),
  createdAt: instantSchema,
  startedAt: instantSchema.nullable(),
  completedAt: instantSchema.nullable(),
  error: z.string().max(500).nullable(),
}).strict();

export const workspaceReportGenerateResponseSchema = z.object({ occurrence: workspaceReportOccurrenceSchema }).strict();
export const workspaceReportOccurrenceListResponseSchema = z.object({ items: z.array(workspaceReportOccurrenceSchema).max(500) }).strict();
export const workspaceReportScheduleResponseSchema = z.object({ schedule: workspaceReportScheduleSchema.nullable() }).strict();

export const workspaceReportEvidenceRepositorySchema = z.object({
  repositoryId: idSchema,
  fullName: z.string().min(1).max(512),
  accessState: workspaceAnalysisAccessStateSchema,
  coverage: workspaceAnalysisCoverageSchema.nullable(),
  baselineOnly: z.boolean(),
  activityCount: z.number().int().nonnegative(),
}).strict();

export const workspaceReportEvidenceSchema = z.object({
  workspaceId: idSchema,
  workspaceName: z.string().min(1).max(100),
  trigger: workspaceReportTriggerSchema,
  scheduleVersion: z.number().int().positive().nullable(),
  scheduledFor: instantSchema.nullable(),
  intendedLocalDateTime: z.string().min(1).max(40).nullable(),
  windowStart: instantSchema,
  windowEnd: instantSchema,
  dataCutoffAt: instantSchema,
  recoveredAt: instantSchema.nullable(),
  noActivity: z.boolean(),
  repositories: z.array(workspaceReportEvidenceRepositorySchema).max(100),
}).strict();

export const workspaceReportDetailResponseSchema = z.object({
  report: reportDetailSchema,
  workspaceEvidence: workspaceReportEvidenceSchema,
}).strict();

export type WorkspaceReportGenerateRequest = z.infer<typeof workspaceReportGenerateRequestSchema>;
export type WorkspaceReportScheduleRequest = z.infer<typeof workspaceReportScheduleRequestSchema>;
export type WorkspaceReportSchedule = z.infer<typeof workspaceReportScheduleSchema>;
export type WorkspaceReportOccurrence = z.infer<typeof workspaceReportOccurrenceSchema>;
export type WorkspaceReportGenerateResponse = z.infer<typeof workspaceReportGenerateResponseSchema>;
export type WorkspaceReportOccurrenceListResponse = z.infer<typeof workspaceReportOccurrenceListResponseSchema>;
export type WorkspaceReportScheduleResponse = z.infer<typeof workspaceReportScheduleResponseSchema>;
export type WorkspaceReportEvidence = z.infer<typeof workspaceReportEvidenceSchema>;
export type WorkspaceReportDetailResponse = z.infer<typeof workspaceReportDetailResponseSchema>;
