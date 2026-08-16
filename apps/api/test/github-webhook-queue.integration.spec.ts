import type { TraceConfig } from '@trace/config';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
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
});
