import { GithubWebhookWorker } from './queues/github/github-webhook.worker';

export interface WorkerLifecycle {
  start(): Promise<void>;
  close(): Promise<void>;
  readonly completion: Promise<void>;
}

export interface WorkerRuntimeOptions {
  environment: NodeJS.ProcessEnv;
  processDelivery(deliveryId: string): Promise<void>;
  recordTerminalFailure(deliveryId: string, code: 'WEBHOOK_PROCESSING_FAILED'): Promise<void>;
  signals?: NodeJS.Process;
  workerFactory?: (options: ConstructorParameters<typeof GithubWebhookWorker>[0]) => WorkerLifecycle;
}

export async function runGithubWebhookWorker(options: WorkerRuntimeOptions): Promise<() => Promise<void>> {
  const redisUrl = options.environment.REDIS_URL;
  if (redisUrl === undefined || !/^rediss?:\/\//.test(redisUrl)) {
    throw new Error('Invalid worker configuration: REDIS_URL is required.');
  }
  const concurrency = integer(options.environment.WEBHOOK_WORKER_CONCURRENCY, 4, 1, 32);
  const queueName = options.environment.WEBHOOK_QUEUE_NAME;
  if (queueName !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(queueName)) {
    throw new Error('Invalid worker configuration: WEBHOOK_QUEUE_NAME is invalid.');
  }
  const worker = (options.workerFactory ?? ((workerOptions) => new GithubWebhookWorker(workerOptions)))({
    redisUrl,
    queueName,
    concurrency,
    processDelivery: async (deliveryId) => options.processDelivery(deliveryId),
    recordTerminalFailure: async (deliveryId, code) => options.recordTerminalFailure(deliveryId, code),
  });
  await worker.start();

  const signals = options.signals ?? process;
  let stopping: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    stopping = worker.close();
    await stopping;
    signals.off('SIGINT', onSignal);
    signals.off('SIGTERM', onSignal);
  };
  const onSignal = (): void => { void stop().catch(() => { signals.exitCode = 1; }); };
  signals.once('SIGINT', onSignal);
  signals.once('SIGTERM', onSignal);
  void worker.completion.catch(() => {
    signals.exitCode = 1;
    return stop().catch(() => undefined);
  });
  return stop;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid worker configuration: concurrency must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
