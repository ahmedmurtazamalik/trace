import { z } from 'zod';
import { pageInfoSchema, paginationQuerySchema } from './pagination';

export const repositorySummarySchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  private: z.boolean(),
  defaultBranch: z.string().min(1),
  url: z.url().nullable(),
  accessible: z.boolean(),
  trackingEnabled: z.boolean(),
  removed: z.boolean(),
  lastActivityAt: z.iso.datetime().nullable(),
  contributorCount: z.number().int().nonnegative(),
}).strict();

export const repositoryListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
  visibility: z.enum(['active', 'removed']).default('active'),
}).strict();

export const repositoryListResponseSchema = z.object({
  items: z.array(repositorySummarySchema),
  pageInfo: pageInfoSchema,
}).strict();

export const repositoryDetailResponseSchema = z.object({
  repository: repositorySummarySchema,
}).strict();

export const repositoryTrackingResponseSchema = z.object({
  repositoryId: z.string().min(1),
  trackingEnabled: z.boolean(),
}).strict();

export const repositoryMembershipResponseSchema = z.object({
  repositoryId: z.string().min(1),
  trackingEnabled: z.boolean(),
  removed: z.boolean(),
}).strict();
export const repositorySynchronizationResponseSchema = z.object({
  accessibleRepositoryCount: z.number().int().nonnegative(),
}).strict();

export const repositoryErrorCodeSchema = z.enum([
  'REPOSITORY_NOT_FOUND',
  'REPOSITORY_ACCESS_REMOVED',
  'REPOSITORY_REMOVED',
  'GITHUB_INSTALLATION_REQUIRED',
  'GITHUB_INSTALLATION_SUSPENDED',
]);

export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type RepositoryListQuery = z.infer<typeof repositoryListQuerySchema>;
export type RepositoryListResponse = z.infer<typeof repositoryListResponseSchema>;
export type RepositoryDetailResponse = z.infer<typeof repositoryDetailResponseSchema>;
export type RepositoryTrackingResponse = z.infer<typeof repositoryTrackingResponseSchema>;
export type RepositoryMembershipResponse = z.infer<typeof repositoryMembershipResponseSchema>;
export type RepositorySynchronizationResponse = z.infer<typeof repositorySynchronizationResponseSchema>;
export type RepositoryErrorCode = z.infer<typeof repositoryErrorCodeSchema>;
