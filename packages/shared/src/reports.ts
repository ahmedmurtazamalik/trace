import { z } from 'zod';

export const reportStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

export const reportSummarySchema = z.object({
  id: z.string().min(1),
  reportDate: z.iso.date(),
  timezone: z.string().min(1),
  status: reportStatusSchema,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  errorMessage: z.string().nullable(),
  revision: z.number().int().positive().nullable(),
  downloadAvailable: z.boolean(),
});

export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
