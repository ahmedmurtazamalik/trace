import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { TraceConfig } from '@trace/config';
import { TRACE_CONFIG } from '../config/config.token';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    super(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.status === 'wait' || this.status === 'end') {
      this.disconnect();
      return;
    }
    await this.quit();
  }
}
