import type { TraceConfig } from '@trace/config';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_WEBHOOK_QUEUE, GithubWebhookQueue } from '../src/modules/webhooks/github-webhook.queue';

const redisUrl = process.env.REDIS_URL;
const describeIntegration = redisUrl === undefined ? describe.skip : describe;

describeIntegration('GitHub webhook queue recovery', () => {
  it('retries a retained failed deterministic job when reconciliation republishes a pending delivery', async () => {
    const deliveryId = `retained-failure-${randomUUID()}`;
    const jobId = `github-webhook-${deliveryId}`;
    const connection = { url: redisUrl! };
    const rawQueue = new Queue<{ deliveryId: string }>(GITHUB_WEBHOOK_QUEUE, { connection });
    let fail = true;
    let processorCalls = 0;
    const worker = new Worker<{ deliveryId: string }>(GITHUB_WEBHOOK_QUEUE, () => {
      processorCalls += 1;
      return fail
        ? Promise.reject(new Error('simulated terminal worker failure'))
        : Promise.resolve();
    }, { connection });
    const queue = new GithubWebhookQueue({ redisUrl } as TraceConfig);

    try {
      await rawQueue.add('process-github-webhook', { deliveryId }, { jobId, attempts: 1, removeOnFail: false });
      const deadline = Date.now() + 5_000;
      let retained = await rawQueue.getJob(jobId);
      while (await retained?.getState() !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        retained = await rawQueue.getJob(jobId);
      }
      expect(await retained?.getState()).toBe('failed');
      retained = await rawQueue.getJob(jobId);
      expect(retained?.attemptsMade).toBe(1);
      expect(retained?.attemptsStarted).toBe(1);

      fail = false;
      await queue.enqueue(deliveryId);

      while (processorCalls < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const recovered = await rawQueue.getJob(jobId);
      expect(processorCalls).toBe(2);
      expect(await recovered?.getState()).toBe('completed');
      expect(recovered?.attemptsMade).toBe(1);
      expect(recovered?.attemptsStarted).toBe(1);
    } finally {
      await worker.close();
      await queue.onModuleDestroy();
      const job = await rawQueue.getJob(jobId);
      await job?.remove().catch(() => undefined);
      await rawQueue.close();
    }
  }, 10_000);

  it('kills and reaps an aborted mutation helper before it can produce a late side effect', async () => {
    const queue = new GithubWebhookQueue({ redisUrl } as TraceConfig);
    const marker = join(tmpdir(), `trace-queue-helper-${randomUUID()}`);
    jest.spyOn(queue as unknown as { helperSource: () => string }, 'helperSource').mockReturnValue(
      `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 250);`,
    );
    const controller = new AbortController();

    try {
      const publication = queue.enqueue(`aborted-${randomUUID()}`, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();
      await expect(publication).rejects.toThrow('Webhook queue publication failed.');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await expect(access(marker)).rejects.toBeDefined();
    } finally {
      await queue.onModuleDestroy();
      await rm(marker, { force: true });
    }
  });

  it('does not return from destruction while an admitted enqueue can still spawn', async () => {
    const queue = new GithubWebhookQueue({ redisUrl } as TraceConfig);
    const marker = join(tmpdir(), `trace-queue-destroy-${randomUUID()}`);
    let releaseAcquire: (() => void) | undefined;
    const acquireGate = new Promise<void>((resolve) => { releaseAcquire = resolve; });
    jest.spyOn(queue as unknown as { acquire: () => Promise<void> }, 'acquire').mockImplementation(() => acquireGate);
    jest.spyOn(queue as unknown as { helperSource: () => string }, 'helperSource').mockReturnValue(
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'); process.stdout.write('OK');`,
    );

    try {
      const publication = queue.enqueue(`destroyed-${randomUUID()}`);
      await new Promise((resolve) => setImmediate(resolve));
      const destruction = queue.onModuleDestroy();
      releaseAcquire?.();
      await destruction;
      await expect(publication).rejects.toThrow('Webhook queue is closing.');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(access(marker)).rejects.toBeDefined();
    } finally {
      await rm(marker, { force: true });
    }
  });

  it('resolves BullMQ independently of the API process working directory', async () => {
    const previousCwd = process.cwd();
    const deliveryId = `cwd-independent-${randomUUID()}`;
    const jobId = `github-webhook-${deliveryId}`;
    const rawQueue = new Queue<{ deliveryId: string }>(GITHUB_WEBHOOK_QUEUE, { connection: { url: redisUrl! } });
    const queue = new GithubWebhookQueue({ redisUrl } as TraceConfig);
    try {
      process.chdir(join(__dirname, '../../..'));
      await queue.enqueue(deliveryId);
      expect(await rawQueue.getJob(jobId)).toBeDefined();
    } finally {
      process.chdir(previousCwd);
      await queue.onModuleDestroy();
      await (await rawQueue.getJob(jobId))?.remove().catch(() => undefined);
      await rawQueue.close();
    }
  });
});
