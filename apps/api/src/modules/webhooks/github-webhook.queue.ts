import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Queue } from 'bullmq';
import { TRACE_CONFIG } from '../../common/config/config.token';

export const GITHUB_WEBHOOK_QUEUE = 'github-webhook-deliveries';
export const PROCESS_GITHUB_WEBHOOK_JOB = 'process-github-webhook';

@Injectable()
export class GithubWebhookQueue implements OnModuleDestroy {
  private readonly queue: Queue<{ deliveryId: string }>;

  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    this.queue = new Queue(GITHUB_WEBHOOK_QUEUE, {
      connection: {
        url: config.redisUrl,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempts): number | null => attempts > 2 ? null : 100,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }

  async enqueue(deliveryId: string): Promise<void> {
    await this.queue.add(PROCESS_GITHUB_WEBHOOK_JOB, { deliveryId }, {
      jobId: `github-webhook-${deliveryId}`,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
