import { z } from 'zod';

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
});

export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
