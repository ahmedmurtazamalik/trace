import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { activityListResponseSchema } from '@trace/shared';
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
    process.env.REDIS_URL = 'redis://localhost:6379';
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
    const user = await prisma.user.findUnique({
      where: { username },
      include: { githubAccount: { include: { installations: true } } },
    });
    if (user?.githubAccount !== null && user?.githubAccount !== undefined) {
      const installationIds = user.githubAccount.installations.map((installation) => installation.id);
      const repositories = await prisma.repository.findMany({
        where: { githubInstallationId: { in: installationIds } },
        select: { id: true },
      });
      const repositoryIds = repositories.map((repository) => repository.id);
      await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.userRepository.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.repository.deleteMany({ where: { id: { in: repositoryIds } } });
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
    }
    await prisma.contributor.deleteMany({ where: { username: { startsWith: 'day7-activity-' } } });
    await prisma.user.deleteMany({ where: { username } });
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
