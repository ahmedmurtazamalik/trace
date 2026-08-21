import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { PrismaClient } from '@trace/database';
import type { Prisma } from '@trace/database';
import { Queue } from 'bullmq';
import { GithubWebhookWorker } from '../../../src/queues/github/github-webhook.worker';
import { GithubCommitApiEnricher } from '../../../src/processors/github/github-commit-api.enricher';
import { GithubPushProcessor } from '../../../src/processors/github/github-push.processor';
import type { GithubCommitEnricher } from '../../../src/processors/github/github-commit.enricher';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const describeIntegration = databaseUrl === undefined ? describe.skip : describe;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const appPrivateKey = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describeIntegration('GitHub push processor', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const userId = `worker-user-${suffix}`;
  const accountId = `worker-account-${suffix}`;
  const installationId = `worker-installation-${suffix}`;
  const repositoryId = `worker-repository-${suffix}`;
  const deliveryId = `worker-delivery-${suffix}`;
  const overlappingDeliveryId = `worker-overlap-${suffix}`;
  const queuedDeliveryId = `worker-queued-${suffix}`;
  const malformedDeliveryId = `worker-malformed-${suffix}`;
  const failedDeliveryId = `worker-failed-${suffix}`;
  const revokedDeliveryId = `worker-revoked-${suffix}`;
  const mismatchedAuthorityDeliveryId = `worker-authority-${suffix}`;
  const invalidPathDeliveryId = `worker-invalid-path-${suffix}`;
  const extendedOidDeliveryId = `worker-extended-oid-${suffix}`;
  const intermediateOidDeliveryId = `worker-intermediate-oid-${suffix}`;
  const malformedNestedDeliveryId = `worker-malformed-nested-${suffix}`;
  const payloadIdentityDeliveryIds = [
    `worker-payload-installation-${suffix}`,
    `worker-payload-repository-${suffix}`,
  ];
  const providerRepositoryMismatchDeliveryId = `worker-provider-repository-${suffix}`;
  const reassignedDeliveryId = `worker-reassigned-${suffix}`;
  const otherInstallationId = `worker-other-installation-${suffix}`;
  const reassignedInstallationId = `worker-reassigned-installation-${suffix}`;
  const githubDeliveryId = randomUUID();
  const senderGithubId = 8_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  const githubInstallationId = 7_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  const githubRepositoryId = 6_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  const sha = 'a'.repeat(40);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, username: `worker-${suffix}`.slice(0, 39), passwordHash: 'not-used' },
    });
    await prisma.githubAccount.create({
      data: {
        id: accountId,
        userId,
        githubUserId: senderGithubId,
        githubUsername: 'stable-sender',
      },
    });
    await prisma.githubInstallation.create({
      data: {
        id: installationId,
        githubInstallationId,
        githubAccountId: accountId,
        accountType: 'USER',
        accountLogin: 'stable-sender',
      },
    });
    await prisma.repository.create({
      data: {
        id: repositoryId,
        githubRepositoryId,
        githubInstallationId: installationId,
        owner: 'trace-test',
        name: 'processor',
        fullName: 'trace-test/processor',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({
      data: { userId, repositoryId, trackingEnabled: true },
    });
    await prisma.githubWebhookDelivery.create({
      data: {
        id: deliveryId,
        githubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'f'.repeat(64),
        publishedAt: new Date(),
        payload: {
          ref: 'refs/heads/main',
          before: 'b'.repeat(40),
          after: sha,
          installation: { id: Number(githubInstallationId) },
          repository: { id: Number(githubRepositoryId), full_name: 'trace-test/processor' },
          sender: { id: Number(senderGithubId), login: 'stable-sender' },
          commits: [{
            id: sha,
            tree_id: 'c'.repeat(40),
            distinct: true,
            message: 'Add processor coverage',
            timestamp: '2026-08-12T12:00:00.000Z',
            url: `https://github.com/trace-test/processor/commit/${sha}`,
            author: { name: 'Authored Name', email: 'author@example.test', username: null },
            committer: { name: 'Stable Sender', email: 'sender@example.test', username: 'stable-sender' },
            added: ['src/new.ts'],
            removed: ['src/old.ts'],
            modified: ['src/existing.ts'],
          }],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.activityEvent.deleteMany({ where: { repositoryId } });
    await prisma.pushEvent.deleteMany({ where: { repositoryId } });
    await prisma.commit.deleteMany({ where: { repositoryId } });
    await prisma.contributor.deleteMany({ where: { githubUserId: senderGithubId } });
    await prisma.githubWebhookDelivery.deleteMany({ where: { id: { in: [deliveryId, overlappingDeliveryId, queuedDeliveryId, malformedDeliveryId, failedDeliveryId, revokedDeliveryId, mismatchedAuthorityDeliveryId, invalidPathDeliveryId, extendedOidDeliveryId, ...[41, 42, 63].map((length) => `${intermediateOidDeliveryId}-${length}`), malformedNestedDeliveryId, ...payloadIdentityDeliveryIds, providerRepositoryMismatchDeliveryId, reassignedDeliveryId] } } });
    await prisma.userRepository.deleteMany({ where: { repositoryId } });
    await prisma.repository.deleteMany({ where: { id: repositoryId } });
    await prisma.githubInstallation.deleteMany({ where: { id: otherInstallationId } });
    await prisma.githubInstallation.deleteMany({ where: { id: reassignedInstallationId } });
    await prisma.githubInstallation.deleteMany({ where: { id: installationId } });
    await prisma.githubAccount.deleteMany({ where: { id: accountId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('persists one canonical push and commit activity across retries', async () => {
    const transactionSpy = jest.spyOn(prisma, '$transaction');
    const processor = new GithubPushProcessor(prisma);

    await processor.process(deliveryId);
    await processor.process(deliveryId);

    expect(transactionSpy).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
    transactionSpy.mockRestore();
    const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const pushes = await prisma.pushEvent.findMany({ where: { repositoryId } });
    const commits = await prisma.commit.findMany({ where: { repositoryId }, include: { files: { orderBy: { path: 'asc' } } } });
    const activities = await prisma.activityEvent.findMany({ where: { repositoryId }, orderBy: { sourceKey: 'asc' } });
    const sender = await prisma.contributor.findUniqueOrThrow({ where: { githubUserId: senderGithubId } });

    expect(delivery.status).toBe('completed');
    expect(delivery.processedAt).not.toBeNull();
    expect(delivery.processingError).toBeNull();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ githubDeliveryId, ref: 'refs/heads/main', senderContributorId: sender.id });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      sha,
      branch: 'main',
      authorName: 'Authored Name',
      authorEmail: 'author@example.test',
      authorUsername: null,
      authorContributorId: null,
      committerName: 'Stable Sender',
      committerEmail: 'sender@example.test',
      committerUsername: 'stable-sender',
      committerContributorId: null,
      changedFiles: 3,
    });
    expect(commits[0]?.files).toEqual([
      expect.objectContaining({ path: 'src/existing.ts', status: 'modified' }),
      expect.objectContaining({ path: 'src/new.ts', status: 'added' }),
      expect.objectContaining({ path: 'src/old.ts', status: 'removed' }),
    ]);
    expect(activities).toHaveLength(2);
    expect(activities.map(({ sourceKey, type }) => ({ sourceKey, type }))).toEqual([
      { sourceKey: `github:commit:${repositoryId}:${sha}`, type: 'commit' },
      { sourceKey: `github:push:${githubDeliveryId}`, type: 'push' },
    ]);
  });

  it('processes the 64-character Git object ID format accepted alongside 40-character IDs at ingress', async () => {
    const extendedSha = 'd'.repeat(64);
    await prisma.githubWebhookDelivery.create({
      data: {
        id: extendedOidDeliveryId,
        githubDeliveryId: randomUUID(),
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'd'.repeat(64),
        publishedAt: new Date(),
        payload: {
          ref: 'refs/heads/sha256-transition',
          before: 'e'.repeat(64),
          after: extendedSha,
          installation: { id: Number(githubInstallationId) },
          repository: { id: Number(githubRepositoryId), full_name: 'trace-test/processor' },
          sender: { id: Number(senderGithubId), login: 'stable-sender' },
          commits: [{
            id: extendedSha,
            tree_id: 'f'.repeat(64),
            distinct: true,
            message: 'Accept an extended Git object ID',
            timestamp: '2026-08-12T13:00:00.000Z',
            url: `https://github.com/trace-test/processor/commit/${extendedSha}`,
            author: { name: 'Authored Name', email: 'author@example.test', username: null },
            committer: { name: 'Stable Sender', email: 'sender@example.test', username: 'stable-sender' },
            added: [], removed: [], modified: ['src/oid.ts'],
          }],
        },
      },
    });

    await new GithubPushProcessor(prisma).process(extendedOidDeliveryId);

    await expect(prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: extendedOidDeliveryId } })).resolves.toMatchObject({ status: 'completed' });
    await expect(prisma.commit.findUnique({ where: { repositoryId_sha: { repositoryId, sha: extendedSha } } })).resolves.not.toBeNull();
  });

  it.each([41, 42, 63])('rejects a durable payload with an impossible %i-character Git object ID', async (length) => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const payload = source.payload as Record<string, unknown>;
    const githubId = randomUUID();
    await prisma.githubWebhookDelivery.create({
      data: {
        id: `${intermediateOidDeliveryId}-${length}`,
        githubDeliveryId: githubId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: '9'.repeat(64),
        publishedAt: new Date(),
        payload: { ...payload, after: 'a'.repeat(length) },
      },
    });

    await expect(new GithubPushProcessor(prisma).process(`${intermediateOidDeliveryId}-${length}`))
      .rejects.toThrow('Webhook delivery payload is unavailable for processing.');
    await expect(prisma.pushEvent.count({ where: { githubDeliveryId: githubId } })).resolves.toBe(0);
  });

  it('rejects malformed nested commit fields after durable storage', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const cases: Array<Record<string, unknown>> = [
      { tree_id: 'a'.repeat(41) },
      { tree_id: 'a'.repeat(42) },
      { tree_id: 'a'.repeat(63) },
      { distinct: 'true' },
      { url: 'javascript:alert(1)' },
      { url: 'not-a-url' },
    ];
    for (const mutation of cases) {
      const payload = structuredClone(source.payload) as { commits: Array<Record<string, unknown>> };
      Object.assign(payload.commits[0]!, mutation);
      const githubId = randomUUID();
      await prisma.githubWebhookDelivery.create({
        data: {
          id: malformedNestedDeliveryId,
          githubDeliveryId: githubId,
          eventName: 'push',
          githubInstallationId,
          githubRepositoryId,
          installationId,
          repositoryId,
          payloadHash: '8'.repeat(64),
          publishedAt: new Date(),
          payload: payload as Prisma.InputJsonValue,
        },
      });
      await expect(new GithubPushProcessor(prisma).process(malformedNestedDeliveryId))
        .rejects.toThrow('Webhook delivery payload is unavailable for processing.');
      await expect(prisma.pushEvent.count({ where: { githubDeliveryId: githubId } })).resolves.toBe(0);
      await prisma.githubWebhookDelivery.delete({ where: { id: malformedNestedDeliveryId } });
    }
  });

  it('reuses canonical commit activity across overlapping deliveries and enriches only once', async () => {
    const secondGithubDeliveryId = randomUUID();
    const first = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    await prisma.githubWebhookDelivery.create({
      data: {
        id: overlappingDeliveryId,
        githubDeliveryId: secondGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'e'.repeat(64),
        publishedAt: new Date(),
        payload: first.payload === null ? {} : first.payload,
      },
    });
    const authorGithubId = senderGithubId + 1n;
    const committerGithubId = senderGithubId + 2n;
    const enrichCommit = jest.fn().mockResolvedValue({
        authoredAt: new Date('2026-08-12T11:59:00.000Z'),
        committedAt: new Date('2026-08-12T12:00:00.000Z'),
        author: { githubUserId: authorGithubId, username: 'stable-author', displayName: 'Stable Author', avatarUrl: null },
        committer: { githubUserId: committerGithubId, username: 'stable-committer', displayName: null, avatarUrl: null },
        additions: 9,
        deletions: 2,
        files: [
          { path: 'src/new.ts', status: 'added', additions: 5, deletions: 0, previousPath: null },
          { path: 'src/old.ts', status: 'removed', additions: 0, deletions: 2, previousPath: null },
          { path: 'src/existing.ts', status: 'modified', additions: 4, deletions: 0, previousPath: null },
        ],
      });
    const enrich: GithubCommitEnricher = { commit: enrichCommit };
    await prisma.githubWebhookDelivery.update({ where: { id: deliveryId }, data: { status: 'pending', processedAt: null } });
    await prisma.activityEvent.deleteMany({ where: { repositoryId } });
    await prisma.pushEvent.deleteMany({ where: { repositoryId } });
    await prisma.commit.deleteMany({ where: { repositoryId } });
    const processor = new GithubPushProcessor(prisma, enrich);
    const blocker = new PrismaClient();
    let releaseLock = (): void => undefined;
    let markLocked = (): void => undefined;
    const locked = new Promise<void>((resolve) => { markLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blockingTransaction = blocker.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deliveryId}, 0))`;
      markLocked();
      await release;
    });
    await locked;
    const firstProcessing = processor.process(deliveryId);
    while (enrichCommit.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const secondProcessing = processor.process(overlappingDeliveryId);
    try {
      await secondProcessing;
    } finally {
      releaseLock();
    }
    await Promise.all([firstProcessing, blockingTransaction]);
    await blocker.$disconnect();

    expect(enrichCommit).toHaveBeenCalledTimes(1);
    expect(await prisma.pushEvent.count({ where: { repositoryId } })).toBe(2);
    expect(await prisma.commit.count({ where: { repositoryId } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { repositoryId, type: 'push' } })).toBe(2);
    expect(await prisma.activityEvent.count({ where: { repositoryId, type: 'commit' } })).toBe(1);
    const commit = await prisma.commit.findUniqueOrThrow({
      where: { repositoryId_sha: { repositoryId, sha } },
      include: { files: true },
    });
    expect(commit).toMatchObject({ additions: 9, deletions: 2, changedFiles: 3 });
    expect(commit.authorContributorId).not.toBeNull();
    expect(commit.committerContributorId).not.toBeNull();
    expect(commit.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/new.ts', additions: 5, deletions: 0 }),
      expect.objectContaining({ path: 'src/old.ts', additions: 0, deletions: 2 }),
    ]));
    await prisma.contributor.deleteMany({ where: { githubUserId: { in: [authorGithubId, committerGithubId] } } });
  });

  (redisUrl === undefined ? it.skip : it)('processes a durable push through the real queue and worker exactly once', async () => {
    const queueName = `github-activity-gate-${process.pid}-${randomUUID()}`;
    const queuedGithubDeliveryId = randomUUID();
    const queuedSha = 'd'.repeat(40);
    await prisma.githubWebhookDelivery.create({
      data: {
        id: queuedDeliveryId,
        githubDeliveryId: queuedGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'c'.repeat(64),
        publishedAt: new Date(),
        payload: {
          ref: 'refs/heads/feature/day-6',
          before: '0'.repeat(40),
          after: queuedSha,
          installation: { id: Number(githubInstallationId) },
          repository: { id: Number(githubRepositoryId), full_name: 'trace-test/processor' },
          sender: { id: Number(senderGithubId), login: 'stable-sender' },
          commits: [{
            id: queuedSha,
            tree_id: 'e'.repeat(40),
            distinct: true,
            message: 'Process through BullMQ',
            timestamp: '2026-08-12T13:00:00.000Z',
            url: `https://github.com/trace-test/processor/commit/${queuedSha}`,
            author: { name: 'Queue Author', email: 'queue-author@example.test', username: null },
            committer: { name: 'Queue Committer', email: 'queue-committer@example.test', username: null },
            added: ['src/queue.ts'],
            removed: [],
            modified: [],
          }],
        },
      },
    });
    const processor = new GithubPushProcessor(prisma);
    const worker = new GithubWebhookWorker({
      redisUrl: redisUrl as string,
      queueName,
      concurrency: 1,
      processDelivery: async (id) => processor.process(id),
      recordTerminalFailure: async (id, code) => {
        await prisma.githubWebhookDelivery.update({
          where: { id },
          data: { status: 'failed', processedAt: new Date(), processingError: code },
        });
      },
    });
    const queue = new Queue<{ deliveryId: string }>(queueName, { connection: { url: redisUrl as string } });
    try {
      await worker.start();
      await queue.add('process', { deliveryId: queuedDeliveryId }, {
        jobId: `github-webhook-${queuedDeliveryId}`,
        attempts: 5,
      });
      await worker.waitUntilIdle(5_000);

      const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: queuedDeliveryId } });
      expect(delivery.status).toBe('completed');
      expect(await prisma.pushEvent.count({ where: { githubDeliveryId: queuedGithubDeliveryId } })).toBe(1);
      expect(await prisma.commit.count({ where: { repositoryId, sha: queuedSha } })).toBe(1);
      expect(await prisma.activityEvent.count({
        where: { sourceKey: { in: [`github:push:${queuedGithubDeliveryId}`, `github:commit:${repositoryId}:${queuedSha}`] } },
      })).toBe(2);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('rolls back canonical activity when the durable payload is malformed', async () => {
    const malformedGithubDeliveryId = randomUUID();
    await prisma.githubWebhookDelivery.create({
      data: {
        id: malformedDeliveryId,
        githubDeliveryId: malformedGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'b'.repeat(64),
        publishedAt: new Date(),
        payload: { ref: 'refs/heads/main', commits: 'not-an-array' },
      },
    });
    const processor = new GithubPushProcessor(prisma);

    await expect(processor.process(malformedDeliveryId)).rejects.toThrow('Webhook delivery payload is unavailable for processing.');

    const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: malformedDeliveryId } });
    expect(delivery.status).toBe('pending');
    expect(await prisma.pushEvent.count({ where: { githubDeliveryId: malformedGithubDeliveryId } })).toBe(0);
    expect(await prisma.activityEvent.count({ where: { sourceKey: `github:push:${malformedGithubDeliveryId}` } })).toBe(0);
  });

  it('never reprocesses a terminally failed delivery', async () => {
    const failedGithubDeliveryId = randomUUID();
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    await prisma.githubWebhookDelivery.create({
      data: {
        id: failedDeliveryId,
        githubDeliveryId: failedGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: 'a'.repeat(64),
        publishedAt: new Date(),
        status: 'failed',
        processedAt: new Date(),
        processingError: 'WEBHOOK_PROCESSING_FAILED',
        payload: source.payload === null ? {} : source.payload,
      },
    });
    const enrichCommit = jest.fn().mockRejectedValue(new Error('must not run'));
    const processor = new GithubPushProcessor(prisma, { commit: enrichCommit });

    await processor.process(failedDeliveryId);

    expect(enrichCommit).not.toHaveBeenCalled();
    const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: failedDeliveryId } });
    expect(delivery).toMatchObject({ status: 'failed', processingError: 'WEBHOOK_PROCESSING_FAILED' });
    expect(await prisma.pushEvent.count({ where: { githubDeliveryId: failedGithubDeliveryId } })).toBe(0);
    expect(await prisma.activityEvent.count({ where: { sourceKey: `github:push:${failedGithubDeliveryId}` } })).toBe(0);
  });

  it('terminally rejects queued work after tracking authority is revoked', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const revokedGithubDeliveryId = randomUUID();
    await prisma.githubWebhookDelivery.create({
      data: {
        id: revokedDeliveryId,
        githubDeliveryId: revokedGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: '7'.repeat(64),
        publishedAt: new Date(),
        payload: source.payload === null ? {} : source.payload,
      },
    });
    await prisma.userRepository.updateMany({ where: { repositoryId }, data: { trackingEnabled: false } });
    const enrichCommit = jest.fn().mockRejectedValue(new Error('must not run'));

    try {
      await new GithubPushProcessor(prisma, { commit: enrichCommit }).process(revokedDeliveryId);
      expect(enrichCommit).not.toHaveBeenCalled();
      await expect(prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: revokedDeliveryId } })).resolves.toMatchObject({
        status: 'failed',
        processingError: 'Webhook authority is unavailable.',
      });
      expect(await prisma.pushEvent.count({ where: { githubDeliveryId: revokedGithubDeliveryId } })).toBe(0);
    } finally {
      await prisma.userRepository.updateMany({ where: { repositoryId }, data: { trackingEnabled: true } });
    }
  });

  it('binds durable payload installation and repository identities before enrichment', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const cases = [
      { field: 'installation', id: payloadIdentityDeliveryIds[0]!, value: Number(githubInstallationId + 100n) },
      { field: 'repository', id: payloadIdentityDeliveryIds[1]!, value: Number(githubRepositoryId + 100n) },
    ];

    for (const item of cases) {
      const payload = structuredClone(source.payload) as Record<string, unknown>;
      const identity = payload[item.field] as Record<string, unknown>;
      identity.id = item.value;
      const githubDeliveryId = randomUUID();
      await prisma.githubWebhookDelivery.create({
        data: {
          id: item.id,
          githubDeliveryId,
          eventName: 'push',
          githubInstallationId,
          githubRepositoryId,
          installationId,
          repositoryId,
          payloadHash: '7'.repeat(64),
          publishedAt: new Date(),
          payload: payload as Prisma.InputJsonValue,
        },
      });
      const enrichCommit = jest.fn().mockRejectedValue(new Error('must not run'));

      await expect(new GithubPushProcessor(prisma, { commit: enrichCommit }).process(item.id))
        .rejects.toThrow('Webhook delivery authority does not match its payload.');
      expect(enrichCommit).not.toHaveBeenCalled();
      await expect(prisma.pushEvent.count({ where: { githubDeliveryId } })).resolves.toBe(0);
    }
  });

  it('rejects a provider repository ID mismatch without requesting or persisting commit facts', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const payload = structuredClone(source.payload) as Record<string, unknown>;
    const sha = '4'.repeat(40);
    payload.after = sha;
    const commits = payload.commits as Array<Record<string, unknown>>;
    commits[0] = { ...commits[0], id: sha, tree_id: '5'.repeat(40) };
    const githubDeliveryId = randomUUID();
    await prisma.githubWebhookDelivery.create({
      data: {
        id: providerRepositoryMismatchDeliveryId,
        githubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: '6'.repeat(64),
        publishedAt: new Date(),
        payload: payload as Prisma.InputJsonValue,
      },
    });
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'installation-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: Number(githubRepositoryId + 1n), owner: { login: 'unrelated-org' }, name: 'unrelated-repository',
      }), { status: 200 }));
    const enricher = new GithubCommitApiEnricher({
      appId: '123', privateKey: appPrivateKey, request, timeoutMs: 1_000,
    });

    await expect(new GithubPushProcessor(prisma, enricher).process(providerRepositoryMismatchDeliveryId))
      .rejects.toThrow('GitHub commit enrichment failed.');

    expect(request).toHaveBeenCalledTimes(2);
    await expect(prisma.pushEvent.count({ where: { githubDeliveryId } })).resolves.toBe(0);
    await expect(prisma.commit.count({ where: { repositoryId, sha } })).resolves.toBe(0);
  });

  it('rejects a delivery whose internal installation does not own its repository before enrichment', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    await prisma.githubInstallation.create({
      data: {
        id: otherInstallationId,
        githubInstallationId: githubInstallationId + 1n,
        githubAccountId: accountId,
        accountType: 'USER',
        accountLogin: 'other-installation',
      },
    });
    await prisma.githubWebhookDelivery.create({
      data: {
        id: mismatchedAuthorityDeliveryId,
        githubDeliveryId: randomUUID(),
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId: otherInstallationId,
        repositoryId,
        payloadHash: '9'.repeat(64),
        publishedAt: new Date(),
        payload: source.payload === null ? {} : source.payload,
      },
    });
    const enrichCommit = jest.fn().mockRejectedValue(new Error('must not run'));

    await expect(new GithubPushProcessor(prisma, { commit: enrichCommit }).process(mismatchedAuthorityDeliveryId))
      .rejects.toThrow('Webhook delivery authority does not match its repository.');

    expect(enrichCommit).not.toHaveBeenCalled();
    expect(await prisma.pushEvent.count({ where: { githubDeliveryId: source.githubDeliveryId } })).toBeLessThanOrEqual(1);
  });

  it('rejects non-repository-relative webhook file paths before persistence', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const payload = structuredClone(source.payload) as Record<string, unknown>;
    const commits = payload.commits as Array<Record<string, unknown>>;
    commits[0] = { ...commits[0], added: ['../escape.ts'] };
    const invalidGithubDeliveryId = randomUUID();
    await prisma.githubWebhookDelivery.create({
      data: {
        id: invalidPathDeliveryId,
        githubDeliveryId: invalidGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: '8'.repeat(64),
        publishedAt: new Date(),
        payload: payload as never,
      },
    });

    await expect(new GithubPushProcessor(prisma).process(invalidPathDeliveryId))
      .rejects.toThrow('Webhook delivery payload is unavailable for processing.');

    expect(await prisma.pushEvent.count({ where: { githubDeliveryId: invalidGithubDeliveryId } })).toBe(0);
    expect(await prisma.commitFile.count({ where: { path: '../escape.ts' } })).toBe(0);
  });

  it('waits for repository reassignment and rejects stale installation authority', async () => {
    const source = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const reassignedGithubDeliveryId = randomUUID();
    const reassignedSha = '6'.repeat(40);
    const payload = structuredClone(source.payload) as Record<string, unknown>;
    payload.after = reassignedSha;
    const commits = payload.commits as Array<Record<string, unknown>>;
    commits[0] = { ...commits[0], id: reassignedSha, tree_id: '7'.repeat(40) };
    await prisma.githubInstallation.create({
      data: {
        id: reassignedInstallationId,
        githubInstallationId: githubInstallationId + 2n,
        githubAccountId: accountId,
        accountType: 'USER',
        accountLogin: 'reassigned-installation',
      },
    });
    await prisma.githubWebhookDelivery.create({
      data: {
        id: reassignedDeliveryId,
        githubDeliveryId: reassignedGithubDeliveryId,
        eventName: 'push',
        githubInstallationId,
        githubRepositoryId,
        installationId,
        repositoryId,
        payloadHash: '7'.repeat(64),
        publishedAt: new Date(),
        payload: payload as never,
      },
    });

    const synchronizer = new PrismaClient();
    let reassignmentLocked!: () => void;
    const locked = new Promise<void>((resolve) => { reassignmentLocked = resolve; });
    let releaseReassignment!: () => void;
    const release = new Promise<void>((resolve) => { releaseReassignment = resolve; });
    const reassignment = synchronizer.$transaction(async (transaction) => {
      await transaction.repository.update({
        where: { id: repositoryId },
        data: { githubInstallationId: reassignedInstallationId },
      });
      reassignmentLocked();
      await release;
    });
    await locked;

    let processingSettled = false;
    const processing = new GithubPushProcessor(prisma).process(reassignedDeliveryId).finally(() => {
      processingSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      expect(processingSettled).toBe(false);
      releaseReassignment();
      await processing;
      const rejectedDelivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: reassignedDeliveryId } });
      expect(rejectedDelivery).toMatchObject({
        status: 'failed',
        processingError: 'Webhook authority is unavailable.',
      });
      expect(rejectedDelivery.processedAt).toBeInstanceOf(Date);
      expect(await prisma.pushEvent.count({ where: { githubDeliveryId: reassignedGithubDeliveryId } })).toBe(0);
      expect(await prisma.commit.count({ where: { repositoryId, sha: reassignedSha } })).toBe(0);
    } finally {
      releaseReassignment();
      await processing.catch(() => undefined);
      await reassignment;
      await synchronizer.$disconnect();
      await prisma.repository.update({ where: { id: repositoryId }, data: { githubInstallationId: installationId } });
    }
  });
});
