import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { RedisService } from '../../common/redis/redis.service';

export interface DatabaseProbe {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
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

@Injectable()
export class DependencyHealthService {
  constructor(
    @Inject(PrismaService) private readonly database: DatabaseProbe,
    @Inject(RedisService) private readonly redis: RedisProbe,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [postgres, redis] = await Promise.allSettled([
      Promise.resolve().then(() => this.database.$queryRawUnsafe('SELECT 1')),
      Promise.resolve().then(() => this.redis.ping()),
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
