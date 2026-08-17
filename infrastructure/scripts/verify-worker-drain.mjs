import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { Queue } = require('bullmq');
const { GithubWebhookWorker } = require('../dist/src/queues/github/github-webhook.worker.js');
const { ReportQueueWorker } = require('../dist/src/queues/reports/report.worker.js');

const redisUrl = process.env.REDIS_URL;
if (typeof redisUrl !== 'string' || !/^rediss?:\/\//.test(redisUrl)) {
  throw new Error('REDIS_URL is required for worker drain verification.');
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withTimeout(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function verifyDrain(kind) {
  const queueName = `trace-day13-${kind}-${process.pid}-${randomUUID()}`;
  const queue = new Queue(queueName, { connection: { url: redisUrl } });
  const started = deferred();
  const release = deferred();
  let completed = 0;
  const common = {
    redisUrl,
    queueName,
    concurrency: 1,
    shutdownTimeoutMs: 10_000,
  };
  const worker = kind === 'webhook'
    ? new GithubWebhookWorker({
      ...common,
      processDelivery: async () => { started.resolve(); await release.promise; completed += 1; },
      recordTerminalFailure: async () => undefined,
    })
    : new ReportQueueWorker({
      ...common,
      processReport: async () => { started.resolve(); await release.promise; completed += 1; },
    });

  try {
    await worker.start();
    const job = kind === 'webhook'
      ? ['process-delivery', { deliveryId: 'drain-delivery' }]
      : ['generate-report', { reportId: 'drain-report' }];
    await queue.add(job[0], job[1], { removeOnComplete: true });
    await withTimeout(started.promise, 5_000, `${kind} job did not become active.`);
    const stopStartedAt = Date.now();
    setTimeout(() => release.resolve(), 300);
    await withTimeout(worker.close(), 5_000, `${kind} worker did not drain.`);
    const elapsedMs = Date.now() - stopStartedAt;
    const counts = await queue.getJobCounts('active', 'waiting', 'delayed', 'prioritized', 'failed');
    if (completed !== 1 || elapsedMs < 250 || Object.values(counts).some((count) => count !== 0)) {
      throw new Error(`${kind} worker did not complete an active drain.`);
    }
    return { kind, elapsedMs, completed };
  } finally {
    release.resolve();
    await worker.close().catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
}

const results = [await verifyDrain('webhook'), await verifyDrain('report')];
process.stdout.write(`${JSON.stringify({ event: 'worker.active-drain.verified', results })}\n`);
