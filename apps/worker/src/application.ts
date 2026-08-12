import { PrismaClient } from '@trace/database';
import { GithubCommitApiEnricher } from './processors/github/github-commit-api.enricher';
import type { GithubCommitEnricher } from './processors/github/github-commit.enricher';
import { GithubPushProcessor } from './processors/github/github-push.processor';
import { runGithubWebhookWorker } from './runtime';

interface ActivityProcessor {
  process(deliveryId: string): Promise<void>;
}

interface ApplicationOptions {
  environment: NodeJS.ProcessEnv;
  signals?: NodeJS.Process;
  prisma?: PrismaClient;
  enricher?: GithubCommitEnricher;
  processor?: ActivityProcessor;
  runWorker?: typeof runGithubWebhookWorker;
  resourceCleanupTimeoutMs?: number;
}

export async function startGithubActivityWorker(options: ApplicationOptions): Promise<() => Promise<void>> {
  const configuration = workerConfiguration(options.environment);
  const prisma = options.prisma ?? new PrismaClient({ datasourceUrl: configuration.databaseUrl });
  const enricher = options.enricher ?? new GithubCommitApiEnricher({
    appId: configuration.appId,
    privateKey: configuration.privateKey,
  });
  const processor = options.processor ?? new GithubPushProcessor(prisma, enricher);
  const runWorker = options.runWorker ?? runGithubWebhookWorker;
  const resourceCleanupTimeoutMs = options.resourceCleanupTimeoutMs ?? 10_000;
  try {
    await prisma.$connect();
    return await runWorker({
      environment: options.environment,
      signals: options.signals,
      processDelivery: async (deliveryId) => processor.process(deliveryId),
      recordTerminalFailure: async (deliveryId, code) => {
        await prisma.githubWebhookDelivery.updateMany({
          where: { id: deliveryId, status: { notIn: ['completed', 'failed'] } },
          data: { status: 'failed', processedAt: new Date(), processingError: code },
        });
      },
      closeResources: async () => prisma.$disconnect(),
      resourceCleanupTimeoutMs,
    });
  } catch {
    await withTimeout(prisma.$disconnect(), resourceCleanupTimeoutMs).catch(() => undefined);
    throw new Error('GitHub activity worker startup failed.');
  }
}

async function withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Application resource cleanup timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function workerConfiguration(environment: NodeJS.ProcessEnv): {
  databaseUrl: string;
  appId: string;
  privateKey: string;
} {
  const databaseUrl = environment.DATABASE_URL;
  const appId = environment.GITHUB_APP_ID;
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (
    databaseUrl === undefined || !databaseUrl.startsWith('postgresql://')
    || appId === undefined || appId.length === 0
    || privateKey === undefined || privateKey.length === 0
  ) {
    throw new Error('Invalid activity worker configuration.');
  }
  return { databaseUrl, appId, privateKey };
}
