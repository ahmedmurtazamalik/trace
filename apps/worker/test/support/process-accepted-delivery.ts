import { PrismaClient } from '@trace/database';
import { GithubWebhookWorker } from '../../src/queues/github/github-webhook.worker';
import { GithubPushProcessor } from '../../src/processors/github/github-push.processor';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (databaseUrl === undefined || redisUrl === undefined) throw new Error('Missing acceptance test configuration.');

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const processor = new GithubPushProcessor(prisma);
  const worker = new GithubWebhookWorker({
    redisUrl,
    queueName: 'github-webhook-deliveries',
    concurrency: 1,
    processDelivery: async (deliveryId) => processor.process(deliveryId),
    recordTerminalFailure: async (deliveryId, code) => {
      await prisma.githubWebhookDelivery.updateMany({
        where: { id: deliveryId, status: { notIn: ['completed', 'failed'] } },
        data: { status: 'failed', processedAt: new Date(), processingError: code },
      });
    },
  });

  try {
    await prisma.$connect();
    await worker.start();
    await worker.waitUntilIdle(10_000);
  } finally {
    await worker.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
