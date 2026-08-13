import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Queue } from 'bullmq';
import { TRACE_CONFIG } from '../../common/config/config.token';

export const REPORT_QUEUE = 'report-generation';
export const GENERATE_REPORT_JOB = 'generate-report';

@Injectable()
export class ReportQueue implements OnModuleDestroy {
  private readonly queue: Queue<{ reportId: string }>;

  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    this.queue = new Queue(REPORT_QUEUE, {
      connection: {
        url: config.redisUrl,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempts): number | null => attempts > 2 ? null : 100,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  async enqueue(reportId: string): Promise<void> {
    await this.queue.add(GENERATE_REPORT_JOB, { reportId }, { jobId: `report-${reportId}` });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
