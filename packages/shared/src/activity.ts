import { z } from 'zod';
import { pageInfoSchema, paginationQuerySchema } from './pagination';

export const timezoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Invalid IANA timezone');

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

const activityTypesBySource = {
  github: new Set(['commit', 'push', 'pull_request']),
  cli: new Set(['working_tree_snapshot', 'staged_change', 'untracked_file', 'local_commit']),
} as const;

function validSourceType(source: z.infer<typeof activitySourceSchema>, type: z.infer<typeof activityTypeSchema>): boolean {
  return activityTypesBySource[source].has(type as never);
}

export const activityRepositorySchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  url: z.url().nullable(),
}).strict();

export const activityContributorSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1).nullable(),
  displayName: z.string().min(1).nullable(),
  avatarUrl: z.url().nullable(),
}).strict();

export const activityFactsSchema = z.object({
  sha: z.string().min(7).max(64).nullable(),
  message: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  filesChanged: z.number().int().nonnegative().nullable(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  url: z.url().nullable(),
}).strict();

export const activitySummarySchema = z.object({
  id: z.string().min(1),
  repository: activityRepositorySchema,
  contributor: activityContributorSchema.nullable(),
  source: activitySourceSchema,
  type: activityTypeSchema,
  occurredAt: z.iso.datetime(),
  facts: activityFactsSchema,
}).strict().superRefine((value, context) => {
  if (!validSourceType(value.source, value.type)) context.addIssue({ code: 'custom', path: ['type'], message: 'Activity type is invalid for source' });
});

export const activityListQuerySchema = paginationQuerySchema.extend({
  date: z.iso.date().optional(),
  timezone: timezoneSchema.default('UTC'),
  repositoryId: z.string().min(1).optional(),
  contributorId: z.string().min(1).optional(),
  source: activitySourceSchema.optional(),
  type: activityTypeSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.source !== undefined && value.type !== undefined && !validSourceType(value.source, value.type)) {
    context.addIssue({ code: 'custom', path: ['type'], message: 'Activity type is invalid for source' });
  }
});

export const activityListResponseSchema = z.object({
  items: z.array(activitySummarySchema),
  pageInfo: pageInfoSchema,
}).strict();

export type ActivitySource = z.infer<typeof activitySourceSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type ActivityRepository = z.infer<typeof activityRepositorySchema>;
export type ActivityContributor = z.infer<typeof activityContributorSchema>;
export type ActivityFacts = z.infer<typeof activityFactsSchema>;
export type ActivitySummary = z.infer<typeof activitySummarySchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;
