import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Queue } from 'bullmq';
import { TRACE_CONFIG } from '../../common/config/config.token';

export const REPORT_QUEUE = 'report-generation';
export const GENERATE_REPORT_JOB = 'generate-report';

@Injectable()
export class ReportQueue implements OnModuleDestroy {
  private readonly queue: Queue<{ reportId: string }>;
  private publication: Promise<void> | undefined;

  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    this.queue = new Queue(REPORT_QUEUE, {
      connection: {
        url: config.redisUrl,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempts): number => Math.min(attempts * 100, 1_000),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  enqueue(reportId: string): Promise<void> {
    if (this.publication !== undefined) return Promise.reject(new Error('Report queue publication is already in progress.'));
    const publication = this.publish(reportId).finally(() => {
      if (this.publication === publication) this.publication = undefined;
    });
    this.publication = publication;
    return publication;
  }

  private async publish(reportId: string): Promise<void> {
    const jobId = `report-${reportId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (state === 'failed') await existing.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
      else if (state === 'completed') {
        await existing.remove();
        await this.queue.add(GENERATE_REPORT_JOB, { reportId }, { jobId });
      }
      return;
    }
    await this.queue.add(GENERATE_REPORT_JOB, { reportId }, { jobId });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
