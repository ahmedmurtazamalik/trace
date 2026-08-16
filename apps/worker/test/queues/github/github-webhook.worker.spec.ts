import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import {
  GithubWebhookWorker,
  type WebhookQueueResource,
  type WebhookWorkerResource,
} from '../../../src/queues/github/github-webhook.worker';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

describe('GitHub webhook worker lifecycle', () => {
  let queue: Queue<{ deliveryId: string }>;
  let queueName: string;
  let worker: GithubWebhookWorker | undefined;
  let skipObliterate = false;

  beforeEach(() => {
    queueName = `github-webhook-deliveries-worker-test-${process.pid}-${randomUUID()}`;
    queue = new Queue(queueName, { connection: { url: redisUrl } });
    skipObliterate = false;
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    if (skipObliterate) {
      await queue.disconnect();
    } else {
      await queue.obliterate({ force: true });
      await queue.close();
    }
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

  it('fails startup visibly when Redis is unavailable', async () => {
    worker = new GithubWebhookWorker({
      redisUrl: 'redis://127.0.0.1:1',
      queueName,
      startupTimeoutMs: 250,
      shutdownTimeoutMs: 500,
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
    });

    await expect(worker.start()).rejects.toThrow('Webhook worker startup failed.');
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  it('force-closes resources after the graceful shutdown deadline', async () => {
    skipObliterate = true;
    let markProcessorFinished: (() => void) | undefined;
    const processorFinished = new Promise<void>((resolve) => { markProcessorFinished = resolve; });
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      shutdownTimeoutMs: 50,
      processDelivery: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        markProcessorFinished?.();
      },
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
    });
    await worker.start();
    await queue.add('process-github-webhook', { deliveryId: 'delivery-hung' }, { jobId: 'github-webhook-delivery-hung' });
    const deadline = Date.now() + 2_000;
    while ((await queue.getJobCounts('active')).active === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await expect(worker.close()).rejects.toThrow('Webhook worker shutdown failed.');
    await processorFinished;
    worker = undefined;
  });

  it.each(['pause', 'count', 'close'] as const)(
    'bounds shutdown when the %s lifecycle phase stalls',
    async (stalledPhase) => {
      const never = new Promise<never>(() => undefined);
      const queueDisconnect = jest.fn().mockResolvedValue(undefined);
      const workerDisconnect = jest.fn().mockResolvedValue(undefined);
      const queueResource: WebhookQueueResource = {
        on: jest.fn(),
        waitUntilReady: jest.fn().mockResolvedValue(undefined),
        getJobCounts: jest.fn().mockReturnValue(
          stalledPhase === 'count' ? never : Promise.resolve({ active: 0 }),
        ),
        close: jest.fn().mockReturnValue(
          stalledPhase === 'close' ? never : Promise.resolve(),
        ),
        disconnect: queueDisconnect,
      };
      const workerResource: WebhookWorkerResource = {
        on: jest.fn(),
        run: jest.fn().mockReturnValue(never),
        waitUntilReady: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn().mockReturnValue(
          stalledPhase === 'pause' ? never : Promise.resolve(),
        ),
        close: jest.fn().mockReturnValue(
          stalledPhase === 'close' ? never : Promise.resolve(),
        ),
        disconnect: workerDisconnect,
      };
      worker = new GithubWebhookWorker({
        redisUrl,
        queueName,
        shutdownTimeoutMs: 50,
        processDelivery: jest.fn().mockResolvedValue(undefined),
        recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
        createQueue: () => queueResource,
        createWorker: () => workerResource,
      });
      await worker.start();

      const startedAt = Date.now();
      await expect(worker.close()).rejects.toThrow('Webhook worker shutdown failed.');

      expect(Date.now() - startedAt).toBeLessThan(200);
      expect(workerDisconnect).toHaveBeenCalledTimes(1);
      expect(queueDisconnect).toHaveBeenCalledTimes(1);
      worker = undefined;
    },
  );

  it('evaluates and preserves a forced-cleanup rejection as the generic shutdown cause', async () => {
    const queueResource: WebhookQueueResource = {
      on: jest.fn(),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn().mockResolvedValue({ active: 0 }),
      close: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const workerResource: WebhookWorkerResource = {
      on: jest.fn(),
      run: jest.fn().mockResolvedValue(undefined),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockRejectedValue(new Error('secret graceful failure')),
      close: jest.fn().mockImplementation((force?: boolean) => force
        ? Promise.reject(new Error('secret forced failure'))
        : Promise.resolve()),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      shutdownTimeoutMs: 50,
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      createQueue: () => queueResource,
      createWorker: () => workerResource,
    });
    await worker.start();

    let failure: Error | undefined;
    try {
      await worker.close();
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).toBe('Webhook worker shutdown failed.');
    expect((failure?.cause as Error).message).toBe('Webhook worker forced cleanup failed.');
    expect((failure?.cause as Error).message).not.toContain('secret');
    worker = undefined;
  });

  it('bounds failed-start cleanup when every resource cleanup operation stalls', async () => {
    const never = new Promise<never>(() => undefined);
    const queueClose = jest.fn().mockReturnValue(never);
    const queueDisconnect = jest.fn().mockReturnValue(never);
    const queueResource: WebhookQueueResource = {
      on: jest.fn(),
      waitUntilReady: jest.fn().mockRejectedValue(new Error('unavailable')),
      getJobCounts: jest.fn(),
      close: queueClose,
      disconnect: queueDisconnect,
    };
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      shutdownTimeoutMs: 50,
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      createQueue: () => queueResource,
    });

    const startedAt = Date.now();
    await expect(worker.start()).rejects.toThrow('Webhook worker startup failed.');

    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(queueClose).toHaveBeenCalledTimes(1);
    expect(queueDisconnect).toHaveBeenCalledTimes(1);
    worker = undefined;
  });

  it('observes a late run-loop rejection after bounded worker-start cleanup', async () => {
    const never = new Promise<never>(() => undefined);
    let rejectRun: (reason: Error) => void = () => undefined;
    const runPromise = new Promise<void>((_resolve, reject) => {
      rejectRun = reject;
    });
    const runCatch = jest.spyOn(runPromise, 'catch');
    const queueClose = jest.fn().mockReturnValue(never);
    const queueDisconnect = jest.fn().mockReturnValue(never);
    const workerClose = jest.fn().mockReturnValue(never);
    const workerDisconnect = jest.fn().mockReturnValue(never);
    const queueResource: WebhookQueueResource = {
      on: jest.fn(),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn(),
      close: queueClose,
      disconnect: queueDisconnect,
    };
    const workerResource: WebhookWorkerResource = {
      on: jest.fn(),
      run: jest.fn().mockReturnValue(runPromise),
      waitUntilReady: jest.fn().mockRejectedValue(new Error('unavailable')),
      pause: jest.fn(),
      close: workerClose,
      disconnect: workerDisconnect,
    };
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      shutdownTimeoutMs: 50,
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      createQueue: () => queueResource,
      createWorker: () => workerResource,
    });

    const startedAt = Date.now();
    await expect(worker.start()).rejects.toThrow('Webhook worker startup failed.');

    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(workerClose).toHaveBeenCalledTimes(1);
    expect(queueClose).toHaveBeenCalledTimes(1);
    expect(workerDisconnect).toHaveBeenCalledTimes(1);
    expect(queueDisconnect).toHaveBeenCalledTimes(1);
    expect(runCatch).toHaveBeenCalledTimes(1);
    rejectRun(new Error('secret late run-loop rejection'));
    await new Promise((resolve) => setImmediate(resolve));
    worker = undefined;
  });

  it('sanitizes a terminal observability failure before BullMQ persistence', async () => {
    const processDelivery = jest.fn().mockRejectedValue(new Error('secret processor fragment'));
    const recordTerminalFailure = jest.fn().mockRejectedValue(new Error('secret observability fragment'));
    worker = new GithubWebhookWorker({
      redisUrl,
      queueName,
      processDelivery,
      recordTerminalFailure,
    });
    await worker.start();

    await queue.add('process-github-webhook', { deliveryId: 'delivery-observability-failure' }, {
      attempts: 1,
      jobId: 'github-webhook-delivery-observability-failure',
    });
    await worker.waitUntilIdle(5_000);

    const failedJob = await queue.getJob('github-webhook-delivery-observability-failure');
    expect(failedJob?.failedReason).toBe('WEBHOOK_PROCESSING_FAILED');
    expect((failedJob?.stacktrace ?? []).join('\n')).not.toContain('secret observability fragment');
    expect((failedJob?.stacktrace ?? []).join('\n')).not.toContain('secret processor fragment');
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
    const failedJob = await queue.getJob('github-webhook-delivery-row-failure');
    expect(failedJob?.failedReason).toBe('WEBHOOK_PROCESSING_FAILED');
    expect((failedJob?.stacktrace ?? []).join('\n')).not.toContain('secret payload fragment');

    await worker.close();
  });
});
