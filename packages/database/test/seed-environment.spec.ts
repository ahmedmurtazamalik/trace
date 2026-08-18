import type { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';

describe('development seed environment gate', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowDemoSeed = process.env.ALLOW_DEMO_SEED;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
    else process.env.ALLOW_DEMO_SEED = originalAllowDemoSeed;
  });

  it.each([undefined, 'prod', 'Production', 'staging'])('fails closed for deployment mode %s before database access', async (mode) => {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    process.env.ALLOW_DEMO_SEED = 'true';
    const upsert = jest.fn();
    const client = { user: { upsert } } as unknown as PrismaClient;

    await expect(seed(client)).rejects.toThrow('Development seed requires NODE_ENV=development or test.');
    expect(upsert).not.toHaveBeenCalled();
  });
});