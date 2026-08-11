import { describe, expect, it, vi } from 'vitest';
import { DependencyHealthService } from '../src/modules/health/dependency-health.service';

describe('DependencyHealthService', () => {
  it('reports each healthy dependency', async () => {
    const database = { $queryRawUnsafe: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const service = new DependencyHealthService(database, redis);

    await expect(service.check()).resolves.toEqual({
      status: 'ready',
      dependencies: { postgres: 'up', redis: 'up' },
    });
  });

  it('fails closed without exposing dependency errors', async () => {
    const database = { $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('password leaked here')) };
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const service = new DependencyHealthService(database, redis);

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      dependencies: { postgres: 'down', redis: 'up' },
    });
  });
});
