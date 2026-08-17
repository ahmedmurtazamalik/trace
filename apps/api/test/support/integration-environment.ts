const DEFAULT_DATABASE_URL = 'postgresql://trace:trace@localhost:5432/trace?schema=public';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

export function applyIntegrationEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.REDIS_URL ??= DEFAULT_REDIS_URL;
}
