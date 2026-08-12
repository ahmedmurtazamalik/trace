import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Queue } from 'bullmq';
import { runGithubWebhookWorker } from '../src/runtime';
import type { WorkerLifecycle } from '../src/runtime';

class SignalProcess extends EventEmitter {
  exitCode: number | undefined;
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

describe('worker runtime composition', () => {
  it('validates configuration before starting', async () => {
    await expect(runGithubWebhookWorker({
      environment: {},
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
    })).rejects.toThrow('REDIS_URL is required');
  });

  it('starts a real processor and closes on SIGTERM', async () => {
    const queueName = `github-webhook-runtime-test-${process.pid}-${randomUUID()}`;
    const queue = new Queue<{ deliveryId: string }>(queueName, { connection: { url: redisUrl } });
    const signals = new SignalProcess();
    const processed = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl, WEBHOOK_WORKER_CONCURRENCY: '1', WEBHOOK_QUEUE_NAME: queueName },
      processDelivery: processed,
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      signals: signals as unknown as NodeJS.Process,
    });

    try {
      await queue.add('process', { deliveryId: 'runtime-delivery' }, { jobId: 'runtime-delivery' });
      const deadline = Date.now() + 5_000;
      while (processed.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(processed).toHaveBeenCalledWith('runtime-delivery');
      signals.emit('SIGTERM');
      await stop();
      await expect(stop()).resolves.toBeUndefined();
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('marks the process failed and closes when the run loop dies', async () => {
    const signals = new SignalProcess();
    let rejectCompletion: ((error: Error) => void) | undefined;
    const completion = new Promise<void>((_resolve, reject) => { rejectCompletion = reject; });
    const close = jest.fn().mockResolvedValue(undefined);
    const lifecycle: WorkerLifecycle = {
      start: jest.fn().mockResolvedValue(undefined),
      close,
      completion,
    };
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      signals: signals as unknown as NodeJS.Process,
      workerFactory: () => lifecycle,
    });

    rejectCompletion?.(new Error('secret run-loop detail'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(signals.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(stop()).resolves.toBeUndefined();
  });
});
