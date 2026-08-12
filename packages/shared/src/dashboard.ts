import { z } from 'zod';
import { activitySummarySchema, timezoneSchema } from './activity';

export const dashboardStateSchema = z.enum([
  'READY',
  'GITHUB_NOT_CONNECTED',
  'NO_TRACKED_REPOSITORIES',
  'NO_ACTIVITY',
  'PARTIAL',
]);

export const dashboardQuerySchema = z.object({
  date: z.iso.date(),
  timezone: timezoneSchema.default('UTC'),
  repositoryId: z.string().min(1).optional(),
}).strict();

export const dashboardMetricsSchema = z.object({
  activityCount: z.number().int().nonnegative(),
  repositoryCount: z.number().int().nonnegative(),
  contributorCount: z.number().int().nonnegative(),
  commitCount: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
}).strict();

export const dashboardResponseSchema = z.object({
  date: z.iso.date(),
  timezone: timezoneSchema,
  state: dashboardStateSchema,
  metrics: dashboardMetricsSchema,
  recentActivity: z.array(activitySummarySchema).max(20),
}).strict();

export type DashboardState = z.infer<typeof dashboardStateSchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
