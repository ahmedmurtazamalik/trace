import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { TRACE_CONFIG } from '../../common/config/config.token';

export const GITHUB_WEBHOOK_QUEUE = 'github-webhook-deliveries';
export const PROCESS_GITHUB_WEBHOOK_JOB = 'process-github-webhook';
const HELPER_TIMEOUT_MS = 700;
const HELPER_CONCURRENCY = 4;
const SUCCESS_OUTPUT = 'OK';

const PUBLICATION_HELPER_SOURCE = String.raw`
const { Queue } = require(process.env.TRACE_BULLMQ_MODULE);
const queue = new Queue(process.env.TRACE_QUEUE_NAME, {
  connection: {
    url: process.env.TRACE_REDIS_URL,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempts) => attempts > 2 ? null : 100,
  },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});
(async () => {
  const deliveryId = process.env.TRACE_DELIVERY_ID;
  const jobId = 'github-webhook-' + deliveryId;
  const existing = await queue.getJob(jobId);
  if (existing !== undefined) {
    if (await existing.getState() === 'failed') {
      await existing.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    }
  } else {
    await queue.add(process.env.TRACE_JOB_NAME, { deliveryId }, { jobId });
  }
  await queue.close();
  process.stdout.write('OK');
})().catch(async () => {
  await queue.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
`;

interface SlotWaiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

@Injectable()
export class GithubWebhookQueue implements OnModuleDestroy {
  private readonly redisUrl: string;
  private readonly bullmqModule: string;
  private readonly children = new Set<ChildProcess>();
  private readonly operations = new Set<Promise<void>>();
  private readonly waiters: SlotWaiter[] = [];
  private active = 0;
  private closing = false;

  constructor(@Inject(TRACE_CONFIG) config: TraceConfig) {
    this.redisUrl = config.redisUrl;
    this.bullmqModule = createRequire(__filename).resolve('bullmq');
  }

  enqueue(deliveryId: string, signal?: AbortSignal): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId)) throw new Error('Webhook queue reference is invalid.');
    const operation = this.enqueueTracked(deliveryId, signal);
    this.operations.add(operation);
    const forget = (): void => { this.operations.delete(operation); };
    void operation.then(forget, forget);
    return operation;
  }

  private async enqueueTracked(deliveryId: string, signal?: AbortSignal): Promise<void> {
    await this.acquire(signal);
    try {
      await this.runHelper(deliveryId, signal);
    } finally {
      this.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.onAbort !== undefined) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('Webhook queue is closing.'));
    }
    await Promise.all(Array.from(this.children, async (child) => {
      child.kill('SIGKILL');
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => child.once('close', () => resolve()));
    }));
    await Promise.allSettled(Array.from(this.operations));
  }

  protected helperSource(): string {
    return PUBLICATION_HELPER_SOURCE;
  }

  private async runHelper(deliveryId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closing) throw new Error('Webhook queue is closing.');
    const child = spawn(process.execPath, ['-e', this.helperSource()], {
      env: {
        PATH: process.env.PATH,
        TRACE_BULLMQ_MODULE: this.bullmqModule,
        TRACE_REDIS_URL: this.redisUrl,
        TRACE_QUEUE_NAME: GITHUB_WEBHOOK_QUEUE,
        TRACE_JOB_NAME: PROCESS_GITHUB_WEBHOOK_JOB,
        TRACE_DELIVERY_ID: deliveryId,
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.children.add(child);
    let output = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (output.length <= SUCCESS_OUTPUT.length) output += chunk;
    });
    let timedOut = false;
    const terminate = (): void => {
      timedOut = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(terminate, HELPER_TIMEOUT_MS);
    const onAbort = (): void => terminate();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted === true) terminate();
    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnFailed: boolean }>((resolve) => {
        let spawnFailed = false;
        child.once('error', () => { spawnFailed = true; });
        child.once('close', (code, childSignal) => resolve({ code, signal: childSignal, spawnFailed }));
      });
      if (timedOut || result.spawnFailed || result.signal !== null || result.code !== 0 || output !== SUCCESS_OUTPUT) {
        throw new Error('Webhook queue publication failed.');
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      this.children.delete(child);
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closing) throw new Error('Webhook queue is closing.');
    if (this.active < HELPER_CONCURRENCY) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: SlotWaiter = { resolve, reject, signal };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Webhook queue publication aborted.'));
      };
      waiter.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
      if (signal?.aborted === true) onAbort();
    });
  }

  private release(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift() as SlotWaiter;
      if (waiter.onAbort !== undefined) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal?.aborted === true) continue;
      waiter.resolve();
      return;
    }
    this.active -= 1;
  }
}
