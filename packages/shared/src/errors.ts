import { z } from 'zod';

export const fieldErrorsSchema = z.record(z.string(), z.array(z.string().min(1)));

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
  fieldErrors: fieldErrorsSchema.optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
