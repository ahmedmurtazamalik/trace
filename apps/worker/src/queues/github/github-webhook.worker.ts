import { Queue, Worker, type Job } from 'bullmq';

export interface GithubWebhookWorkerOptions {
  redisUrl: string;
  queueName?: string;
  concurrency?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  processDelivery(deliveryId: string): Promise<void>;
  recordTerminalFailure(deliveryId: string, code: 'WEBHOOK_PROCESSING_FAILED'): Promise<void>;
}

interface GithubWebhookJob {
  deliveryId: string;
}

export class GithubWebhookWorker {
  private readonly queueName: string;
  private readonly concurrency: number;
  private queue: Queue<GithubWebhookJob> | undefined;
  private worker: Worker<GithubWebhookJob> | undefined;
  private closing: Promise<void> | undefined;
  private runPromise: Promise<void> | undefined;

  get completion(): Promise<void> {
    if (this.runPromise === undefined) return Promise.reject(new Error('Webhook worker has not started.'));
    return this.runPromise.catch((error: unknown) => {
      throw new Error('WEBHOOK_WORKER_FATAL', { cause: error });
    });
  }

  constructor(private readonly options: GithubWebhookWorkerOptions) {
    this.queueName = options.queueName ?? 'github-webhook-deliveries';
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 32) {
      throw new Error('Webhook worker concurrency must be between 1 and 32.');
    }
  }

  async start(): Promise<void> {
    if (this.worker !== undefined) return;
    const connection = {
      url: this.options.redisUrl,
      maxRetriesPerRequest: null,
      retryStrategy: (): null => null,
    };
    this.queue = new Queue<GithubWebhookJob>(this.queueName, { connection });
    this.queue.on('error', () => undefined);
    try {
      await this.withTimeout(
        this.queue.waitUntilReady().then(() => undefined),
        this.options.startupTimeoutMs ?? 5_000,
        'Webhook worker startup timed out.',
      );
      this.worker = new Worker<GithubWebhookJob>(
        this.queueName,
        async (job) => this.process(job),
        { connection, concurrency: this.concurrency, autorun: false },
      );
      this.worker.on('error', () => undefined);
      this.runPromise = this.worker.run();
      await this.withTimeout(this.worker.waitUntilReady(), this.options.startupTimeoutMs ?? 5_000, 'Webhook worker startup timed out.');
    } catch (error) {
      const worker = this.worker;
      const queue = this.queue;
      this.worker = undefined;
      this.queue = undefined;
      await Promise.allSettled([worker?.close(true), queue?.close()]);
      await Promise.allSettled([worker?.disconnect(), queue?.disconnect()]);
      this.runPromise = undefined;
      throw new Error('Webhook worker startup failed.', { cause: error });
    }
  }

  async waitUntilIdle(timeoutMs = 5_000): Promise<void> {
    if (this.queue === undefined) throw new Error('Webhook worker has not started.');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const counts = await this.queue.getJobCounts('active', 'waiting', 'delayed', 'prioritized');
      if (counts.active === 0 && counts.waiting === 0 && counts.delayed === 0 && counts.prioritized === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for the webhook queue to become idle.');
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closing = (async () => {
      const worker = this.worker;
      const queue = this.queue;
      this.worker = undefined;
      this.queue = undefined;
      await worker?.pause(true);
      const deadline = Date.now() + (this.options.shutdownTimeoutMs ?? 10_000);
      let drained = worker === undefined;
      while (!drained && Date.now() < deadline) {
        const counts = await queue?.getJobCounts('active');
        drained = (counts?.active ?? 0) === 0;
        if (!drained) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await Promise.allSettled([
        worker?.close(!drained),
        queue?.close(),
      ]);
      if (drained) {
        await this.runPromise?.catch(() => undefined);
      } else {
        void this.runPromise?.catch(() => undefined);
      }
      this.runPromise = undefined;
    })();
    return this.closing;
  }

  private async process(job: Job<GithubWebhookJob>): Promise<void> {
    const deliveryId = this.deliveryId(job.data);
    if (deliveryId === null) throw new Error('Webhook queue reference is invalid.');
    try {
      await this.options.processDelivery(deliveryId);
    } catch {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (finalAttempt) {
        await this.options.recordTerminalFailure(deliveryId, 'WEBHOOK_PROCESSING_FAILED').catch(() => undefined);
      }
      throw new Error('WEBHOOK_PROCESSING_FAILED');
    }
  }

  private deliveryId(data: GithubWebhookJob): string | null {
    return typeof data.deliveryId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.deliveryId)
      ? data.deliveryId
      : null;
  }

  private async withTimeout(operation: Promise<void>, timeoutMs: number, message: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
