import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { TraceConfig } from '@trace/config';
import { TRACE_CONFIG } from '../config/config.token';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly redisLogger = new Logger(RedisService.name);
  private connectionErrorLogged = false;

  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    super(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });

    this.on('error', () => {
      if (!this.connectionErrorLogged) {
        this.redisLogger.warn('Redis connection is unavailable; readiness will remain false.');
        this.connectionErrorLogged = true;
      }
    });
    this.on('ready', () => {
      this.connectionErrorLogged = false;
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
