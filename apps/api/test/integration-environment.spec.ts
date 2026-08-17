describe('integration test environment', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    jest.resetModules();
  });

  it('preserves caller-provided disposable service URLs', async () => {
    process.env.DATABASE_URL = 'postgresql://caller.example/isolated';
    process.env.REDIS_URL = 'redis://caller.example:6380';
    const { applyIntegrationEnvironment } = await import('./support/integration-environment');

    applyIntegrationEnvironment();

    expect(process.env.DATABASE_URL).toBe('postgresql://caller.example/isolated');
    expect(process.env.REDIS_URL).toBe('redis://caller.example:6380');
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('provides local defaults only when service URLs are absent', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    const { applyIntegrationEnvironment } = await import('./support/integration-environment');

    applyIntegrationEnvironment();

    expect(process.env.DATABASE_URL).toBe('postgresql://trace:trace@localhost:5432/trace?schema=public');
    expect(process.env.REDIS_URL).toBe('redis://localhost:6379');
  });
});
