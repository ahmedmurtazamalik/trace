import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { beforeWorkerDeadline, workerDrainDeadline } from '../../shutdown-budget';
import type { ReportDeliveryContext } from '../../reports/report-delivery';

export interface ReportQueueWorkerOptions {
  redisUrl: string;
  queueName?: string;
  concurrency?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  processReport(reportId: string, delivery: ReportDeliveryContext): Promise<void>;
}

interface ReportJob { reportId: string }
type ActiveState = 'active' | 'waiting' | 'delayed' | 'prioritized';

export class ReportQueueWorker {
  private readonly queueName: string;
  private readonly concurrency: number;
  private queue: Queue<ReportJob> | undefined;
  private worker: Worker<ReportJob> | undefined;
  private runPromise: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  get completion(): Promise<void> {
    return this.runPromise ?? Promise.reject(new Error('Report worker has not started.'));
  }

  constructor(private readonly options: ReportQueueWorkerOptions) {
    this.queueName = options.queueName ?? 'report-generation';
    this.concurrency = options.concurrency ?? 2;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 16) {
      throw new Error('Report worker concurrency must be between 1 and 16.');
    }
  }

  async start(): Promise<void> {
    if (this.worker !== undefined) return;
    const connection = { url: this.options.redisUrl, maxRetriesPerRequest: null, retryStrategy: (): null => null };
    const queue = new Queue<ReportJob>(this.queueName, { connection });
    queue.on('error', () => undefined);
    this.queue = queue;
    try {
      await this.timeout(queue.waitUntilReady().then(() => undefined), this.options.startupTimeoutMs ?? 5_000, 'Report worker startup timed out.');
      const worker = new Worker<ReportJob>(this.queueName, (job) => this.process(job), {
        connection,
        concurrency: this.concurrency,
        autorun: false,
      });
      worker.on('error', () => undefined);
      this.worker = worker;
      this.runPromise = worker.run();
      void this.runPromise.catch(() => undefined);
      await this.timeout(worker.waitUntilReady().then(() => undefined), this.options.startupTimeoutMs ?? 5_000, 'Report worker startup timed out.');
    } catch {
      await this.boundedCleanup([this.worker?.close(true), queue.close()]);
      this.worker = undefined;
      this.queue = undefined;
      this.runPromise = undefined;
      throw new Error('Report worker startup failed.');
    }
  }

  async waitUntilIdle(timeoutMs = 5_000): Promise<void> {
    if (this.queue === undefined) throw new Error('Report worker has not started.');
    const deadline = Date.now() + timeoutMs;
    const states: ActiveState[] = ['active', 'waiting', 'delayed', 'prioritized'];
    while (Date.now() < deadline) {
      const counts = await this.queue.getJobCounts(...states);
      if (states.every((state) => counts[state] === 0)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for the report queue to become idle.');
  }

  async close(requestedDeadline?: number): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closing = (async () => {
      const worker = this.worker;
      const queue = this.queue;
      const shutdownDeadline = requestedDeadline ?? Date.now() + (this.options.shutdownTimeoutMs ?? 10_000);
      const drainDeadline = workerDrainDeadline(shutdownDeadline);
      this.worker = undefined;
      this.queue = undefined;
      try {
        await beforeWorkerDeadline((async () => {
          await worker?.pause(true);
          while ((await queue?.getJobCounts('active'))?.active !== 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          await worker?.close(false);
          await queue?.close();
          await this.runPromise?.catch(() => undefined);
        })(), drainDeadline, 'Report worker shutdown timed out.');
      } catch {
        await this.boundedCleanup(
          [worker?.close(true), queue?.close(), worker?.disconnect(), queue?.disconnect()],
          shutdownDeadline,
        );
        throw new Error('Report worker shutdown failed.');
      } finally {
        this.runPromise = undefined;
      }
    })();
    return this.closing;
  }

  private async process(job: Job<ReportJob>): Promise<void> {
    const data: unknown = job.data;
    const reportId = typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>).reportId
      : undefined;
    if (
      job.name !== 'generate-report'
      || typeof data !== 'object' || data === null || Array.isArray(data)
      || typeof reportId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(reportId)
    ) {
      throw new UnrecoverableError('REPORT_JOB_INVALID');
    }
    const maximumAttempts = typeof job.opts.attempts === 'number' && Number.isSafeInteger(job.opts.attempts) && job.opts.attempts > 0
      ? job.opts.attempts
      : 1;
    const attempt = Math.min(job.attemptsMade + 1, maximumAttempts);
    try {
      await this.options.processReport(reportId, {
        attempt,
        maximumAttempts,
        finalDelivery: attempt >= maximumAttempts,
      });
    } catch {
      throw new Error('REPORT_PROCESSING_RETRY');
    }
  }

  private async timeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async boundedCleanup(operations: Array<Promise<unknown> | undefined>, requestedDeadline?: number): Promise<void> {
    const results = await beforeWorkerDeadline(
      Promise.allSettled(operations.filter((operation): operation is Promise<unknown> => operation !== undefined)),
      requestedDeadline ?? Date.now() + (this.options.shutdownTimeoutMs ?? 10_000),
      'Report worker cleanup timed out.',
    );
    if (results.some((result) => result.status === 'rejected')) throw new Error('Report worker cleanup failed.');
  }
}
