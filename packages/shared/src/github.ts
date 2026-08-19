import { z } from 'zod';

const githubAccountSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255).nullable(),
  avatarUrl: z.url().refine((value) => value.startsWith('https://'), 'Avatar URL must use HTTPS').nullable(),
});

const githubInstallationSchema = z.object({
  id: z.string().min(1),
  accountType: z.enum(['USER', 'ORGANIZATION']),
  accountLogin: z.string().min(1).max(100),
});

export const githubConnectResponseSchema = z.object({
  authorizationUrl: z.url().refine(
    (value) => value.startsWith('https://github.com/'),
    'Authorization URL must be an HTTPS github.com URL',
  ),
});

export const githubInstallationStartResponseSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('INSTALL_REQUIRED'),
    installationUrl: z.url().refine(
      (value) => value.startsWith('https://github.com/apps/'),
      'Installation URL must be an HTTPS github.com App URL',
    ),
  }),
  z.object({ outcome: z.literal('CONNECTED') }),
]);

export const githubInstallationCallbackQuerySchema = z.object({
  installation_id: z.coerce.string().regex(/^\d+$/),
  setup_action: z.enum(['install', 'update']),
  state: z.string().min(32).max(512),
});

export const githubCallbackQuerySchema = z.union([
  z.object({
    code: z.string().min(1).max(512),
    state: z.string().min(32).max(512),
  }),
  z.object({
    error: z.literal('access_denied'),
    error_description: z.string().min(1).max(1_024).optional(),
    state: z.string().min(32).max(512),
  }),
]);

export const githubCallbackResultSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('connected') }),
  z.object({ result: z.literal('reconnect_required') }),
  z.object({
    result: z.literal('error'),
    reason: z.enum(['state_invalid', 'callback_failed', 'access_denied', 'session_expired']),
  }),
]);

const accountConnectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('DISCONNECTED'), account: z.null() }),
  z.object({ status: z.literal('CONNECTED'), account: githubAccountSchema }),
  z.object({ status: z.literal('RECONNECT_REQUIRED'), account: githubAccountSchema }),
]);

const installationAuthorizationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('NOT_INSTALLED'), installation: z.null() }),
  z.object({ status: z.literal('ACTIVE'), installation: githubInstallationSchema }),
  z.object({ status: z.literal('SUSPENDED'), installation: githubInstallationSchema }),
]);

export const githubConnectionStatusSchema = z.object({
  accountConnection: accountConnectionSchema,
  installationAuthorization: installationAuthorizationSchema,
  accessibleRepositoryCount: z.number().int().nonnegative(),
  trackedRepositoryCount: z.number().int().nonnegative(),
  historyRetained: z.literal(true),
});

export const githubDisconnectResponseSchema = z.object({
  success: z.literal(true),
  historyRetained: z.literal(true),
});

export const githubErrorCodeSchema = z.enum([
  'GITHUB_STATE_INVALID',
  'GITHUB_CALLBACK_FAILED',
  'GITHUB_NOT_CONNECTED',
  'GITHUB_RECONNECT_REQUIRED',
  'GITHUB_INSTALLATION_REQUIRED',
  'GITHUB_INSTALLATION_SUSPENDED',
]);

export type GithubConnectResponse = z.infer<typeof githubConnectResponseSchema>;
export type GithubInstallationStartResponse = z.infer<typeof githubInstallationStartResponseSchema>;
export type GithubInstallationCallbackQuery = z.infer<typeof githubInstallationCallbackQuerySchema>;
export type GithubCallbackQuery = z.infer<typeof githubCallbackQuerySchema>;
export type GithubCallbackResult = z.infer<typeof githubCallbackResultSchema>;
export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;
export type GithubDisconnectResponse = z.infer<typeof githubDisconnectResponseSchema>;
export type GithubErrorCode = z.infer<typeof githubErrorCodeSchema>;
