import { PrismaClient } from '@trace/database';
import { artifactStorageFromEnvironment } from '@trace/report-storage';
import { DockerLatexCompiler } from '../latex/latex-compiler';
import { ReportQueueWorker, type ReportQueueWorkerOptions } from '../queues/reports/report.worker';
import { reportProviderFromEnvironment } from './configured-report-provider';
import { ReportArtifactProcessor } from './report-artifact.processor';
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
    const generation = new ReportProcessor(prisma, provider, { maximumAttempts: configuration.providerAttempts });
    const processor = options.processor ?? new ReportArtifactProcessor(
      prisma,
      generation,
      new DockerLatexCompiler({ image: configuration.latexImage, timeoutMs: configuration.compileTimeoutMs }),
      artifactStorageFromEnvironment(options.environment),
      configuration.compileTimeoutMs + 60_000,
    );
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
  latexImage: string;
  compileTimeoutMs: number;
} {
  const nodeEnvironment = environment.NODE_ENV;
  const databaseUrl = environment.DATABASE_URL;
  const redisUrl = environment.REDIS_URL;
  const provider = environment.REPORT_LLM_PROVIDER ?? 'fake';
  if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test' && nodeEnvironment !== 'production') {
    throw new Error('Invalid report worker configuration.');
  }
  const latexImage = environment.REPORT_LATEX_IMAGE ?? (nodeEnvironment === 'production' ? undefined : 'trace-latex:local');
  if (
    databaseUrl === undefined || !databaseUrl.startsWith('postgresql://')
    || redisUrl === undefined || !/^rediss?:\/\//.test(redisUrl)
    || latexImage === undefined
    || (nodeEnvironment === 'production' && !/@sha256:[a-f0-9]{64}$/.test(latexImage))
    || (nodeEnvironment === 'production' && provider === 'fake')
  ) throw new Error('Invalid report worker configuration.');
  return {
    databaseUrl,
    redisUrl,
    queueName: 'report-generation',
    concurrency: boundedInteger(environment.REPORT_WORKER_CONCURRENCY, 2, 1, 16),
    providerAttempts: boundedInteger(environment.REPORT_PROVIDER_ATTEMPTS, 3, 1, 5),
    latexImage,
    compileTimeoutMs: boundedInteger(environment.REPORT_LATEX_TIMEOUT_MS, 30_000, 5_000, 120_000),
  };
}


function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('Invalid report worker configuration.');
  return parsed;
}
