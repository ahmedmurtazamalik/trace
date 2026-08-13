import { PrismaClient } from '@trace/database';
import { ReportQueueWorker, type ReportQueueWorkerOptions } from '../queues/reports/report.worker';
import { reportProviderFromEnvironment } from './configured-report-provider';
import { ReportProcessor } from './report.processor';

interface ReportProcessorLike { process(reportId: string): Promise<void> }
interface ReportWorkerLifecycle { start(): Promise<void>; close(): Promise<void>; readonly completion: Promise<void> }

export interface ReportApplicationOptions {
  environment: NodeJS.ProcessEnv;
  signals?: NodeJS.Process;
  prisma?: PrismaClient;
  processor?: ReportProcessorLike;
  workerFactory?: (options: ReportQueueWorkerOptions) => ReportWorkerLifecycle;
  cleanupTimeoutMs?: number;
  onRuntimeFailure?: () => void;
}

export async function startReportWorker(options: ReportApplicationOptions): Promise<() => Promise<void>> {
  const configuration = reportWorkerConfiguration(options.environment);
  const prisma = options.prisma ?? new PrismaClient({ datasourceUrl: configuration.databaseUrl });
  let worker: ReportWorkerLifecycle | undefined;
  let connected = false;
  try {
    const provider = reportProviderFromEnvironment(options.environment);
    const processor = options.processor ?? new ReportProcessor(prisma, provider, { maximumAttempts: configuration.providerAttempts });
    await prisma.$connect();
    connected = true;
    worker = (options.workerFactory ?? ((workerOptions) => new ReportQueueWorker(workerOptions)))({
      redisUrl: configuration.redisUrl,
      queueName: configuration.queueName,
      concurrency: configuration.concurrency,
      processReport: (reportId) => processor.process(reportId),
    });
    await worker.start();
  } catch {
    if (connected) await prisma.$disconnect().catch(() => undefined);
    throw new Error('Report worker startup failed.');
  }

  const signals = options.signals;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 10_000;
  let stopping: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    stopping = (async () => {
      try {
        await withTimeout(worker?.close() ?? Promise.resolve(), cleanupTimeoutMs);
      } finally {
        await withTimeout(prisma.$disconnect(), cleanupTimeoutMs);
        signals?.off('SIGINT', onSignal);
        signals?.off('SIGTERM', onSignal);
      }
    })();
    return stopping;
  };
  const onSignal = (): void => { void stop().catch(() => { if (signals !== undefined) signals.exitCode = 1; }); };
  signals?.once('SIGINT', onSignal);
  signals?.once('SIGTERM', onSignal);
  void worker.completion.catch(() => {
    options.onRuntimeFailure?.();
    if (signals !== undefined) signals.exitCode = 1;
    return stop().catch(() => undefined);
  });
  return stop;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Report cleanup timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function reportWorkerConfiguration(environment: NodeJS.ProcessEnv): {
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  concurrency: number;
  providerAttempts: number;
} {
  const databaseUrl = environment.DATABASE_URL;
  const redisUrl = environment.REDIS_URL;
  const provider = environment.REPORT_LLM_PROVIDER ?? 'fake';
  if (
    databaseUrl === undefined || !databaseUrl.startsWith('postgresql://')
    || redisUrl === undefined || !/^rediss?:\/\//.test(redisUrl)
    || (environment.NODE_ENV === 'production' && provider === 'fake')
  ) throw new Error('Invalid report worker configuration.');
  return {
    databaseUrl,
    redisUrl,
    queueName: 'report-generation',
    concurrency: boundedInteger(environment.REPORT_WORKER_CONCURRENCY, 2, 1, 16),
    providerAttempts: boundedInteger(environment.REPORT_PROVIDER_ATTEMPTS, 3, 1, 5),
  };
}


function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('Invalid report worker configuration.');
  return parsed;
}
