import { Queue, Worker, type Job } from 'bullmq';

export interface GithubWebhookWorkerOptions {
  redisUrl: string;
  queueName?: string;
  concurrency?: number;
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

  constructor(private readonly options: GithubWebhookWorkerOptions) {
    this.queueName = options.queueName ?? 'github-webhook-deliveries';
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 32) {
      throw new Error('Webhook worker concurrency must be between 1 and 32.');
    }
  }

  start(): Promise<void> {
    if (this.worker !== undefined) return Promise.resolve();
    const connection = { url: this.options.redisUrl };
    this.queue = new Queue<GithubWebhookJob>(this.queueName, { connection });
    this.worker = new Worker<GithubWebhookJob>(
      this.queueName,
      async (job) => this.process(job),
      { connection, concurrency: this.concurrency, autorun: false },
    );
    this.worker.on('failed', (job) => {
      if (job === undefined || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      const deliveryId = this.deliveryId(job.data);
      if (deliveryId === null) return;
      void this.options.recordTerminalFailure(deliveryId, 'WEBHOOK_PROCESSING_FAILED').catch(() => undefined);
    });
    void this.worker.run().catch(() => undefined);
    return Promise.resolve();
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
      await worker?.close();
      await queue?.close();
    })();
    return this.closing;
  }

  private async process(job: Job<GithubWebhookJob>): Promise<void> {
    const deliveryId = this.deliveryId(job.data);
    if (deliveryId === null) throw new Error('Webhook queue reference is invalid.');
    await this.options.processDelivery(deliveryId);
  }

  private deliveryId(data: GithubWebhookJob): string | null {
    return typeof data.deliveryId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.deliveryId)
      ? data.deliveryId
      : null;
  }
}
