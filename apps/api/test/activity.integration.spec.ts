import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { activityListResponseSchema, dashboardResponseSchema } from '@trace/shared';
import request from 'supertest';
import { RedisService } from '../src/common/redis/redis.service';
import { createApplication } from '../src/bootstrap';

const username = 'day7.activity.user';
const email = 'day7.activity@example.test';
const password = 'correct-horse-battery-staple';

function cookie(response: request.Response): string {
  const value: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  const header = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  return header.split(';', 1)[0] ?? '';
}

describe('Activity API', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    process.env.GITHUB_APP_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_APP_SLUG = 'trace-test-app';
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3001/api/v1/github/callback';
    process.env.GITHUB_INSTALLATION_CALLBACK_URL = 'http://localhost:3001/api/v1/github/installation/callback';
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  beforeEach(async () => {
    await cleanup();
    await redis.flushdb();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await app.close();
    }
  });

  async function cleanup(): Promise<void> {
    const users = await prisma.user.findMany({
      where: { username: { in: [username, 'day7.activity.foreign'] } },
      include: { githubAccount: { include: { installations: true } } },
    });
    for (const user of users) {
      if (user.githubAccount !== null) {
        const installationIds = user.githubAccount.installations.map((installation) => installation.id);
        const repositories = await prisma.repository.findMany({
          where: { githubInstallationId: { in: installationIds } },
          select: { id: true },
        });
        const repositoryIds = repositories.map((repository) => repository.id);
        await prisma.githubWebhookDelivery.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.userRepository.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
        await prisma.repository.deleteMany({ where: { id: { in: repositoryIds } } });
        await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
        await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
      }
    }
    await prisma.contributor.deleteMany({ where: { username: { startsWith: 'day7-activity-' } } });
    await prisma.user.deleteMany({ where: { username: { in: [username, 'day7.activity.foreign'] } } });
  }

  async function historicalActivity(): Promise<{ sessionCookie: string; repositoryId: string }> {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId: 783_231n, githubUsername: 'day7-activity-user' },
    });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 791n, githubAccountId: account.id, accountType: 'ORGANIZATION', accountLogin: 'day7-org' },
    });
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId: 77_001n,
        githubInstallationId: installation.id,
        owner: 'day7-org',
        name: 'activity-api',
        fullName: 'day7-org/activity-api',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/day7-org/activity-api',
      },
    });
    const cutoff = new Date('2026-08-12T12:00:00.000Z');
    const accessGrantedAt = new Date('2026-08-12T08:00:00.000Z');
    await prisma.userRepository.create({
      data: { userId: user.id, repositoryId: repository.id, trackingEnabled: true, accessRemovedAt: cutoff, createdAt: accessGrantedAt },
    });
    await prisma.activityEvent.createMany({
      data: [
        {
          sourceKey: `day7:visible:${repository.id}`,
          repositoryId: repository.id,
          source: 'github',
          type: 'push',
          occurredAt: cutoff,
          metadata: { ref: 'refs/heads/main' },
        },
        {
          sourceKey: `day7:pre-access:${repository.id}`,
          repositoryId: repository.id,
          source: 'github',
          type: 'push',
          occurredAt: new Date(accessGrantedAt.getTime() - 1),
          metadata: { ref: 'refs/heads/pre-access' },
        },
        {
          sourceKey: `day7:foreign-cli:${repository.id}`,
          repositoryId: repository.id,
          source: 'cli',
          type: 'local_commit',
          occurredAt: new Date('2026-08-12T10:00:00.000Z'),
          metadata: { branch: 'private-local-work' },
        },
        {
          sourceKey: `day7:hidden:${repository.id}`,
          repositoryId: repository.id,
          source: 'github',
          type: 'push',
          occurredAt: new Date(cutoff.getTime() + 1),
          metadata: { ref: 'refs/heads/private-future' },
        },
      ],
    });
    return { sessionCookie: cookie(registered), repositoryId: repository.id };
  }

  it('returns authorized historical activity only through the membership cutoff', async () => {
    const fixture = await historicalActivity();

    const response = await request(server).get('/api/v1/activity').set('Cookie', fixture.sessionCookie).expect(200);
    const body = activityListResponseSchema.parse(response.body as unknown);

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      repository: { id: fixture.repositoryId, fullName: 'day7-org/activity-api' },
      source: 'github',
      type: 'push',
      occurredAt: '2026-08-12T12:00:00.000Z',
      facts: { branch: 'main' },
    });
    expect(body.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });

    const cli = await request(server).get('/api/v1/activity')
      .query({ source: 'cli' }).set('Cookie', fixture.sessionCookie).expect(200);
    expect(activityListResponseSchema.parse(cli.body as unknown).items).toEqual([]);
  });

  it('returns an authorization-filtered dashboard from canonical activity', async () => {
    const fixture = await historicalActivity();
    await prisma.userRepository.updateMany({
      where: { repositoryId: fixture.repositoryId },
      data: { accessRemovedAt: null },
    });
    await prisma.activityEvent.deleteMany({
      where: { repositoryId: fixture.repositoryId, occurredAt: { gt: new Date('2026-08-12T12:00:00.000Z') } },
    });
    const contributor = await prisma.contributor.create({
      data: { githubUserId: 77_002n, username: 'day7-activity-dashboard', displayName: 'Dashboard Contributor' },
    });
    await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:dashboard:commit:${fixture.repositoryId}`,
        repositoryId: fixture.repositoryId,
        contributorId: contributor.id,
        source: 'github',
        type: 'commit',
        occurredAt: new Date('2026-08-12T11:00:00.000Z'),
        metadata: { sha: 'd'.repeat(40), message: 'Dashboard facts', branch: 'main', changedFiles: 3, additions: 8, deletions: 2 },
      },
    });
    const sourceRepository = await prisma.repository.findUniqueOrThrow({ where: { id: fixture.repositoryId } });
    const secondRepository = await prisma.repository.create({
      data: {
        githubRepositoryId: 77_099n,
        githubInstallationId: sourceRepository.githubInstallationId,
        owner: 'day7-org',
        name: 'other-recent',
        fullName: 'day7-org/other-recent',
        private: true,
        defaultBranch: 'main',
      },
    });
    const fixtureUser = await prisma.userRepository.findFirstOrThrow({ where: { repositoryId: fixture.repositoryId } });
    await prisma.userRepository.create({
      data: { userId: fixtureUser.userId, repositoryId: secondRepository.id, trackingEnabled: true, createdAt: new Date('2026-08-10T00:00:00.000Z') },
    });
    await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:dashboard:recent-all:${secondRepository.id}`,
        repositoryId: secondRepository.id,
        contributorId: contributor.id,
        source: 'github',
        type: 'commit',
        occurredAt: new Date('2026-08-11T18:00:00.000Z'),
        metadata: { sha: 'e'.repeat(40), message: 'Recent activity from another repository', branch: 'main' },
      },
    });

    const response = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' })
      .set('Cookie', fixture.sessionCookie).expect(200);
    const body = dashboardResponseSchema.parse(response.body as unknown);

    expect(body).toMatchObject({
      date: '2026-08-12',
      timezone: 'UTC',
      state: 'READY',
      metrics: {
        activityCount: 2,
        repositoryCount: 1,
        contributorCount: 1,
        commitCount: 1,
        filesChanged: 3,
        additions: 8,
        deletions: 2,
      },
    });
    expect(body.recentActivity).toHaveLength(3);
    expect(body.recentActivity[0]?.repository.fullName).toBe('day7-org/activity-api');
    expect(body.recentActivity.some((item) => item.repository.fullName === 'day7-org/other-recent')).toBe(true);
    await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).expect(401);
  });

  it('derives dashboard states without disclosing inaccessible repositories', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const sessionCookie = cookie(registered);
    const disconnectedResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(disconnectedResponse.body as unknown).state).toBe('GITHUB_NOT_CONNECTED');

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId: 783_232n, githubUsername: 'day7-activity-states' },
    });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 792n, githubAccountId: account.id, accountType: 'USER', accountLogin: 'day7-dashboard-states' },
    });
    const repository = await prisma.repository.create({
      data: { githubRepositoryId: 77_002n, githubInstallationId: installation.id, owner: 'day7-dashboard-states', name: 'states', fullName: 'day7-dashboard-states/states', private: true, defaultBranch: 'main' },
    });
    await prisma.userRepository.create({ data: { userId: user.id, repositoryId: repository.id, trackingEnabled: false, createdAt: new Date('2026-08-12T00:00:00.000Z') } });

    const noTrackedResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(noTrackedResponse.body as unknown).state).toBe('NO_TRACKED_REPOSITORIES');
    await prisma.userRepository.update({ where: { userId_repositoryId: { userId: user.id, repositoryId: repository.id } }, data: { trackingEnabled: true } });

    const noActivityResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(noActivityResponse.body as unknown).state).toBe('NO_ACTIVITY');
    const hiddenResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC', repositoryId: 'inaccessible-repository' }).set('Cookie', sessionCookie).expect(404);
    expect(hiddenResponse.body).toEqual(expect.objectContaining({ code: 'REPOSITORY_NOT_FOUND' }));
    await request(server).get('/api/v1/dashboard')
      .query({ date: 'not-a-date', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(400);

    const pendingWithNoActivity = await prisma.githubWebhookDelivery.create({
      data: {
        githubDeliveryId: 'day7-dashboard-pending-empty',
        eventName: 'push',
        githubInstallationId: 792n,
        githubRepositoryId: 77_002n,
        installationId: installation.id,
        repositoryId: repository.id,
        payloadHash: 'b'.repeat(64),
        payload: {},
        status: 'pending',
        receivedAt: new Date('2026-08-12T11:59:00.000Z'),
      },
    });
    const partialWithNoActivityResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(partialWithNoActivityResponse.body as unknown).state).toBe('PARTIAL');
    await prisma.githubWebhookDelivery.update({
      where: { id: pendingWithNoActivity.id },
      data: { status: 'processing' },
    });
    const processingWithNoActivityResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC', repositoryId: repository.id }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(processingWithNoActivityResponse.body as unknown).state).toBe('PARTIAL');
    const mismatchedRepositoryResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC', repositoryId: 'inaccessible-repository' }).set('Cookie', sessionCookie).expect(404);
    expect(mismatchedRepositoryResponse.body).toMatchObject({ code: 'REPOSITORY_NOT_FOUND', message: 'Repository not found.' });
    await prisma.githubWebhookDelivery.update({
      where: { id: pendingWithNoActivity.id },
      data: { status: 'completed', processedAt: new Date('2026-08-12T12:00:00.000Z') },
    });

    const foreignUser = await prisma.user.create({
      data: { username: 'day7.activity.foreign', email: 'day7.activity.foreign@example.test', passwordHash: 'not-used-by-this-test' },
    });
    const foreignAccount = await prisma.githubAccount.create({
      data: { userId: foreignUser.id, githubUserId: 783_233n, githubUsername: 'day7-activity-foreign' },
    });
    const foreignInstallation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 793n, githubAccountId: foreignAccount.id, accountType: 'USER', accountLogin: 'day7-activity-foreign' },
    });
    const foreignRepository = await prisma.repository.create({
      data: { githubRepositoryId: 77_003n, githubInstallationId: foreignInstallation.id, owner: 'day7-activity-foreign', name: 'private', fullName: 'day7-activity-foreign/private', private: true, defaultBranch: 'main' },
    });
    await prisma.userRepository.create({
      data: { userId: foreignUser.id, repositoryId: foreignRepository.id, trackingEnabled: true, createdAt: new Date('2026-08-12T00:00:00.000Z') },
    });
    await prisma.githubWebhookDelivery.create({
      data: {
        githubDeliveryId: 'day7-dashboard-foreign-pending',
        eventName: 'push',
        githubInstallationId: 793n,
        githubRepositoryId: 77_003n,
        installationId: foreignInstallation.id,
        repositoryId: foreignRepository.id,
        payloadHash: 'c'.repeat(64),
        payload: {},
        status: 'pending',
        receivedAt: new Date('2026-08-12T12:00:00.000Z'),
      },
    });
    const foreignPendingResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(foreignPendingResponse.body as unknown).state).toBe('NO_ACTIVITY');

    await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:dashboard:state:${repository.id}`,
        repositoryId: repository.id,
        source: 'github',
        type: 'push',
        occurredAt: new Date('2026-08-12T12:00:00.000Z'),
        metadata: { ref: 'refs/heads/main' },
      },
    });
    const delivery = await prisma.githubWebhookDelivery.create({
      data: {
        githubDeliveryId: 'day7-dashboard-pending',
        eventName: 'push',
        githubInstallationId: 792n,
        githubRepositoryId: 77_002n,
        installationId: installation.id,
        repositoryId: repository.id,
        payloadHash: 'a'.repeat(64),
        payload: {},
        status: 'pending',
        receivedAt: new Date('2026-08-12T12:01:00.000Z'),
      },
    });
    const partialResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(partialResponse.body as unknown).state).toBe('PARTIAL');
    await prisma.githubWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'completed', processedAt: new Date('2026-08-12T12:02:00.000Z') },
    });
    const readyResponse = await request(server).get('/api/v1/dashboard')
      .query({ date: '2026-08-12', timezone: 'UTC' }).set('Cookie', sessionCookie).expect(200);
    expect(dashboardResponseSchema.parse(readyResponse.body as unknown).state).toBe('READY');
  });

  it('normalizes impossible durable Git object IDs out of activity responses', async () => {
    const fixture = await historicalActivity();
    const invalid = await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:invalid-oid:${fixture.repositoryId}`,
        repositoryId: fixture.repositoryId,
        source: 'github',
        type: 'commit',
        occurredAt: new Date('2026-08-12T11:59:00.000Z'),
        metadata: { sha: 'a'.repeat(41), message: 'Impossible object ID' },
      },
    });
    const response = await request(server).get('/api/v1/activity').set('Cookie', fixture.sessionCookie).expect(200);
    const body = activityListResponseSchema.parse(response.body as unknown);
    expect(body.items.find((item) => item.id === invalid.id)?.facts.sha).toBeNull();
  });

  it('applies local-day filters and stable filter-bound cursor pagination', async () => {
    const fixture = await historicalActivity();
    await prisma.userRepository.updateMany({
      where: { repositoryId: fixture.repositoryId },
      data: { accessRemovedAt: null },
    });
    await prisma.activityEvent.deleteMany({ where: { repositoryId: fixture.repositoryId } });
    const contributor = await prisma.contributor.create({
      data: { githubUserId: 77_001n, username: 'day7-activity-contributor', displayName: 'Day Seven' },
    });
    await prisma.activityEvent.createMany({
      data: [
        {
          id: 'day7_cursor_b',
          sourceKey: `day7:cursor:b:${fixture.repositoryId}`,
          repositoryId: fixture.repositoryId,
          contributorId: contributor.id,
          source: 'github',
          type: 'commit',
          occurredAt: new Date('2026-08-12T19:00:00.000Z'),
          metadata: { sha: 'b'.repeat(40), message: 'Boundary B', branch: 'main', changedFiles: 2, additions: 3, deletions: 1 },
        },
        {
          id: 'day7_cursor_a',
          sourceKey: `day7:cursor:a:${fixture.repositoryId}`,
          repositoryId: fixture.repositoryId,
          contributorId: contributor.id,
          source: 'github',
          type: 'commit',
          occurredAt: new Date('2026-08-12T19:00:00.000Z'),
          metadata: { sha: 'a'.repeat(40), message: 'Boundary A', branch: 'main', changedFiles: 1, additions: 2, deletions: 0 },
        },
        {
          id: 'day7_end_exclusive',
          sourceKey: `day7:end:${fixture.repositoryId}`,
          repositoryId: fixture.repositoryId,
          contributorId: contributor.id,
          source: 'github',
          type: 'commit',
          occurredAt: new Date('2026-08-13T19:00:00.000Z'),
          metadata: { sha: 'e'.repeat(40), message: 'Next local day', branch: 'main' },
        },
      ],
    });

    const filters = {
      date: '2026-08-13',
      timezone: 'Asia/Karachi',
      contributorId: contributor.id,
      source: 'github',
      type: 'commit',
      limit: 1,
    };
    const firstResponse = await request(server).get(`/api/v1/repositories/${fixture.repositoryId}/activity`)
      .query(filters).set('Cookie', fixture.sessionCookie).expect(200);
    const first = activityListResponseSchema.parse(firstResponse.body as unknown);
    expect(first.items.map((item) => item.id)).toEqual(['day7_cursor_b']);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(first.pageInfo.nextCursor).not.toBeNull();

    const secondResponse = await request(server).get(`/api/v1/repositories/${fixture.repositoryId}/activity`)
      .query({ ...filters, cursor: first.pageInfo.nextCursor }).set('Cookie', fixture.sessionCookie).expect(200);
    const second = activityListResponseSchema.parse(secondResponse.body as unknown);
    expect(second.items.map((item) => item.id)).toEqual(['day7_cursor_a']);
    expect(second.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });

    await request(server).get(`/api/v1/repositories/${fixture.repositoryId}/activity`)
      .query({ ...filters, type: 'push', cursor: first.pageInfo.nextCursor })
      .set('Cookie', fixture.sessionCookie).expect(400);
    const cursor = first.pageInfo.nextCursor!;
    const [payload, signature] = cursor.split('.') as [string, string];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const forgedPayload = Buffer.from(JSON.stringify({ ...decoded, id: 'day7_cursor_a' })).toString('base64url');
    await request(server).get(`/api/v1/repositories/${fixture.repositoryId}/activity`)
      .query({ ...filters, cursor: `${forgedPayload}.${signature}` })
      .set('Cookie', fixture.sessionCookie).expect(400);
    await request(server).get(`/api/v1/repositories/${fixture.repositoryId}/activity`)
      .query({ ...filters, cursor: `${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}` })
      .set('Cookie', fixture.sessionCookie).expect(400);
    await request(server).get(`/api/v1/repositories/${fixture.repositoryId}/activity`)
      .query({ ...filters, cursor: `${payload}==.${signature}` })
      .set('Cookie', fixture.sessionCookie).expect(400);
  });

  it('requires a session and hides repository activity without caller membership', async () => {
    const fixture = await historicalActivity();
    await request(server).get('/api/v1/activity').expect(401);
    await request(server).get(`/api/v1/repositories/${'r'.repeat(257)}/activity`)
      .set('Cookie', fixture.sessionCookie).expect(400);
    const ownedRepository = await prisma.repository.findUniqueOrThrow({ where: { id: fixture.repositoryId } });
    const unowned = await prisma.repository.create({
      data: {
        githubRepositoryId: 77_002n,
        githubInstallationId: ownedRepository.githubInstallationId,
        owner: 'day7-org',
        name: 'unowned',
        fullName: 'day7-org/unowned',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:unowned:${unowned.id}`,
        repositoryId: unowned.id,
        source: 'github',
        type: 'push',
        occurredAt: new Date('2026-08-12T10:00:00.000Z'),
        metadata: { ref: 'refs/heads/main' },
      },
    });

    const response = await request(server).get(`/api/v1/repositories/${unowned.id}/activity`)
      .set('Cookie', fixture.sessionCookie).expect(404);
    expect(response.body).toMatchObject({
      code: 'REPOSITORY_NOT_FOUND',
      message: 'Repository not found.',
    });
  });

  it('uses true half-open local days across daylight-saving transitions', async () => {
    const fixture = await historicalActivity();
    await prisma.userRepository.updateMany({
      where: { repositoryId: fixture.repositoryId },
      data: { accessRemovedAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await prisma.activityEvent.deleteMany({ where: { repositoryId: fixture.repositoryId } });
    await prisma.activityEvent.createMany({
      data: [
        { id: 'day7_dst_before', sourceKey: `day7:dst:before:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-03-08T04:59:59.999Z'), metadata: { ref: 'refs/heads/before' } },
        { id: 'day7_dst_start', sourceKey: `day7:dst:start:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-03-08T05:00:00.000Z'), metadata: { ref: 'refs/heads/start' } },
        { id: 'day7_dst_end', sourceKey: `day7:dst:end:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-03-09T03:59:59.999Z'), metadata: { ref: 'refs/heads/end' } },
        { id: 'day7_dst_after', sourceKey: `day7:dst:after:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-03-09T04:00:00.000Z'), metadata: { ref: 'refs/heads/after' } },
      ],
    });

    const response = await request(server).get('/api/v1/activity')
      .query({ date: '2026-03-08', timezone: 'America/New_York' })
      .set('Cookie', fixture.sessionCookie).expect(200);
    expect(activityListResponseSchema.parse(response.body as unknown).items.map((item) => item.id))
      .toEqual(['day7_dst_end', 'day7_dst_start']);

    await prisma.activityEvent.deleteMany({ where: { repositoryId: fixture.repositoryId } });
    await prisma.activityEvent.createMany({
      data: [
        { id: 'day7_fall_before', sourceKey: `day7:fall:before:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-11-01T03:59:59.999Z'), metadata: { ref: 'refs/heads/before' } },
        { id: 'day7_fall_start', sourceKey: `day7:fall:start:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-11-01T04:00:00.000Z'), metadata: { ref: 'refs/heads/start' } },
        { id: 'day7_fall_end', sourceKey: `day7:fall:end:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-11-02T04:59:59.999Z'), metadata: { ref: 'refs/heads/end' } },
        { id: 'day7_fall_after', sourceKey: `day7:fall:after:${fixture.repositoryId}`, repositoryId: fixture.repositoryId, source: 'github', type: 'push', occurredAt: new Date('2026-11-02T05:00:00.000Z'), metadata: { ref: 'refs/heads/after' } },
      ],
    });
    const fallResponse = await request(server).get('/api/v1/activity')
      .query({ date: '2026-11-01', timezone: 'America/New_York' })
      .set('Cookie', fixture.sessionCookie).expect(200);
    expect(activityListResponseSchema.parse(fallResponse.body as unknown).items.map((item) => item.id))
      .toEqual(['day7_fall_end', 'day7_fall_start']);

    await request(server).get('/api/v1/activity')
      .query({ date: '2011-12-30', timezone: 'Pacific/Apia' })
      .set('Cookie', fixture.sessionCookie).expect(400);
  });

  it('sanitizes malformed optional metadata without exposing invalid facts', async () => {
    const fixture = await historicalActivity();
    await prisma.userRepository.updateMany({ where: { repositoryId: fixture.repositoryId }, data: { accessRemovedAt: null } });
    await prisma.activityEvent.deleteMany({ where: { repositoryId: fixture.repositoryId } });
    const repository = await prisma.repository.update({
      where: { id: fixture.repositoryId },
      data: { htmlUrl: 'javascript:alert(1)' },
    });
    const contributor = await prisma.contributor.create({
      data: { githubUserId: 77_099n, username: 'day7-activity-unsafe', avatarUrl: 'data:text/html,unsafe' },
    });
    await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:malformed:${fixture.repositoryId}`,
        repositoryId: fixture.repositoryId,
        contributorId: contributor.id,
        source: 'github',
        type: 'commit',
        occurredAt: new Date('2026-08-12T10:00:00.000Z'),
        metadata: { sha: 'x', message: '', branch: '', changedFiles: -1, additions: Number.MAX_SAFE_INTEGER + 1, deletions: 'secret', url: 'file:///etc/passwd' },
      },
    });
    await prisma.activityEvent.create({
      data: {
        sourceKey: `day7:invalid-pair:${repository.id}`,
        repositoryId: repository.id,
        source: 'github',
        type: 'local_commit',
        occurredAt: new Date('2026-08-12T09:00:00.000Z'),
        metadata: {},
      },
    });

    const response = await request(server).get('/api/v1/activity').set('Cookie', fixture.sessionCookie).expect(200);
    const body = activityListResponseSchema.parse(response.body as unknown);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.repository.url).toBeNull();
    expect(body.items[0]?.contributor?.avatarUrl).toBeNull();
    expect(body.items[0]?.facts).toEqual({
      sha: null, message: null, branch: null, filesChanged: null, additions: null, deletions: null, url: null,
    });
  });
});
