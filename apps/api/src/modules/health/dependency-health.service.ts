import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { RedisService } from '../../common/redis/redis.service';

const PROBE_TIMEOUT_MS = 2_000;

export interface DatabaseProbe {
  $queryRaw<T = unknown>(query: TemplateStringsArray): Promise<T>;
}

export interface RedisProbe {
  ping(): Promise<string>;
}

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  dependencies: {
    postgres: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

function runBoundedProbe<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Dependency probe timed out')), PROBE_TIMEOUT_MS);
    timer.unref();

    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error('Dependency probe failed'));
        },
      );
  });
}

@Injectable()
export class DependencyHealthService {
  constructor(
    @Inject(PrismaService) private readonly database: DatabaseProbe,
    @Inject(RedisService) private readonly redis: RedisProbe,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [postgres, redis] = await Promise.allSettled([
      runBoundedProbe(() => this.database.$queryRaw`SELECT 1`),
      runBoundedProbe(() => this.redis.ping()),
    ]);
    const dependencies: ReadinessResult['dependencies'] = {
      postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' && redis.value === 'PONG' ? 'up' : 'down',
    };

    return {
      status: dependencies.postgres === 'up' && dependencies.redis === 'up' ? 'ready' : 'not_ready',
      dependencies,
    };
  }
}
