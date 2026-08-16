import { z } from 'zod';

const rawEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z.url().startsWith('postgresql://'),
    REDIS_URL: z.url().refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      message: 'REDIS_URL must use redis:// or rediss://',
    }),
    SESSION_SECRET: z.string().min(32).optional(),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    FRONTEND_ORIGIN: z.url().default('http://localhost:3000'),
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_SLUG: z.string().regex(/^[a-z0-9-]+$/).optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_CALLBACK_URL: z.url().optional(),
    GITHUB_INSTALLATION_CALLBACK_URL: z.url().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
    LLM_API_KEY: z.string().min(1).optional(),
    STORAGE_BUCKET: z.string().min(1).optional(),
    STORAGE_ENDPOINT: z.url().optional(),
    STORAGE_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_SECRET_KEY: z.string().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;
    if (environment.SESSION_SECRET === undefined || /^(replace|change-?me)/i.test(environment.SESSION_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET is required in production, must contain at least 32 characters, and cannot be a placeholder',
      });
    }
    for (const [field, value] of [
      ['FRONTEND_ORIGIN', environment.FRONTEND_ORIGIN],
      ['GITHUB_CALLBACK_URL', environment.GITHUB_CALLBACK_URL],
      ['GITHUB_INSTALLATION_CALLBACK_URL', environment.GITHUB_INSTALLATION_CALLBACK_URL],
    ] as const) {
      if (value !== undefined && new URL(value).protocol !== 'https:') {
        context.addIssue({ code: 'custom', path: [field], message: `${field} must use HTTPS in production` });
      }
    }
    if (
      environment.GITHUB_WEBHOOK_SECRET !== undefined &&
      (environment.GITHUB_WEBHOOK_SECRET.length < 32 || /^(replace|change-?me|secret)/i.test(environment.GITHUB_WEBHOOK_SECRET))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GITHUB_WEBHOOK_SECRET'],
        message: 'GITHUB_WEBHOOK_SECRET must contain at least 32 non-placeholder characters in production',
      });
    }
  });

export interface TraceConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  sessionSecret?: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  frontendOrigin: string;
  github: {
    appId?: string;
    appSlug?: string;
    privateKey?: string;
    clientId?: string;
    clientSecret?: string;
    callbackUrl?: string;
    installationCallbackUrl?: string;
    webhookSecret?: string;
  };
  llmApiKey?: string;
  storage: {
    bucket?: string;
    endpoint?: string;
    accessKey?: string;
    secretKey?: string;
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): TraceConfig {
  const parsed = rawEnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Trace configuration: ${details}`);
  }

  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    sessionSecret: value.SESSION_SECRET,
    logLevel: value.LOG_LEVEL,
    frontendOrigin: value.FRONTEND_ORIGIN,
    github: {
      appId: value.GITHUB_APP_ID,
      appSlug: value.GITHUB_APP_SLUG,
      privateKey: value.GITHUB_APP_PRIVATE_KEY,
      clientId: value.GITHUB_APP_CLIENT_ID,
      clientSecret: value.GITHUB_APP_CLIENT_SECRET,
      callbackUrl: value.GITHUB_CALLBACK_URL,
      installationCallbackUrl: value.GITHUB_INSTALLATION_CALLBACK_URL,
      webhookSecret: value.GITHUB_WEBHOOK_SECRET,
    },
    llmApiKey: value.LLM_API_KEY,
    storage: {
      bucket: value.STORAGE_BUCKET,
      endpoint: value.STORAGE_ENDPOINT,
      accessKey: value.STORAGE_ACCESS_KEY,
      secretKey: value.STORAGE_SECRET_KEY,
    },
  };
}
