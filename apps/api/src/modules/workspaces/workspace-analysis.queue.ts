import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Queue } from 'bullmq';
import { TRACE_CONFIG } from '../../common/config/config.token';

export const WORKSPACE_ANALYSIS_QUEUE = 'workspace-analysis';
export const RUN_WORKSPACE_ANALYSIS_JOB = 'run-workspace-analysis';
const MAX_PENDING_PUBLICATIONS = 100;
const FORCE_DISCONNECT_AFTER_MS = 1_500;
const FORCE_CLEANUP_STEP_MS = 1_000;

interface PendingPublication {
  cancel: (error: Error) => void;
  operation: Promise<void>;
  promise: Promise<void>;
}

@Injectable()
export class WorkspaceAnalysisQueue implements OnModuleDestroy {
  private readonly queue: Queue<{ runId: string }>;
  private readonly publications = new Set<PendingPublication>();
  private closing = false;
  private destruction: Promise<void> | undefined;

  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    this.queue = new Queue(WORKSPACE_ANALYSIS_QUEUE, {
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

  enqueue(runId: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Workspace analysis queue is shutting down.'));
    if (this.publications.size >= MAX_PENDING_PUBLICATIONS) {
      return Promise.reject(new Error('Workspace analysis queue publication capacity is exhausted.'));
    }
    let cancel: PendingPublication['cancel'] | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => { cancel = reject; });
    if (cancel === undefined) throw new Error('Failed to initialize workspace analysis publication cancellation.');
    const operation = this.publish(runId);
    const entry: PendingPublication = { cancel, operation, promise: Promise.resolve() };
    entry.promise = Promise.race([operation, cancellation]).finally(() => this.publications.delete(entry));
    this.publications.add(entry);
    return entry.promise;
  }

  private async publish(runId: string): Promise<void> {
    const jobId = `workspace-analysis-${runId}`;
    const existing = await this.queue.getJob(jobId);
    this.assertPublishingOpen();
    if (existing !== undefined) {
      const state = await existing.getState();
      this.assertPublishingOpen();
      if (state === 'failed') await existing.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
      else if (state === 'completed') {
        await existing.remove();
        this.assertPublishingOpen();
        await this.queue.add(RUN_WORKSPACE_ANALYSIS_JOB, { runId }, { jobId });
      }
      return;
    }
    await this.queue.add(RUN_WORKSPACE_ANALYSIS_JOB, { runId }, { jobId });
  }

  private assertPublishingOpen(): void {
    if (this.closing) throw new Error('Workspace analysis queue is shutting down.');
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
    let closeFailure: unknown;
    const close = this.queue.close().catch((error: unknown) => {
      closeFailure = error;
      throw error;
    });
    const graceful = Promise.allSettled([close, ...publications.map(({ operation }) => operation)]);
    const forced = new Promise<'forced'>((resolve) => {
      forceDisconnect = setTimeout(() => {
        const error = new Error('Workspace analysis queue shut down before publication completed.');
        for (const publication of publications) publication.cancel(error);
        resolve('forced');
      }, FORCE_DISCONNECT_AFTER_MS);
    });
    try {
      const result = await Promise.race([graceful, forced]);
      if (result === 'forced') {
        const disconnect = await this.disconnectWithinDeadline();
        if (!disconnect.settled) throw new Error('Workspace analysis queue disconnect did not settle.');
        if (disconnect.error !== undefined) throw disconnect.error;
        const settled = await this.settleOperationsWithin(publications.map(({ operation }) => operation));
        if (!settled) throw new Error('Workspace analysis queue publications did not settle after forced disconnect.');
        await Promise.allSettled(publications.map(({ promise }) => promise));
        if (closeFailure !== undefined) {
          throw closeFailure instanceof Error ? closeFailure : new Error('Workspace analysis queue close failed.');
        }
        return;
      }
      const [closeResult] = result;
      if (closeResult?.status === 'rejected') throw closeResult.reason;
    } finally {
      if (forceDisconnect !== undefined) clearTimeout(forceDisconnect);
    }
  }

  private async settleOperationsWithin(operations: Promise<void>[]): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.allSettled(operations).then(() => true as const),
        new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), FORCE_CLEANUP_STEP_MS); }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async disconnectWithinDeadline(): Promise<{ settled: boolean; error?: Error }> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.queue.disconnect().then(
          () => ({ settled: true } as const),
          (reason: unknown) => ({
            settled: true as const,
            error: reason instanceof Error ? reason : new Error('Workspace analysis queue disconnect failed.'),
          }),
        ),
        new Promise<{ settled: false }>((resolve) => {
          timeout = setTimeout(() => resolve({ settled: false }), FORCE_CLEANUP_STEP_MS);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
