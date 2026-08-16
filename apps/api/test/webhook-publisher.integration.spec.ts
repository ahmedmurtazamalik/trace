import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient, type PrismaService } from '@trace/database';
import { GithubWebhookPublisher } from '../src/modules/webhooks/github-webhook.publisher';

const username = 'publisher.fairness.user';
const githubUserId = 9_100_001n;
const githubInstallationId = 9_200_001n;
const githubRepositoryId = 9_300_001n;

describe('GitHub webhook publisher fairness', () => {
  const admin = new PrismaClient();
  const schema = `webhook_publisher_${randomUUID().replaceAll('-', '')}`;
  let prisma: PrismaClient;
  let installationId: string;
  let repositoryId: string;

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const databaseUrl = new URL(process.env.DATABASE_URL as string);
    databaseUrl.searchParams.set('schema', schema);
    prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
    await prisma.$connect();
    const migrationsRoot = path.resolve(__dirname, '../../../packages/database/prisma/migrations');
    for (const migration of (await readdir(migrationsRoot)).filter((name) => /^\d/.test(name)).sort()) {
      const sql = (await readFile(path.join(migrationsRoot, migration, 'migration.sql'), 'utf8'))
        .replaceAll('"public".', `"${schema}".`);
      await executeMigration(prisma, sql);
    }
    const user = await prisma.user.create({
      data: { username, email: 'publisher.fairness@example.test', passwordHash: 'test-only-not-authenticated' },
    });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId, githubUsername: 'publisher-fairness' },
    });
    const installation = await prisma.githubInstallation.create({
      data: {
        githubInstallationId,
        githubAccountId: account.id,
        accountType: 'ORGANIZATION',
        accountLogin: 'publisher-fairness-org',
      },
    });
    installationId = installation.id;
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId,
        githubInstallationId: installation.id,
        owner: 'publisher-fairness-org',
        name: 'publisher-fairness',
        fullName: 'publisher-fairness-org/publisher-fairness',
        private: true,
        defaultBranch: 'main',
      },
    });
    repositoryId = repository.id;
    await prisma.userRepository.create({
      data: { userId: user.id, repositoryId: repository.id, trackingEnabled: true },
    });
  });

  afterAll(async () => {
    try {
      if (prisma !== undefined) await prisma.$disconnect();
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });

  it('bounds a full hanging publication batch so a later healthy delivery is attempted on the next pass', async () => {
    const start = Date.UTC(2000, 0, 1);
    const poisonIds = Array.from({ length: 100 }, (_value, index) => `poison-publication-${index}-${randomUUID()}`);
    const healthyId = `healthy-publication-${randomUUID()}`;
    await prisma.githubWebhookDelivery.createMany({
      data: [
        ...poisonIds.map((id, index) => ({
          id,
          githubDeliveryId: randomUUID(),
          eventName: 'push',
          githubInstallationId,
          githubRepositoryId,
          installationId,
          repositoryId,
          payloadHash: 'd'.repeat(64),
          payload: {},
          receivedAt: new Date(start + index),
        })),
        {
          id: healthyId,
          githubDeliveryId: randomUUID(),
          eventName: 'push',
          githubInstallationId,
          githubRepositoryId,
          installationId,
          repositoryId,
          payloadHash: 'e'.repeat(64),
          payload: {},
          receivedAt: new Date(start + 100),
        },
      ],
    });
    const poison = new Set(poisonIds);
    let hung = false;
    const enqueue = jest.fn((id: string) => {
      if (!poison.has(id)) return Promise.resolve();
      if (!hung) {
        hung = true;
        return new Promise<void>(() => undefined);
      }
      return Promise.reject(new Error('row-specific publication failure'));
    });
    const publisher = new GithubWebhookPublisher(prisma as unknown as PrismaService, { enqueue } as never);

    await publisher.publishOwed();
    expect(enqueue).toHaveBeenCalledTimes(100);
    expect(enqueue).not.toHaveBeenCalledWith(healthyId);
    expect(await prisma.githubWebhookDelivery.count({
      where: { id: { in: poisonIds }, publishedAt: { not: null } },
    })).toBe(100);
    await expect(prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: healthyId } }))
      .resolves.toMatchObject({ status: 'pending', publishedAt: null });

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await publisher.publishOwed();
    expect(enqueue).toHaveBeenCalledWith(healthyId, expect.any(AbortSignal));
    await expect(prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: healthyId } }))
      .resolves.toMatchObject({ status: 'pending' });
  }, 10_000);

  it('aborts a timed-out retry before revocation releases a delayed queue operation', async () => {
    const deliveryId = `late-retry-${randomUUID()}`;
    await prisma.githubWebhookDelivery.create({
      data: {
        id: deliveryId,
        githubDeliveryId: randomUUID(),
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'f'.repeat(64),
        payload: {},
      },
    });
    let queueStarted!: () => void;
    const started = new Promise<void>((resolve) => { queueStarted = resolve; });
    let releaseQueue!: () => void;
    const release = new Promise<void>((resolve) => { releaseQueue = resolve; });
    let retried = false;
    const enqueue = jest.fn(async (_id: string, signal?: AbortSignal) => {
      queueStarted();
      await Promise.race([
        release,
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('publication aborted')), { once: true });
        }),
      ]);
      if (signal?.aborted !== true) retried = true;
    });
    const publisher = new GithubWebhookPublisher(prisma as unknown as PrismaService, { enqueue } as never);

    const publishing = publisher.publishOwed();
    await started;
    await publishing;
    await prisma.githubInstallation.update({ where: { id: installationId }, data: { suspendedAt: new Date() } });
    releaseQueue();
    await new Promise((resolve) => setImmediate(resolve));

    expect(retried).toBe(false);
    await prisma.githubInstallation.update({ where: { id: installationId }, data: { suspendedAt: null } });
  }, 10_000);

  it('waits for in-flight reconciliation during module destruction', async () => {
    let finish: (() => void) | undefined;
    const reconciliation = new Promise<void>((resolve) => { finish = resolve; });
    const publisher = new GithubWebhookPublisher(prisma as unknown as PrismaService, { enqueue: jest.fn() } as never);
    (publisher as unknown as { reconciliation: Promise<void> | undefined }).reconciliation = reconciliation;
    let destroyed = false;

    const destruction = publisher.onModuleDestroy().then(() => { destroyed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(destroyed).toBe(false);
    finish?.();
    await destruction;
    expect(destroyed).toBe(true);
  });
});

async function executeMigration(client: PrismaClient, sql: string): Promise<void> {
  const statements: string[] = [];
  let statement = '';
  let inDollarQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql.slice(index, index + 2) === '$$') {
      inDollarQuote = !inDollarQuote;
      statement += '$$';
      index += 1;
    } else if (sql[index] === ';' && !inDollarQuote) {
      if (statement.trim().length > 0) statements.push(statement.trim());
      statement = '';
    } else {
      statement += sql[index];
    }
  }
  if (statement.trim().length > 0) statements.push(statement.trim());
  for (const migrationStatement of statements) await client.$executeRawUnsafe(migrationStatement);
}
