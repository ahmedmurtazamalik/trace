import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(39)
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/, 'Username contains unsupported characters');

export const passwordSchema = z.string().min(12).max(256);
export const csrfHeaderName = 'x-csrf-token' as const;
export const csrfTokenSchema = z.string().min(1);

export const authErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'USERNAME_TAKEN',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'UNAUTHENTICATED',
  'CSRF_INVALID',
  'INVALID_OR_EXPIRED_RESET_TOKEN',
  'RATE_LIMITED',
]);

export const publicUserSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(100).nullable(),
  email: z.email().nullable(),
  createdAt: z.iso.datetime(),
});

export const registerRequestSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(100).optional(),
  email: z.email().optional(),
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256),
});

export const authSessionResponseSchema = z.object({
  user: publicUserSchema,
  csrfToken: csrfTokenSchema,
});

export const logoutResponseSchema = z.object({ success: z.literal(true) });

export const forgotPasswordRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
});

export const forgotPasswordResponseSchema = z.object({
  message: z.literal('If the account exists, password reset instructions have been sent.'),
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1).max(512),
  password: passwordSchema,
});

export const resetPasswordResponseSchema = z.object({ success: z.literal(true) });

export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
