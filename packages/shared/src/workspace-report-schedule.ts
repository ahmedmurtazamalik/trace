import { DateTime } from 'luxon';

export interface WorkspaceReportScheduleRule {
  frequency: 'DAILY' | 'WEEKDAYS' | 'SELECTED_DAYS';
  selectedDays: number[];
  localTime: string;
  timezone: string;
}

/** Resolves a wall-clock minute using the product DST policy: gaps shift to the
 * first valid local minute after the gap and folds choose the earlier instant. */
export function resolveWorkspaceLocalDateTime(localDate: string, localTime: string, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (match === null || timeMatch === null) throw new Error('WORKSPACE_SCHEDULE_LOCAL_TIME_INVALID');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute);
  const desiredMinute = hour * 60 + minute;
  let shifted: { instant: number; localMinute: number } | undefined;

  for (let instant = nominalUtc - 18 * 60 * 60_000; instant <= nominalUtc + 18 * 60 * 60_000; instant += 60_000) {
    const local = DateTime.fromMillis(instant, { zone: timezone });
    if (!local.isValid) throw new Error('WORKSPACE_SCHEDULE_TIMEZONE_INVALID');
    if (local.year !== year || local.month !== month || local.day !== day) continue;
    const localMinute = local.hour * 60 + local.minute;
    if (localMinute === desiredMinute) return new Date(instant);
    if (localMinute > desiredMinute && (shifted === undefined || localMinute < shifted.localMinute || (localMinute === shifted.localMinute && instant < shifted.instant))) {
      shifted = { instant, localMinute };
    }
  }
  if (shifted !== undefined) return new Date(shifted.instant);
  throw new Error('WORKSPACE_SCHEDULE_LOCAL_TIME_INVALID');
}

export function nextWorkspaceReportRun(rule: WorkspaceReportScheduleRule, after: Date): Date {
  if (!Number.isFinite(after.getTime())) throw new Error('WORKSPACE_SCHEDULE_EVALUATION_INVALID');
  const localAfter = DateTime.fromJSDate(after, { zone: rule.timezone });
  if (!localAfter.isValid) throw new Error('WORKSPACE_SCHEDULE_TIMEZONE_INVALID');
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidateDate = localAfter.startOf('day').plus({ days: offset });
    if (!scheduledWeekday(rule, candidateDate.weekday)) continue;
    const candidateIsoDate = candidateDate.toISODate();
    if (candidateIsoDate === null) throw new Error('WORKSPACE_SCHEDULE_LOCAL_TIME_INVALID');
    const instant = resolveWorkspaceLocalDateTime(candidateIsoDate, rule.localTime, rule.timezone);
    if (instant.getTime() > after.getTime()) return instant;
  }
  throw new Error('WORKSPACE_SCHEDULE_NEXT_RUN_NOT_FOUND');
}

export function workspaceIntendedLocalDateTime(instant: Date, timezone: string): string {
  const local = DateTime.fromJSDate(instant, { zone: timezone });
  if (!local.isValid) throw new Error('WORKSPACE_SCHEDULE_TIMEZONE_INVALID');
  return local.toFormat("yyyy-MM-dd'T'HH:mm");
}

function scheduledWeekday(rule: WorkspaceReportScheduleRule, weekday: number): boolean {
  if (rule.frequency === 'DAILY') return true;
  if (rule.frequency === 'WEEKDAYS') return weekday <= 5;
  return rule.selectedDays.includes(weekday);
}
