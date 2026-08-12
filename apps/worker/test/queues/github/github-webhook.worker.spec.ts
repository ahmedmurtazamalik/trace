import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { GithubWebhookWorker } from '../../../src/queues/github/github-webhook.worker';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

describe('GitHub webhook worker lifecycle', () => {
  let queue: Queue<{ deliveryId: string }>;
  let queueName: string;
  let worker: GithubWebhookWorker | undefined;

  beforeEach(() => {
    queueName = `github-webhook-deliveries-worker-test-${process.pid}-${randomUUID()}`;
    queue = new Queue(queueName, { connection: { url: redisUrl } });
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('processes a bounded durable reference and closes gracefully', async () => {
    const processed = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const terminalFailure = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      concurrency: 2,
      processDelivery: processed,
      recordTerminalFailure: terminalFailure,
    });

    await worker.start();
    await queue.add('process', { deliveryId: 'delivery-row-1' }, { jobId: 'github-webhook-delivery-row-1' });
    await worker.waitUntilIdle();

    expect(processed).toHaveBeenCalledTimes(1);
    expect(processed).toHaveBeenCalledWith('delivery-row-1');
    expect(terminalFailure).not.toHaveBeenCalled();

    await worker.close();
    await expect(worker.close()).resolves.toBeUndefined();
  });

  it('records one sanitized terminal failure after bounded retries are exhausted', async () => {
    const processed = jest.fn<Promise<void>, [string]>().mockRejectedValue(new Error('secret payload fragment'));
    const terminalFailure = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      concurrency: 1,
      processDelivery: processed,
      recordTerminalFailure: terminalFailure,
    });

    await worker.start();
    await queue.add(
      'process',
      { deliveryId: 'delivery-row-failure' },
      { jobId: 'github-webhook-delivery-row-failure', attempts: 2, backoff: { type: 'fixed', delay: 1 } },
    );
    await worker.waitUntilIdle();

    expect(processed).toHaveBeenCalledTimes(2);
    expect(terminalFailure).toHaveBeenCalledTimes(1);
    expect(terminalFailure).toHaveBeenCalledWith('delivery-row-failure', 'WEBHOOK_PROCESSING_FAILED');

    await worker.close();
  });
});
