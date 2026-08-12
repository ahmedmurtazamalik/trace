
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

  it('rejects invalid URLs and ports', () => {
    expect(() =>
      loadConfig({
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
});
