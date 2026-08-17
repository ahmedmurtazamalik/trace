import { PrismaClient } from '@trace/database';
import { GithubWebhookWorker } from '../../src/queues/github/github-webhook.worker';
import { GithubPushProcessor } from '../../src/processors/github/github-push.processor';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (databaseUrl === undefined || redisUrl === undefined) throw new Error('Missing acceptance test configuration.');

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const processor = new GithubPushProcessor(prisma);
  let lastProcessorError: string | undefined;
  const worker = new GithubWebhookWorker({
    redisUrl,
    queueName: 'github-webhook-deliveries',
    concurrency: 1,
    processDelivery: async (deliveryId) => {
      try {
        await processor.process(deliveryId);
      } catch (error) {
        lastProcessorError = error instanceof Error ? error.message : 'Webhook processor failed.';
        throw error;
      }
    },
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
    try {
      await worker.waitUntilIdle(10_000);
    } catch (error) {
      const queue = new (await import('bullmq')).Queue('github-webhook-deliveries', { connection: { url: redisUrl } });
      try {
        const counts = await queue.getJobCounts();
        const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'failed']);
        const reasons = jobs.map((job) => job.failedReason).filter((reason): reason is string => typeof reason === 'string');
        const references = await Promise.all(jobs.map(async (job) => ({ id: job.id, state: await job.getState(), data: job.data as unknown })));
        throw new Error(`${error instanceof Error ? error.message : 'Webhook worker timed out.'} counts=${JSON.stringify(counts)} reasons=${JSON.stringify(reasons)} references=${JSON.stringify(references)} processor=${JSON.stringify(lastProcessorError)}`);
      } finally {
        await queue.close();
      }
    }
  } finally {
    await worker.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Acceptance worker failed.');
  process.exitCode = 1;
});
