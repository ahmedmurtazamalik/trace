
import { DependencyHealthService } from '../src/modules/health/dependency-health.service';

describe('DependencyHealthService', () => {
  it('reports each healthy dependency', async () => {
    const database = { $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]) };
    const redis = { ping: jest.fn().mockResolvedValue('PONG') };
    const service = new DependencyHealthService(database, redis);

    await expect(service.check()).resolves.toEqual({
      status: 'ready',
      dependencies: { postgres: 'up', redis: 'up' },
    });
  });

  it('fails closed without exposing dependency errors', async () => {
    const database = { $queryRaw: jest.fn().mockRejectedValue(new Error('password leaked here')) };
    const redis = { ping: jest.fn().mockResolvedValue('PONG') };
    const service = new DependencyHealthService(database, redis);

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      dependencies: { postgres: 'down', redis: 'up' },
    });
  });

  it('bounds dependency probes so readiness cannot hang indefinitely', async () => {
    jest.useFakeTimers();
    try {
      const database = { $queryRaw: jest.fn().mockReturnValue(new Promise(() => undefined)) };
      const redis = { ping: jest.fn().mockResolvedValue('PONG') };
      const service = new DependencyHealthService(database, redis);
      const observed = Promise.race([
        service.check(),
        new Promise<string>((resolve) => setTimeout(() => resolve('outer-timeout'), 2_100)),
      ]);

      await jest.advanceTimersByTimeAsync(2_100);

      await expect(observed).resolves.toEqual({
        status: 'not_ready',
        dependencies: { postgres: 'down', redis: 'up' },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
