import { PrismaClient } from '@trace/database';
import { artifactStorageFromEnvironment } from '@trace/report-storage';
import { isAbsolute } from 'node:path';
import { DockerLatexCompiler } from '../latex/latex-compiler';
import { ReportQueueWorker, type ReportQueueWorkerOptions } from '../queues/reports/report.worker';
import { reportProviderFromEnvironment } from './codex-cli-report-provider';
import { ReportArtifactProcessor } from './report-artifact.processor';
import type { ReportDeliveryContext } from './report-delivery';
import { ReportProcessor } from './report.processor';
import { AutomaticSlackReportNotifier } from './report-slack-notifier';
import { beforeWorkerDeadline, workerShutdownDeadline, workerShutdownTimeoutMs, type WorkerStop } from '../shutdown-budget';

interface ReportProcessorLike { process(reportId: string, delivery?: ReportDeliveryContext): Promise<void> }
interface ReportWorkerLifecycle { start(): Promise<void>; close(deadline?: number): Promise<void>; readonly completion: Promise<void> }

export interface ReportApplicationOptions {
  environment: NodeJS.ProcessEnv;
  signals?: NodeJS.Process;
  prisma?: PrismaClient;
  processor?: ReportProcessorLike;
  workerFactory?: (options: ReportQueueWorkerOptions) => ReportWorkerLifecycle;
  cleanupTimeoutMs?: number;
  onRuntimeFailure?: () => void;
}

export async function startReportWorker(options: ReportApplicationOptions): Promise<WorkerStop> {
  const configuration = reportWorkerConfiguration(options.environment);
  const prisma = options.prisma ?? new PrismaClient({ datasourceUrl: configuration.databaseUrl });
  let worker: ReportWorkerLifecycle | undefined;
  let connected = false;
  try {
    const provider = reportProviderFromEnvironment(options.environment);
    const generation = new ReportProcessor(prisma, provider);
    const notifier = configuration.slackWebhookUrl === undefined
      ? undefined
      : new AutomaticSlackReportNotifier(prisma, {
        frontendOrigin: configuration.frontendOrigin,
        webhookUrl: configuration.slackWebhookUrl,
      });
    const processor = options.processor ?? new ReportArtifactProcessor(
      prisma,
      generation,
      new DockerLatexCompiler({
        image: configuration.latexImage,
        timeoutMs: configuration.compileTimeoutMs,
        workingRoot: configuration.latexWorkRoot,
      }),
      artifactStorageFromEnvironment(options.environment),
      configuration.compileTimeoutMs + 60_000,
      30_000,
      notifier,
    );
    await prisma.$connect();
    connected = true;
    worker = (options.workerFactory ?? ((workerOptions) => new ReportQueueWorker(workerOptions)))({
      redisUrl: configuration.redisUrl,
      queueName: configuration.queueName,
      concurrency: configuration.concurrency,
      shutdownTimeoutMs: configuration.shutdownTimeoutMs,
      processReport: (reportId, delivery) => processor.process(reportId, delivery),
    });
    await worker.start();
  } catch {
    if (connected) await prisma.$disconnect().catch(() => undefined);
    throw new Error('Report worker startup failed.');
  }

  const signals = options.signals;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? configuration.shutdownTimeoutMs;
  let stopping: Promise<void> | undefined;
  const stop = async (requestedDeadline?: number): Promise<void> => {
    if (stopping !== undefined) return stopping;
    const deadline = requestedDeadline ?? workerShutdownDeadline(options.environment);
    stopping = (async () => {
      try {
        await beforeWorkerDeadline(worker?.close(deadline) ?? Promise.resolve(), deadline, 'Report cleanup timed out.');
      } finally {
        await beforeWorkerDeadline(
          prisma.$disconnect(),
          Math.min(deadline, Date.now() + cleanupTimeoutMs),
          'Report cleanup timed out.',
        );
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


export function reportWorkerConfiguration(environment: NodeJS.ProcessEnv): {
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  concurrency: number;
  latexImage: string;
  latexWorkRoot?: string;
  compileTimeoutMs: number;
  shutdownTimeoutMs: number;
  frontendOrigin: string;
  slackWebhookUrl?: string;
} {
  const nodeEnvironment = environment.NODE_ENV;
  const databaseUrl = environment.DATABASE_URL;
  const redisUrl = environment.REDIS_URL;
  const provider = environment.REPORT_LLM_PROVIDER ?? 'fake';
  const latexWorkRoot = environment.REPORT_LATEX_WORK_ROOT;
  const frontendOrigin = environment.FRONTEND_ORIGIN?.trim() || 'http://localhost:3000';
  const slackWebhookUrl = environment.SLACK_REPORT_WEBHOOK_URL?.trim() || undefined;
  if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test' && nodeEnvironment !== 'production') {
    throw new Error('Invalid report worker configuration.');
  }
  const latexImage = environment.REPORT_LATEX_IMAGE ?? (nodeEnvironment === 'production' ? undefined : 'trace-latex:local');
  if (
    databaseUrl === undefined || !databaseUrl.startsWith('postgresql://')
    || redisUrl === undefined || !/^rediss?:\/\//.test(redisUrl)
    || latexImage === undefined
    || (latexWorkRoot !== undefined && !isAbsolute(latexWorkRoot))
    || (nodeEnvironment === 'production' && latexWorkRoot === undefined)
    || (nodeEnvironment === 'production' && !/(?:@sha256:|^sha256:)[a-f0-9]{64}$/.test(latexImage))
    || (provider !== 'fake' && provider !== 'codex')
    || (nodeEnvironment === 'production' && provider === 'fake')
    || !validFrontendOrigin(frontendOrigin, nodeEnvironment === 'production')
    || (slackWebhookUrl !== undefined && !validSlackWebhookUrl(slackWebhookUrl))
  ) throw new Error('Invalid report worker configuration.');
  return {
    databaseUrl,
    redisUrl,
    queueName: 'report-generation',
    concurrency: boundedInteger(environment.REPORT_WORKER_CONCURRENCY, 2, 1, 16),
    latexImage,
    latexWorkRoot,
    compileTimeoutMs: boundedInteger(environment.REPORT_LATEX_TIMEOUT_MS, 30_000, 5_000, 120_000),
    shutdownTimeoutMs: workerShutdownTimeoutMs(environment),
    frontendOrigin,
    slackWebhookUrl,
  };
}

function validFrontendOrigin(value: string, requireHttps: boolean): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (!requireHttps && url.protocol === 'http:'))
      && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

function validSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'hooks.slack.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && /^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname);
  } catch {
    return false;
  }
}


function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('Invalid report worker configuration.');
  return parsed;
}
