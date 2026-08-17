import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import type { GithubAuthorizationAdapter, GithubRepositoryAccess } from '@trace/github';
import {
  repositoryDetailResponseSchema,
  repositoryListResponseSchema,
  repositoryTrackingResponseSchema,
} from '@trace/shared';
import request from 'supertest';
import { RedisService } from '../src/common/redis/redis.service';
import { GITHUB_AUTHORIZATION_ADAPTER } from '../src/modules/github/github.tokens';
import { RepositoriesService } from '../src/modules/repositories/repositories.service';
import { createApplication } from '../src/bootstrap';
import { applyIntegrationEnvironment } from './support/integration-environment';

const username = 'day4.repositories.user';
const email = 'day4.repositories@example.test';
const password = 'correct-horse-battery-staple';
const cursorUsername = 'day4.repositories.cursor.other';

function cookie(response: request.Response): string {
  const value: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  const header = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  return header.split(';', 1)[0] ?? '';
}

describe('Repository API', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    applyIntegrationEnvironment();
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
    await cleanupTransferIdentity();
    await prisma.activityEvent.deleteMany({ where: { contributor: { username: 'day4-contributor' } } });
    await prisma.contributor.deleteMany({ where: { username: 'day4-contributor' } });
    const user = await prisma.user.findUnique({ where: { username }, include: { githubAccount: { include: { installations: true } } } });
    if (user?.githubAccount !== null && user?.githubAccount !== undefined) {
      const installationIds = user.githubAccount.installations.map((installation) => installation.id);
      await prisma.activityEvent.deleteMany({ where: { repository: { githubInstallationId: { in: installationIds } } } });
      await prisma.userRepository.deleteMany({ where: { userId: user.id } });
      await prisma.repository.deleteMany({ where: { githubInstallationId: { in: installationIds } } });
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
    }
    await prisma.user.deleteMany({ where: { username: { in: [username, cursorUsername] } } });
    await redis.flushdb();
  });

  afterAll(async () => {
    try {
      const user = await prisma.user.findUnique({ where: { username }, include: { githubAccount: { include: { installations: true } } } });
      if (user?.githubAccount !== null && user?.githubAccount !== undefined) {
        const installationIds = user.githubAccount.installations.map((installation) => installation.id);
        await prisma.activityEvent.deleteMany({ where: { repository: { githubInstallationId: { in: installationIds } } } });
        await prisma.userRepository.deleteMany({ where: { userId: user.id } });
        await prisma.repository.deleteMany({ where: { githubInstallationId: { in: installationIds } } });
        await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
        await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
      }
      await prisma.user.deleteMany({ where: { username: { in: [username, cursorUsername] } } });
    } finally {
      await app.close();
    }
  });

  async function cleanupTransferIdentity(): Promise<void> {
    const transferUser = await prisma.user.findUnique({
      where: { username: 'day4.repositories.transfer' },
      include: { githubAccount: { include: { installations: true } } },
    });
    if (transferUser?.githubAccount !== null && transferUser?.githubAccount !== undefined) {
      const installationIds = transferUser.githubAccount.installations.map((installation) => installation.id);
      const repositories = await prisma.repository.findMany({
        where: { githubInstallationId: { in: installationIds } },
        select: { id: true },
      });
      const repositoryIds = repositories.map((repository) => repository.id);
      await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.userRepository.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.repository.deleteMany({ where: { id: { in: repositoryIds } } });
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: transferUser.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: transferUser.githubAccount.id } });
    }
    await prisma.user.deleteMany({ where: { username: 'day4.repositories.transfer' } });
  }

  async function installedIdentity(): Promise<{ cookie: string; csrfToken: string; userId: string; installationId: string }> {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId: 583_231n, githubUsername: 'fake-octocat' },
    });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 91n, githubAccountId: account.id, accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org' },
    });
    return { cookie: cookie(registered), csrfToken: (registered.body as { csrfToken: string }).csrfToken, userId: user.id, installationId: installation.id };
  }

  it('synchronizes installation-authorized repositories by stable GitHub repository ID', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').expect(401);
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).expect(403);

    await request(server)
      .post('/api/v1/repositories/sync')
      .set('Cookie', identity.cookie)
      .set('X-CSRF-Token', identity.csrfToken)
      .expect(200, { accessibleRepositoryCount: 2 });

    const repositories = await prisma.repository.findMany({ where: { githubInstallationId: identity.installationId }, orderBy: { githubRepositoryId: 'asc' } });
    expect(repositories).toMatchObject([
      { githubRepositoryId: 7_001n, fullName: 'trace-fixture-org/web', accessRemovedAt: null },
      { githubRepositoryId: 7_002n, fullName: 'trace-fixture-org/api', accessRemovedAt: null },
    ]);
    await expect(prisma.userRepository.count({ where: { userId: identity.userId, trackingEnabled: false } })).resolves.toBe(2);
  });

  it('is idempotent and preserves per-user tracking state across synchronization', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 7_001n } });
    await prisma.userRepository.update({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: repository.id } },
      data: { trackingEnabled: true },
    });

    const activeMembership = await prisma.userRepository.findUniqueOrThrow({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: repository.id } },
    });
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);

    await expect(prisma.repository.count({ where: { githubInstallationId: identity.installationId } })).resolves.toBe(2);
    const unchangedMembership = await prisma.userRepository.findUniqueOrThrow({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: repository.id } },
    });
    expect(unchangedMembership).toMatchObject({ trackingEnabled: true, createdAt: activeMembership.createdAt });

    const priorGrant = new Date('2020-01-01T00:00:00.000Z');
    await prisma.userRepository.update({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: repository.id } },
      data: { createdAt: priorGrant, accessRemovedAt: new Date('2020-01-02T00:00:00.000Z') },
    });
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const restoredMembership = await prisma.userRepository.findUniqueOrThrow({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: repository.id } },
    });
    expect(restoredMembership.accessRemovedAt).toBeNull();
    expect(restoredMembership.createdAt.getTime()).toBeGreaterThan(priorGrant.getTime());
  });

  it('does not let an older cross-installation snapshot reclaim a repository from a newer owner', async () => {
    const first = await installedIdentity();
    const secondUser = await prisma.user.create({
      data: {
        username: 'day4.repositories.transfer',
        email: 'day4.repositories.transfer@example.test',
        passwordHash: 'test-only-not-authenticated',
      },
    });
    const secondAccount = await prisma.githubAccount.create({
      data: { userId: secondUser.id, githubUserId: 583_232n, githubUsername: 'fake-transfer-owner' },
    });
    const secondInstallation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 92n, githubAccountId: secondAccount.id, accountType: 'ORGANIZATION', accountLogin: 'transfer-org' },
    });
    const existing = await prisma.repository.create({
      data: {
        githubRepositoryId: 7_001n,
        githubInstallationId: first.installationId,
        owner: 'trace-fixture-org',
        name: 'web',
        fullName: 'trace-fixture-org/web',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({
      data: { userId: first.userId, repositoryId: existing.id, trackingEnabled: true },
    });

    let releaseFirst: (() => void) | undefined;
    let firstFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => { firstFetchStarted = resolve; });
    const firstFetch = new Promise<GithubRepositoryAccess[]>((resolve) => {
      releaseFirst = () => resolve([{ id: 7_001n, owner: 'trace-fixture-org', name: 'web', fullName: 'trace-fixture-org/web', private: true, defaultBranch: 'main', htmlUrl: null }]);
    });
    const adapter = app.get<GithubAuthorizationAdapter>(GITHUB_AUTHORIZATION_ADAPTER);
    const repositoryFetch = jest.spyOn(adapter, 'repositories').mockImplementation((installationId) => {
      if (installationId === 91n) {
        firstFetchStarted?.();
        return firstFetch;
      }
      return Promise.resolve([{ id: 7_001n, owner: 'transfer-org', name: 'web', fullName: 'transfer-org/web', private: true, defaultBranch: 'main', htmlUrl: null }]);
    });

    try {
      const service = app.get(RepositoriesService);
      const staleFirstSync = service.synchronize(first.userId);
      await fetchStarted;
      const secondSyncResult = await service.synchronize(secondUser.id);
      releaseFirst?.();
      const staleFirstSyncResult = await staleFirstSync;
      expect(secondSyncResult).toEqual({ accessibleRepositoryCount: 1 });
      expect(staleFirstSyncResult).toEqual({ accessibleRepositoryCount: 0 });

      const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 7_001n } });
      expect(repository.githubInstallationId).toBe(secondInstallation.id);
      expect(repository.fullName).toBe('transfer-org/web');
      const firstMembership = await prisma.userRepository.findUniqueOrThrow({
        where: { userId_repositoryId: { userId: first.userId, repositoryId: repository.id } },
      });
      expect(firstMembership.trackingEnabled).toBe(true);
      expect(firstMembership.accessRemovedAt).toBeInstanceOf(Date);
      await expect(prisma.userRepository.findUniqueOrThrow({
        where: { userId_repositoryId: { userId: secondUser.id, repositoryId: repository.id } },
      })).resolves.toMatchObject({ accessRemovedAt: null });
    } finally {
      repositoryFetch.mockRestore();
      await cleanupTransferIdentity();
    }
  });

  it('marks removed GitHub access while retaining historical per-user tracking state', async () => {
    const identity = await installedIdentity();
    const stale = await prisma.repository.create({
      data: {
        githubRepositoryId: 7_999n,
        githubInstallationId: identity.installationId,
        owner: 'trace-fixture-org',
        name: 'removed',
        fullName: 'trace-fixture-org/removed',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({ data: { userId: identity.userId, repositoryId: stale.id, trackingEnabled: true } });

    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);

    const removed = await prisma.repository.findUniqueOrThrow({ where: { id: stale.id } });
    expect(removed.accessRemovedAt).toBeInstanceOf(Date);
    const membership = await prisma.userRepository.findUniqueOrThrow({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: stale.id } },
    });
    expect(membership.trackingEnabled).toBe(true);
    expect(membership.accessRemovedAt).toBeInstanceOf(Date);
    await prisma.activityEvent.create({
      data: {
        sourceKey: `test:removed-repository:${stale.id}`,
        repositoryId: stale.id,
        source: 'github',
        type: 'push',
        occurredAt: new Date((membership.accessRemovedAt as Date).getTime() + 1_000),
        metadata: {},
      },
    });
    const detail = await request(server).get(`/api/v1/repositories/${stale.id}`).set('Cookie', identity.cookie).expect(200);
    expect(repositoryDetailResponseSchema.parse(detail.body as unknown).repository).toMatchObject({
      accessible: false,
      trackingEnabled: true,
      lastActivityAt: null,
      contributorCount: 0,
    });
  });

  it('lists authorized repositories with search and stable cursor pagination', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);

    const first = await request(server).get('/api/v1/repositories').query({ limit: 1 }).set('Cookie', identity.cookie).expect(200);
    const firstPage = repositoryListResponseSchema.parse(first.body as unknown);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({ fullName: 'trace-fixture-org/api', accessible: true, trackingEnabled: false, lastActivityAt: null, contributorCount: 0 });
    expect(firstPage.pageInfo).toMatchObject({ hasNextPage: true });

    const second = await request(server).get('/api/v1/repositories').query({ limit: 1, cursor: firstPage.pageInfo.nextCursor }).set('Cookie', identity.cookie).expect(200);
    const secondPage = repositoryListResponseSchema.parse(second.body as unknown);
    expect(secondPage.items[0]).toMatchObject({ fullName: 'trace-fixture-org/web' });
    expect(secondPage.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
    await request(server).get('/api/v1/repositories')
      .query({ limit: 1, cursor: firstPage.pageInfo.nextCursor, search: 'other-filter' })
      .set('Cookie', identity.cookie).expect(400);
    await request(server).get('/api/v1/repositories')
      .query({ limit: 2, cursor: firstPage.pageInfo.nextCursor })
      .set('Cookie', identity.cookie).expect(400);
    const cursor = firstPage.pageInfo.nextCursor ?? '';
    const [payload, signature] = cursor.split('.') as [string, string];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const finalIndex = alphabet.indexOf(signature.at(-1) ?? '');
    expect(finalIndex % 4).toBe(0);
    const tampered = `${payload}.${signature.slice(0, -1)}${alphabet[finalIndex + 1]}`;
    await request(server).get('/api/v1/repositories')
      .query({ limit: 1, cursor: tampered }).set('Cookie', identity.cookie).expect(400);
    const other = await request(server).post('/api/v1/auth/register').send({
      username: cursorUsername,
      email: 'day4.repositories.cursor.other@example.test',
      password,
    }).expect(201);
    await request(server).get('/api/v1/repositories')
      .query({ limit: 1, cursor }).set('Cookie', cookie(other)).expect(400);

    const search = await request(server).get('/api/v1/repositories').query({ search: ' WEB ' }).set('Cookie', identity.cookie).expect(200);
    expect(repositoryListResponseSchema.parse(search.body as unknown).items.map((item) => item.name)).toEqual(['web']);
  });

  it('returns only a user-owned repository detail with activity summary fields', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 7_001n } });
    await prisma.userRepository.update({
      where: { userId_repositoryId: { userId: identity.userId, repositoryId: repository.id } },
      data: { createdAt: new Date('2026-08-12T07:00:00.000Z') },
    });
    const contributor = await prisma.contributor.create({ data: { githubUserId: 44_001n, username: 'day4-contributor' } });
    await prisma.activityEvent.create({
      data: { sourceKey: `test:repository-detail:${repository.id}`, repositoryId: repository.id, contributorId: contributor.id, source: 'github', type: 'push', occurredAt: new Date('2026-08-12T08:00:00.000Z'), metadata: {} },
    });

    const response = await request(server).get(`/api/v1/repositories/${repository.id}`).set('Cookie', identity.cookie).expect(200);
    expect(repositoryDetailResponseSchema.parse(response.body as unknown).repository).toMatchObject({
      id: repository.id,
      lastActivityAt: '2026-08-12T08:00:00.000Z',
      contributorCount: 1,
    });
    await request(server).get('/api/v1/repositories/not-owned').set('Cookie', identity.cookie).expect(404);
    await prisma.contributor.delete({ where: { id: contributor.id } });
  });

  it('enables and disables per-user tracking idempotently with canonical POST and DELETE semantics', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 7_001n } });

    await request(server).post(`/api/v1/repositories/${repository.id}/tracking`).set('Cookie', identity.cookie).expect(403);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const enabled = await request(server).post(`/api/v1/repositories/${repository.id}/tracking`)
        .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
      expect(repositoryTrackingResponseSchema.parse(enabled.body as unknown)).toEqual({ repositoryId: repository.id, trackingEnabled: true });
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const disabled = await request(server).delete(`/api/v1/repositories/${repository.id}/tracking`)
        .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
      expect(repositoryTrackingResponseSchema.parse(disabled.body as unknown)).toEqual({ repositoryId: repository.id, trackingEnabled: false });
    }
  });

  it('removes repositories durably, stops tracking, and supports an explicit restore', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 7_001n } });
    await request(server).post(`/api/v1/repositories/${repository.id}/tracking`)
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);

    await request(server).delete(`/api/v1/repositories/${repository.id}`).set('Cookie', identity.cookie).expect(403);
    await request(server).delete(`/api/v1/repositories/${repository.id}`)
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken)
      .expect(200, { repositoryId: repository.id, trackingEnabled: false, removed: true });

    const activeAfterRemoval = await request(server).get('/api/v1/repositories').set('Cookie', identity.cookie).expect(200);
    expect(repositoryListResponseSchema.parse(activeAfterRemoval.body as unknown).items.map((item) => item.id)).not.toContain(repository.id);
    const removed = await request(server).get('/api/v1/repositories').query({ visibility: 'removed' }).set('Cookie', identity.cookie).expect(200);
    expect((removed.body as { items: Array<{ id: string; removed: boolean }> }).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: repository.id, removed: true })]),
    );

    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const stillRemoved = await request(server).get('/api/v1/repositories').set('Cookie', identity.cookie).expect(200);
    expect(repositoryListResponseSchema.parse(stillRemoved.body as unknown).items.map((item) => item.id)).not.toContain(repository.id);
    const tracking = await request(server).post(`/api/v1/repositories/${repository.id}/tracking`)
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(409);
    expect(tracking.body).toMatchObject({ code: 'REPOSITORY_REMOVED' });

    await request(server).post(`/api/v1/repositories/${repository.id}/restore`).set('Cookie', identity.cookie).expect(403);
    await request(server).post(`/api/v1/repositories/${repository.id}/restore`)
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken)
      .expect(200, { repositoryId: repository.id, trackingEnabled: false, removed: false });
    const activeAfterRestore = await request(server).get('/api/v1/repositories').set('Cookie', identity.cookie).expect(200);
    expect(repositoryListResponseSchema.parse(activeAfterRestore.body as unknown).items.map((item) => item.id)).toContain(repository.id);
    await request(server).delete('/api/v1/repositories/not-owned')
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(404);
  });

  it('fails closed when enabling tracking after repository access is removed', async () => {
    const identity = await installedIdentity();
    await request(server).post('/api/v1/repositories/sync').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const repository = await prisma.repository.findUniqueOrThrow({ where: { githubRepositoryId: 7_001n } });
    await prisma.repository.update({ where: { id: repository.id }, data: { accessRemovedAt: new Date() } });

    const response = await request(server).post(`/api/v1/repositories/${repository.id}/tracking`)
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(409);
    expect(response.body).toMatchObject({ code: 'REPOSITORY_ACCESS_REMOVED' });
    await request(server).post('/api/v1/repositories/not-owned/tracking')
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(404);
  });
});
