import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Queue } from 'bullmq';
import { TRACE_CONFIG } from '../../common/config/config.token';

export const REPORT_QUEUE = 'report-generation';
export const GENERATE_REPORT_JOB = 'generate-report';
const MAX_PENDING_PUBLICATIONS = 100;
const FORCE_DISCONNECT_AFTER_MS = 1_500;

interface PendingPublication {
  cancel: (error: Error) => void;
  promise: Promise<void>;
}

@Injectable()
export class ReportQueue implements OnModuleDestroy {
  private readonly queue: Queue<{ reportId: string }>;
  private readonly publications = new Set<PendingPublication>();
  private closing = false;
  private destruction: Promise<void> | undefined;

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
    if (this.closing) {
      return Promise.reject(new Error('Report queue is shutting down.'));
    }
    if (this.publications.size >= MAX_PENDING_PUBLICATIONS) {
      return Promise.reject(new Error('Report queue publication capacity is exhausted.'));
    }
    let cancel = (_error: Error): void => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => { cancel = reject; });
    const entry: PendingPublication = { cancel, promise: Promise.resolve() };
    entry.promise = Promise.race([this.publish(reportId), cancellation]).finally(() => {
      this.publications.delete(entry);
    });
    this.publications.add(entry);
    return entry.promise;
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

  onModuleDestroy(): Promise<void> {
    if (this.destruction !== undefined) return this.destruction;
    this.closing = true;
    const publications = [...this.publications];
    this.destruction = this.closeAndSettle(publications);
    return this.destruction;
  }

  private async closeAndSettle(publications: PendingPublication[]): Promise<void> {
    let forceDisconnect: NodeJS.Timeout | undefined;
    const graceful = Promise.allSettled([this.queue.close(), ...publications.map(({ promise }) => promise)]);
    const forced = new Promise<'forced'>((resolve) => {
      forceDisconnect = setTimeout(() => {
        const error = new Error('Report queue shut down before publication completed.');
        for (const publication of publications) publication.cancel(error);
        void this.queue.disconnect().catch(() => undefined);
        resolve('forced');
      }, FORCE_DISCONNECT_AFTER_MS);
    });
    try {
      const result = await Promise.race([graceful, forced]);
      if (result === 'forced') {
        await Promise.allSettled(publications.map(({ promise }) => promise));
        return;
      }
      const [closeResult] = result;
      if (closeResult?.status === 'rejected') throw closeResult.reason;
    } finally {
      if (forceDisconnect !== undefined) clearTimeout(forceDisconnect);
    }
  }
}
