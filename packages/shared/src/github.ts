import { z } from 'zod';

export const githubConnectionStatusSchema = z.object({
  connected: z.boolean(),
  account: z.object({
    id: z.string().min(1),
    username: z.string().min(1),
    displayName: z.string().nullable(),
    avatarUrl: z.url().nullable(),
  }).nullable(),
  installation: z.object({
    id: z.string().min(1),
    accountType: z.enum(['USER', 'ORGANIZATION']),
    accountLogin: z.string().min(1),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
  }).nullable(),
  accessibleRepositoryCount: z.number().int().nonnegative(),
  trackedRepositoryCount: z.number().int().nonnegative(),
});

export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;
