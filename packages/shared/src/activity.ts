import { z } from 'zod';

export const activitySourceSchema = z.enum(['github', 'cli']);
export const activityTypeSchema = z.enum([
  'commit',
  'push',
  'pull_request',
  'working_tree_snapshot',
  'staged_change',
  'untracked_file',
  'local_commit',
]);

export const activitySummarySchema = z.object({
  id: z.string().min(1),
  repositoryId: z.string().min(1),
  contributorId: z.string().nullable(),
  source: activitySourceSchema,
  type: activityTypeSchema,
  occurredAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.unknown()),
});

export type ActivitySource = z.infer<typeof activitySourceSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type ActivitySummary = z.infer<typeof activitySummarySchema>;
