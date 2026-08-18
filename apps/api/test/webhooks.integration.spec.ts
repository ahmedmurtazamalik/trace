import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { Queue } from 'bullmq';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';
import { GithubWebhookPublisher } from '../src/modules/webhooks/github-webhook.publisher';

const webhookSecret = 'day5-test-webhook-secret';
const deliveryId = '11111111-2222-4333-8444-555555555555';
const username = 'day5.webhook.user';
const execFileAsync = promisify(execFile);

function signature(payload: string): string {
  return `sha256=${createHmac('sha256', webhookSecret).update(payload).digest('hex')}`;
}

describe('GitHub webhook acceptance', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let queue: Queue<{ deliveryId: string }>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'postgresql://trace:trace_dev_password@localhost:5432/trace?schema=public';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;
    app = await createApplication();
    jest.spyOn(app.get(GithubWebhookPublisher), 'onApplicationBootstrap').mockImplementation(() => undefined);
    await app.init();
    await app.get(GithubWebhookPublisher).publishOwed();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    queue = new Queue('github-webhook-deliveries', { connection: { url: process.env.REDIS_URL } });
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await queue.close();
      await app.close();
    }
  });

  async function cleanup(): Promise<void> {
    await queue.obliterate({ force: true });
    const fixtureRepositories = await prisma.repository.findMany({
      where: { githubRepositoryId: 830_001n },
      select: { id: true },
    });
    const repositoryIds = fixtureRepositories.map(({ id }) => id);
    await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
    await prisma.pushEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
    await prisma.commit.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
    await prisma.githubWebhookDelivery.deleteMany({
      where: {
        OR: [
          { githubDeliveryId: deliveryId },
          { githubInstallationId: 820_001n },
          { githubRepositoryId: 830_001n },
          { repositoryId: { in: repositoryIds } },
        ],
      },
    });
    const user = await prisma.user.findUnique({
      where: { username },
      include: { githubAccount: { include: { installations: true } } },
    });
    if (user?.githubAccount !== null && user?.githubAccount !== undefined) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.pushEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.commit.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.githubWebhookDelivery.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.userRepository.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        try {
          await prisma.repository.deleteMany({ where: { id: { in: repositoryIds } } });
          break;
        } catch (error) {
          if (attempt === 19) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
    }
    await prisma.user.deleteMany({ where: { username } });
  }

  function fixtureDeliveryCount(): Promise<number> {
    return prisma.githubWebhookDelivery.count({
      where: {
        OR: [
          { githubDeliveryId: deliveryId },
          { githubInstallationId: 820_001n },
          { githubRepositoryId: 830_001n },
        ],
      },
    });
  }

  async function trackedRepository(): Promise<void> {
    const user = await prisma.user.create({
      data: { username, email: 'day5.webhook@example.test', passwordHash: 'test-only-not-authenticated' },
    });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId: 810_001n, githubUsername: 'day5-webhook-user' },
    });
    const installation = await prisma.githubInstallation.create({
      data: {
        githubInstallationId: 820_001n,
        githubAccountId: account.id,
        accountType: 'ORGANIZATION',
        accountLogin: 'day5-webhook-org',
      },
    });
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId: 830_001n,
        githubInstallationId: installation.id,
        owner: 'day5-webhook-org',
        name: 'tracked',
        fullName: 'day5-webhook-org/tracked',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({
      data: { userId: user.id, repositoryId: repository.id, trackingEnabled: true },
    });
  }

  function pushPayload(): string {
    return JSON.stringify({
      ref: 'refs/heads/main',
      before: '0'.repeat(40),
      after: '1'.repeat(40),
      installation: { id: 820_001 },
      repository: { id: 830_001, full_name: 'day5-webhook-org/tracked' },
      sender: { id: 840_001, login: 'octocat' },
      commits: [],
    });
  }

  function postPush(payload: string): request.Test {
    return request(server)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', deliveryId)
      .set('X-Hub-Signature-256', signature(payload))
      .send(payload);
  }

  it('durably accepts one signed push for an actively tracked repository', async () => {
    await trackedRepository();
    const payload = pushPayload();

    await postPush(payload).expect(202, { accepted: true });

    const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { githubDeliveryId: deliveryId } });
    const persistedPayload = await prisma.$queryRaw<Array<{ payload: unknown }>>`
      SELECT payload FROM github_webhook_deliveries WHERE id = ${delivery.id}
    `;
    expect(persistedPayload[0]?.payload).toEqual(JSON.parse(payload));
    expect(delivery).toMatchObject({
      eventName: 'push',
      githubInstallationId: 820_001n,
      githubRepositoryId: 830_001n,
      status: 'pending',
    });
    const jobs = await queue.getJobs(['wait', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: `github-webhook-${delivery.id}`,
      name: 'process-github-webhook',
      data: { deliveryId: delivery.id },
      opts: { attempts: 5 },
    });
  });

  it('creates canonical activity exactly once from an accepted 64-character Git OID through Redis and the worker', async () => {
    await trackedRepository();
    const sha = '4'.repeat(64);
    const payload = JSON.stringify({
      ...JSON.parse(pushPayload()) as object,
      after: sha,
      commits: [{
        id: sha,
        tree_id: '5'.repeat(64),
        distinct: true,
        message: 'Signed Day 6 gate',
        timestamp: '2026-08-12T14:00:00.000Z',
        url: `https://github.com/day5-webhook-org/tracked/commit/${sha}`,
        author: { name: 'Webhook Author', email: 'author@example.test', username: null },
        committer: { name: 'Webhook Committer', email: 'committer@example.test', username: null },
        added: ['src/day-6.ts'],
        removed: [],
        modified: [],
      }],
    });

    await postPush(payload).expect(202, { accepted: true });
    await postPush(payload).expect(202, { accepted: true });
    await execFileAsync('corepack', [
      'pnpm', 'exec', 'tsx', 'apps/worker/test/support/process-accepted-delivery.ts',
    ], {
      cwd: '../..',
      env: process.env,
      timeout: 20_000,
    });

    const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { githubDeliveryId: deliveryId } });
    expect(delivery.status).toBe('completed');
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 830_001n } });
    expect(await prisma.pushEvent.count({ where: { githubDeliveryId: deliveryId } })).toBe(1);
    expect(await prisma.commit.count({ where: { repositoryId: repository.id, sha } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: {
      sourceKey: { in: [`github:push:${deliveryId}`, `github:commit:${repository.id}:${sha}`] },
    } })).toBe(2);
  }, 30_000);

  it.each([41, 42, 63])('rejects a signed push with an impossible %i-character Git object ID', async (length) => {
    await trackedRepository();
    const payload = JSON.stringify({
      ...JSON.parse(pushPayload()) as object,
      after: 'a'.repeat(length),
    });

    await postPush(payload).expect(400);
    await expect(fixtureDeliveryCount()).resolves.toBe(0);
    await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, delayed: 0, active: 0 });
  });

  it('acknowledges a duplicate delivery without duplicating its row or queue job', async () => {
    await trackedRepository();
    const payload = pushPayload();

    const [first, second] = await Promise.all([postPush(payload), postPush(payload)]);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ accepted: true });
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ accepted: true });

    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(1);
    const jobs = await queue.getJobs(['wait', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
  });

  it('rejects conflicting reuse of a delivery ID without replacing the accepted payload', async () => {
    await trackedRepository();
    const original = pushPayload();
    const conflicting = JSON.stringify({ ...JSON.parse(original) as object, after: '2'.repeat(40) });

    await postPush(original).expect(202, { accepted: true });
    await postPush(conflicting).expect(409);

    const persisted = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { githubDeliveryId: deliveryId } });
    expect(persisted.payload).toEqual(JSON.parse(original));
    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(1);
  });

  it('serializes simultaneous conflicting reuse of a delivery ID', async () => {
    await trackedRepository();
    const firstPayload = pushPayload();
    const secondPayload = JSON.stringify({ ...JSON.parse(firstPayload) as object, after: '3'.repeat(40) });

    const responses = await Promise.all([postPush(firstPayload), postPush(secondPayload)]);
    expect(responses.map(({ status }) => status).sort()).toEqual([202, 409]);
    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(1);
    const jobs = await queue.getJobs(['wait', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
  });

  it('acknowledges a wholly untracked push without persisting or queueing it', async () => {
    await trackedRepository();
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 830_001n } });
    await prisma.userRepository.updateMany({
      where: { repositoryId: repository.id },
      data: { trackingEnabled: false },
    });

    await postPush(pushPayload()).expect(202, { accepted: false, reason: 'untracked' });

    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(0);
    await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, delayed: 0, active: 0 });
  });

  it('rejects an invalid signature without persisting or queueing the delivery', async () => {
    await trackedRepository();
    await request(server)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', deliveryId)
      .set('X-Hub-Signature-256', `sha256=${'0'.repeat(64)}`)
      .send(pushPayload())
      .expect(401);

    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(0);
    await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, delayed: 0, active: 0 });
  });

  it.each([
    'not-a-delivery-id',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  ])('rejects noncanonical GitHub delivery ID %s before persistence or queueing', async (invalidDeliveryId) => {
    await trackedRepository();
    const payload = pushPayload();
    await request(server)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', invalidDeliveryId)
      .set('X-Hub-Signature-256', signature(payload))
      .send(payload)
      .expect(400);

    await expect(fixtureDeliveryCount()).resolves.toBe(0);
    await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, delayed: 0, active: 0 });
  });

  it('does not re-enqueue a delivery that already left pending state', async () => {
    await trackedRepository();
    const payload = pushPayload();
    await postPush(payload).expect(202, { accepted: true });
    await queue.obliterate({ force: true });
    await prisma.githubWebhookDelivery.update({
      where: { githubDeliveryId: deliveryId },
      data: { status: 'completed', processedAt: new Date() },
    });

    await postPush(payload).expect(202, { accepted: true });
    const jobs = await queue.getJobs(['wait', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(0);
  });

  it('terminally rejects an owed accepted delivery after authority is revoked', async () => {
    await trackedRepository();
    const payload = JSON.parse(pushPayload()) as object;
    const installation = await prisma.githubInstallation.findUniqueOrThrow({ where: { githubInstallationId: 820_001n } });
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 830_001n } });
    const delivery = await prisma.githubWebhookDelivery.create({
      data: {
        githubDeliveryId: deliveryId,
        eventName: 'push',
        githubInstallationId: 820_001n,
        githubRepositoryId: 830_001n,
        installationId: installation.id,
        repositoryId: repository.id,
        payloadHash: 'a'.repeat(64),
        payload,
      },
    });
    await prisma.githubAccount.updateMany({ where: { githubUserId: 810_001n }, data: { unlinkedAt: new Date() } });

    const publisher = app.get(GithubWebhookPublisher);
    await publisher.publishOwed();

    const job = await queue.getJob(`github-webhook-${delivery.id}`);
    expect(job).toBeUndefined();
    const published = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(published).toMatchObject({ status: 'failed', publishedAt: null, processingError: 'Webhook authority is unavailable.' });
    expect(published.processedAt).toBeInstanceOf(Date);
  });

  it('keeps failed publication discoverable and recreates an evicted deterministic job', async () => {
    await trackedRepository();
    const payload = JSON.parse(pushPayload()) as object;
    const installation = await prisma.githubInstallation.findUniqueOrThrow({ where: { githubInstallationId: 820_001n } });
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 830_001n } });
    const delivery = await prisma.githubWebhookDelivery.create({
      data: {
        githubDeliveryId: deliveryId,
        eventName: 'push',
        githubInstallationId: 820_001n,
        githubRepositoryId: 830_001n,
        installationId: installation.id,
        repositoryId: repository.id,
        payloadHash: 'b'.repeat(64),
        payload,
      },
    });
    const failingPublisher = new GithubWebhookPublisher(prisma, {
      enqueue: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    } as never);

    await failingPublisher.publishOwed();
    const failedAttempt = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(failedAttempt).toMatchObject({ status: 'pending' });
    expect(failedAttempt.publishedAt).toBeInstanceOf(Date);

    const publisher = app.get(GithubWebhookPublisher);
    await publisher.publishOwed();
    expect(await queue.getJob(`github-webhook-${delivery.id}`)).not.toBeNull();
    await queue.obliterate({ force: true });
    await publisher.publishOwed();
    expect(await queue.getJob(`github-webhook-${delivery.id}`)).not.toBeNull();
  });


  it('serializes queue publication with concurrent authority revocation', async () => {
    await trackedRepository();
    const payload = JSON.parse(pushPayload()) as object;
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, include: { githubAccount: true } });
    const installation = await prisma.githubInstallation.findUniqueOrThrow({ where: { githubInstallationId: 820_001n } });
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 830_001n } });
    const delivery = await prisma.githubWebhookDelivery.create({
      data: {
        githubDeliveryId: deliveryId,
        eventName: 'push',
        githubInstallationId: 820_001n,
        githubRepositoryId: 830_001n,
        installationId: installation.id,
        repositoryId: repository.id,
        payloadHash: 'c'.repeat(64),
        payload,
      },
    });
    let releaseRevocation!: () => void;
    const release = new Promise<void>((resolve) => { releaseRevocation = resolve; });
    let revocationLocked!: () => void;
    const locked = new Promise<void>((resolve) => { revocationLocked = resolve; });
    const revocation = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      await transaction.githubAccount.update({ where: { id: user.githubAccount!.id }, data: { unlinkedAt: new Date() } });
      revocationLocked();
      await release;
    });
    await locked;

    const publisher = app.get(GithubWebhookPublisher);
    let settled = false;
    const publishing = publisher.publishOwed().then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(settled).toBe(false);
    releaseRevocation();
    await revocation;
    await publishing;

    expect(await queue.getJob(`github-webhook-${delivery.id}`)).toBeUndefined();
    await expect(prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: 'failed',
      processingError: 'Webhook authority is unavailable.',
    });
  });

  it('does not re-enqueue a persisted delivery after tracking is revoked', async () => {
    await trackedRepository();
    const payload = pushPayload();
    await postPush(payload).expect(202, { accepted: true });
    await queue.obliterate({ force: true });
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 830_001n } });
    await prisma.userRepository.updateMany({ where: { repositoryId: repository.id }, data: { trackingEnabled: false } });

    await postPush(payload).expect(202, { accepted: false, reason: 'untracked' });
    const jobs = await queue.getJobs(['wait', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(0);
  });

  it('rejects unsupported events without persistence or queueing', async () => {
    await trackedRepository();
    const payload = pushPayload();
    await request(server)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'issues')
      .set('X-GitHub-Delivery', deliveryId)
      .set('X-Hub-Signature-256', signature(payload))
      .send(payload)
      .expect(400);
    await expect(fixtureDeliveryCount()).resolves.toBe(0);
  });

  it('rejects oversized payloads before persistence or queueing', async () => {
    await trackedRepository();
    const payload = JSON.stringify({ padding: 'x'.repeat(256 * 1024) });
    const response = await request(server)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Request-ID', 'oversized-webhook-request')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', deliveryId)
      .set('X-Hub-Signature-256', signature(payload))
      .send(payload)
      .expect(413);
    expect(response.body).toMatchObject({
      code: 'WEBHOOK_PAYLOAD_TOO_LARGE',
      requestId: 'oversized-webhook-request',
    });
    await expect(fixtureDeliveryCount()).resolves.toBe(0);
  });

  it('keeps the webhook payload-limit envelope scoped to the webhook route', async () => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(1_048_577) });
    const response = await request(server)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send(oversized)
      .expect(413);

    expect(response.body).not.toMatchObject({ code: 'WEBHOOK_PAYLOAD_TOO_LARGE' });
    await expect(fixtureDeliveryCount()).resolves.toBe(0);
  });

  it('does not accept while account disconnect commits concurrently', async () => {
    await trackedRepository();
    const user = await prisma.user.findUniqueOrThrow({
      where: { username },
      include: { githubAccount: true },
    });
    let releaseDisconnect!: () => void;
    const release = new Promise<void>((resolve) => { releaseDisconnect = resolve; });
    let revocationLocked!: () => void;
    const locked = new Promise<void>((resolve) => { revocationLocked = resolve; });
    const disconnect = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      await transaction.githubAccount.update({ where: { id: user.githubAccount!.id }, data: { unlinkedAt: new Date() } });
      revocationLocked();
      await release;
    });
    await locked;

    let webhookSettled = false;
    const webhook = postPush(pushPayload()).then((response) => {
      webhookSettled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(webhookSettled).toBe(false);
    releaseDisconnect();
    await disconnect;

    const response = await webhook;
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: false, reason: 'untracked' });
    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(0);
  });

  it.each([
    ['suspended installation', async () => prisma.githubInstallation.updateMany({ where: { githubInstallationId: 820_001n }, data: { suspendedAt: new Date() } })],
    ['disconnected account', async () => prisma.githubAccount.updateMany({ where: { githubUserId: 810_001n }, data: { unlinkedAt: new Date() } })],
    ['removed repository access', async () => prisma.repository.updateMany({ where: { githubRepositoryId: 830_001n }, data: { accessRemovedAt: new Date() } })],
  ])('acknowledges %s without persistence or queueing', async (_label, revoke) => {
    await trackedRepository();
    await revoke();
    await postPush(pushPayload()).expect(202, { accepted: false, reason: 'untracked' });
    await expect(fixtureDeliveryCount()).resolves.toBe(0);
    await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, delayed: 0, active: 0 });
  });

  it('accepts and persists a fully validated nested commit', async () => {
    await trackedRepository();
    const commitId = '2'.repeat(40);
    const payload = JSON.stringify({
      ...JSON.parse(pushPayload()),
      commits: [{
        id: commitId,
        tree_id: '3'.repeat(40),
        distinct: true,
        message: 'Add webhook ingestion boundary',
        timestamp: '2026-08-12T15:58:00Z',
        url: `https://github.com/day5-webhook-org/tracked/commit/${commitId}`,
        author: { name: 'Octo Cat', email: 'octo@example.test', username: 'octocat' },
        committer: { name: 'Octo Cat', email: 'octo@example.test', username: null },
        added: ['src/new.ts'],
        removed: [],
        modified: ['src/existing.ts'],
      }],
    });

    await postPush(payload).expect(202, { accepted: true });
    const delivery = await prisma.githubWebhookDelivery.findUniqueOrThrow({ where: { githubDeliveryId: deliveryId } });
    expect(delivery.payload).toEqual(JSON.parse(payload));
  });

  it('rejects a signed push with malformed nested commit fields', async () => {
    await trackedRepository();
    const payload = JSON.stringify({
      ...JSON.parse(pushPayload()),
      commits: [{
        id: '2'.repeat(40),
        message: 42,
        timestamp: 'not-a-timestamp',
        url: 'https://github.com/day5-webhook-org/tracked/commit/' + '2'.repeat(40),
        author: { name: 'Octo Cat', email: 'octo@example.test', username: 'octocat' },
        committer: { name: 'Octo Cat', email: 'octo@example.test', username: 'octocat' },
        added: ['src/new.ts'],
        removed: [],
        modified: [],
      }],
    });

    await postPush(payload).expect(400);
    await expect(prisma.githubWebhookDelivery.count({ where: { githubDeliveryId: deliveryId } })).resolves.toBe(0);
  });

  it('rejects a signed malformed push payload before persistence or queueing', async () => {
    await trackedRepository();
    const payload = JSON.stringify({
      installation: { id: 820_001 },
      repository: { id: 830_001, full_name: 'day5-webhook-org/tracked' },
    });

    await postPush(payload).expect(400);
    await expect(fixtureDeliveryCount()).resolves.toBe(0);
    await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, delayed: 0, active: 0 });
  });
});
