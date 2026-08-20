
import { loadConfig } from '../src/index';

describe('loadConfig', () => {
  it('loads a valid development configuration with safe defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://trace:trace@localhost:5432/trace',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3001,
      databaseUrl: 'postgresql://trace:trace@localhost:5432/trace',
      redisUrl: 'redis://localhost:6379',
      logLevel: 'info',
    });
  });

  it('rejects production configuration without a strong session secret', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://trace:trace@postgres:5432/trace',
        REDIS_URL: 'redis://redis:6379',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('rejects missing or unknown deployment modes instead of selecting development', () => {
    const base = {
      DATABASE_URL: 'postgresql://trace:trace@localhost:5432/trace',
      REDIS_URL: 'redis://localhost:6379',
    };
    expect(() => loadConfig(base)).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...base, NODE_ENV: '' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  it('requires HTTPS browser and callback URLs and a strong webhook secret in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://trace:trace@postgres:5432/trace',
      REDIS_URL: 'redis://redis:6379',
      SESSION_SECRET: 'production-session-secret-with-32-characters',
    };
    expect(() => loadConfig({ ...base, FRONTEND_ORIGIN: 'http://trace.example' })).toThrow(/FRONTEND_ORIGIN/);
    expect(() => loadConfig({ ...base, FRONTEND_ORIGIN: 'https://trace.example', GITHUB_CALLBACK_URL: 'http://api.trace.example/callback' })).toThrow(/GITHUB_CALLBACK_URL/);
    expect(() => loadConfig({ ...base, FRONTEND_ORIGIN: 'https://trace.example', GITHUB_INSTALLATION_CALLBACK_URL: 'http://api.trace.example/install' })).toThrow(/GITHUB_INSTALLATION_CALLBACK_URL/);
    expect(() => loadConfig({ ...base, FRONTEND_ORIGIN: 'https://trace.example', GITHUB_WEBHOOK_SECRET: 'weak' })).toThrow(/GITHUB_WEBHOOK_SECRET/);
  });

  it('rejects invalid URLs and ports', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'not-a-url',
        REDIS_URL: 'redis://localhost:6379',
        PORT: '70000',
      }),
    ).toThrow('Invalid Trace configuration');
  });

  it('rejects the documented placeholder secret in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://trace:secret@db:5432/trace',
        REDIS_URL: 'redis://redis:6379',
        SESSION_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('Invalid Trace configuration');
  });

  it('loads the public GitHub callback URL separately from provider secrets', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://trace:trace@localhost:5432/trace',
      REDIS_URL: 'redis://localhost:6379',
      GITHUB_CALLBACK_URL: 'https://trace.example/api/v1/github/callback',
      GITHUB_APP_SLUG: 'trace-app',
      GITHUB_INSTALLATION_CALLBACK_URL: 'https://trace.example/api/v1/github/installation/callback',
    });
    expect(config.github.callbackUrl).toBe('https://trace.example/api/v1/github/callback');
    expect(config.github.appSlug).toBe('trace-app');
    expect(config.github.installationCallbackUrl).toBe('https://trace.example/api/v1/github/installation/callback');
    expect(config.github.clientSecret).toBeUndefined();
  });


  it('normalizes escaped newlines in the GitHub App private key', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://trace:***@localhost:5432/trace',
      REDIS_URL: 'redis://localhost:6379',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nfixture-key-material\\n-----END PRIVATE KEY-----\\n',
    });

    expect(config.github.privateKey).toBe('-----BEGIN PRIVATE KEY-----\nfixture-key-material\n-----END PRIVATE KEY-----\n');
    expect(config.github.privateKey).not.toContain('\\n');
  });

  it('normalizes blank optional environment values from the documented env file to absent', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://trace:password@localhost:5432/trace',
      REDIS_URL: 'redis://localhost:6379',
      GITHUB_APP_ID: '',
      GITHUB_APP_SLUG: '',
      GITHUB_APP_PRIVATE_KEY: '',
      GITHUB_APP_CLIENT_ID: '',
      GITHUB_APP_CLIENT_SECRET: '',
      GITHUB_WEBHOOK_SECRET: '',
      STORAGE_BUCKET: '',
      STORAGE_ENDPOINT: '',
      STORAGE_ACCESS_KEY: '',
      STORAGE_SECRET_KEY: '',
    });

    expect(config.github).toEqual({});
    expect(config.storage).toEqual({});
  });
});
