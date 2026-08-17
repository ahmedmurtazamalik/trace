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

  it('closes application resources after the worker stops', async () => {
    const closeResources = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const lifecycle: WorkerLifecycle = {
      start: jest.fn().mockResolvedValue(undefined),
      close,
      completion: new Promise<void>(() => undefined),
    };
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      closeResources,
      workerFactory: () => lifecycle,
    });

    await stop();
    await stop();

    expect(close).toHaveBeenCalledTimes(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
  });

  it('forwards the coordinator absolute deadline into webhook queue shutdown', async () => {
    const close = jest.fn<Promise<void>, [number?]>(() => Promise.resolve());
    const lifecycle: WorkerLifecycle = {
      start: jest.fn().mockResolvedValue(undefined),
      close,
      completion: new Promise<void>(() => undefined),
    };
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      workerFactory: () => lifecycle,
    });
    const deadline = Date.now() + 1_000;

    await stop(deadline);

    expect(close).toHaveBeenCalledWith(deadline);
  });

  it('does not reset an exhausted coordinator deadline for resource cleanup', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    let releaseClose: (() => void) | undefined;
    const close = jest.fn<Promise<void>, [number?]>(() => new Promise<void>((resolve) => { releaseClose = resolve; }));
    const closeResources = jest.fn().mockResolvedValue(undefined);
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      closeResources,
      resourceCleanupTimeoutMs: 10_000,
      workerFactory: () => ({
        start: jest.fn().mockResolvedValue(undefined),
        close,
        completion: new Promise<void>(() => undefined),
      }),
    });

    const stopping = stop(2_000);
    await Promise.resolve();
    now.mockReturnValue(2_001);
    releaseClose?.();

    await expect(stopping).rejects.toThrow('Application resource cleanup timed out.');
    expect(closeResources).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('propagates one validated shutdown budget into the webhook queue worker', async () => {
    let capturedShutdownTimeoutMs: number | undefined;
    const lifecycle: WorkerLifecycle = {
      start: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      completion: new Promise<void>(() => undefined),
    };
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl, WORKER_SHUTDOWN_TIMEOUT_MS: '120000' },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      workerFactory: (options) => {
        capturedShutdownTimeoutMs = options.shutdownTimeoutMs;
        return lifecycle;
      },
    });

    expect(capturedShutdownTimeoutMs).toBe(120_000);
    await stop();
    await expect(runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl, WORKER_SHUTDOWN_TIMEOUT_MS: '9999' },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
    })).rejects.toThrow('WORKER_SHUTDOWN_TIMEOUT_MS');
  });

  it('bounds application resource cleanup after the worker stops', async () => {
    const closeResources = jest.fn(() => new Promise<void>(() => undefined));
    const lifecycle: WorkerLifecycle = {
      start: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      completion: new Promise<void>(() => undefined),
    };
    const stop = await runGithubWebhookWorker({
      environment: { REDIS_URL: redisUrl },
      processDelivery: jest.fn().mockResolvedValue(undefined),
      recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
      closeResources,
      resourceCleanupTimeoutMs: 20,
      workerFactory: () => lifecycle,
    });

    await expect(stop()).rejects.toThrow('Application resource cleanup timed out.');
    expect(closeResources).toHaveBeenCalledTimes(1);
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
