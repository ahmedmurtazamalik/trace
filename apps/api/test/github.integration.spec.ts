import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import type { GithubAuthorizationAdapter } from '@trace/github';
import { RedisService } from '../src/common/redis/redis.service';
import { githubConnectResponseSchema, githubConnectionStatusSchema } from '@trace/shared';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';
import { GITHUB_AUTHORIZATION_ADAPTER } from '../src/modules/github/github.tokens';
import { applyIntegrationEnvironment } from './support/integration-environment';

const username = 'day3.github.user';
const email = 'day3.github@example.test';
const password = 'correct-horse-battery-staple';

async function removeTestUser(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: username } }, include: { githubAccount: { include: { installations: true } } } });
  for (const user of users) {
    await prisma.report.deleteMany({ where: { userId: user.id } });
    if (user.githubAccount !== null) {
      const installationIds = user.githubAccount.installations.map((installation) => installation.id);
      const repositoryIds = (await prisma.repository.findMany({ where: { githubInstallationId: { in: installationIds } }, select: { id: true } })).map((repository) => repository.id);
      await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.commitFile.deleteMany({ where: { commit: { repositoryId: { in: repositoryIds } } } });
      await prisma.commit.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.pushEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.userRepository.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.repository.deleteMany({ where: { id: { in: repositoryIds } } });
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
    }
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: username } } });
  await prisma.contributor.deleteMany({ where: { username: { startsWith: username } } });
}

function cookie(response: request.Response): string {
  const value: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  const header = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  return header.split(';', 1)[0] ?? '';
}

describe('GitHub connection API', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let githubAdapter: GithubAuthorizationAdapter;

  beforeAll(async () => {
    applyIntegrationEnvironment();
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    process.env.GITHUB_APP_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_APP_SLUG = 'trace-test-app';
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3001/api/v1/github/callback';
    process.env.GITHUB_INSTALLATION_CALLBACK_URL = 'http://localhost:3001/api/v1/github/installation/callback';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    githubAdapter = app.get<GithubAuthorizationAdapter>(GITHUB_AUTHORIZATION_ADAPTER);
  });

  beforeEach(async () => {
    await removeTestUser(prisma);
    await redis.flushdb();
  });

  afterAll(async () => {
    try {
      await removeTestUser(prisma);
    } finally {
      await app.close();
    }
  });

  async function registerIdentity(identity: { username: string; email: string }): Promise<{ cookie: string; csrfToken: string }> {
    const response = await request(server).post('/api/v1/auth/register').send({ ...identity, password }).expect(201);
    return { cookie: cookie(response), csrfToken: (response.body as { csrfToken: string }).csrfToken };
  }

  async function connectState(sessionCookie: string, csrfToken: string): Promise<string> {
    const response = await request(server).post('/api/v1/github/connect').set('Cookie', sessionCookie).set('X-CSRF-Token', csrfToken).expect(200);
    const state = new URL((response.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    if (state === null) throw new Error('Expected GitHub OAuth state');
    return state;
  }

  async function switchState(sessionCookie: string, csrfToken: string): Promise<string> {
    const response = await request(server).post('/api/v1/github/switch').set('Cookie', sessionCookie).set('X-CSRF-Token', csrfToken).expect(200);
    const authorizationUrl = new URL((response.body as { authorizationUrl: string }).authorizationUrl);
    expect(authorizationUrl.searchParams.get('prompt')).toBe('select_account');
    const state = authorizationUrl.searchParams.get('state');
    if (state === null) throw new Error('Expected GitHub OAuth switch state');
    return state;
  }

  it('connects through single-use state, reports separate installation status, and disconnects with CSRF', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const sessionCookie = cookie(registered);
    const csrfToken = (registered.body as { csrfToken: string }).csrfToken;

    await request(server).get('/api/v1/github/connect').set('Cookie', sessionCookie).expect(404);
    await request(server).post('/api/v1/github/connect').set('Cookie', sessionCookie).expect(403);
    const connect = await request(server).post('/api/v1/github/connect').set('Cookie', sessionCookie).set('X-CSRF-Token', csrfToken).expect(200);
    const connectBody = githubConnectResponseSchema.parse(connect.body as unknown);
    const state = new URL(connectBody.authorizationUrl).searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const callback = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', sessionCookie)
      .expect(302);
    expect(callback.headers.location).toBe('http://localhost:3000/github?result=connected');

    const replay = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', sessionCookie)
      .expect(302);
    expect(replay.headers.location).toBe('http://localhost:3000/github?result=error&reason=state_invalid');

    const status = await request(server).get('/api/v1/github/status').set('Cookie', sessionCookie).expect(200);
    expect(githubConnectionStatusSchema.parse(status.body as unknown)).toMatchObject({
      accountConnection: { status: 'CONNECTED', account: { username: 'fake-octocat' } },
      installationAuthorization: { status: 'NOT_INSTALLED', installation: null },
      historyRetained: true,
    });

    const actorUserId = (registered.body as { user: { id: string } }).user.id;
    const account = await prisma.githubAccount.findUniqueOrThrow({ where: { userId: actorUserId } });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 91_001n, githubAccountId: account.id, accountType: 'USER', accountLogin: 'fake-octocat' },
    });
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId: 71_001n,
        githubInstallationId: installation.id,
        owner: 'fake-octocat',
        name: 'tracked-before-disconnect',
        fullName: 'fake-octocat/tracked-before-disconnect',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({ data: { userId: actorUserId, repositoryId: repository.id, trackingEnabled: true } });
    const contributor = await prisma.contributor.create({
      data: { githubUserId: 71_002n, username: `${username}.contributor`, displayName: 'Retained Contributor' },
    });
    const push = await prisma.pushEvent.create({
      data: {
        repositoryId: repository.id,
        githubDeliveryId: 'day14-disconnect-retained-delivery',
        ref: 'refs/heads/main',
        beforeSha: 'a'.repeat(40),
        afterSha: 'b'.repeat(40),
        senderContributorId: contributor.id,
      },
    });
    const commit = await prisma.commit.create({
      data: {
        repositoryId: repository.id,
        sha: 'b'.repeat(40),
        message: 'Retained after disconnect',
        authorName: 'Retained Contributor',
        authorEmail: 'retained@example.test',
        authorUsername: contributor.username,
        committerName: 'Retained Contributor',
        committerEmail: 'retained@example.test',
        committerUsername: contributor.username,
        authorContributorId: contributor.id,
        committerContributorId: contributor.id,
        authoredAt: new Date('2026-08-17T08:00:00.000Z'),
        committedAt: new Date('2026-08-17T08:01:00.000Z'),
        branch: 'main',
        additions: 4,
        deletions: 1,
        changedFiles: 1,
      },
    });
    const file = await prisma.commitFile.create({
      data: { commitId: commit.id, path: 'src/retained.ts', status: 'modified', additions: 4, deletions: 1 },
    });
    const activity = await prisma.activityEvent.create({
      data: {
        sourceKey: 'github:disconnect-retained',
        repositoryId: repository.id,
        contributorId: contributor.id,
        source: 'github',
        type: 'commit',
        occurredAt: new Date('2026-08-17T08:01:00.000Z'),
        metadata: { sha: commit.sha },
      },
    });
    const report = await prisma.report.create({
      data: {
        userId: actorUserId,
        reportDate: new Date('2026-08-17T00:00:00.000Z'),
        timezone: 'UTC',
        inputSnapshot: { repositoryIds: [repository.id], activityIds: [activity.id] },
      },
    });

    await request(server).delete('/api/v1/github/connection').set('Cookie', sessionCookie).expect(403);
    await request(server)
      .delete('/api/v1/github/connection')
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(200, { success: true, historyRetained: true });

    await expect(prisma.userRepository.findUniqueOrThrow({
      where: { userId_repositoryId: { userId: actorUserId, repositoryId: repository.id } },
    })).resolves.toMatchObject({ trackingEnabled: false });
    await expect(prisma.contributor.findUnique({ where: { id: contributor.id } })).resolves.not.toBeNull();
    await expect(prisma.pushEvent.findUnique({ where: { id: push.id } })).resolves.toMatchObject({ repositoryId: repository.id });
    await expect(prisma.commit.findUnique({ where: { id: commit.id } })).resolves.toMatchObject({ repositoryId: repository.id });
    await expect(prisma.commitFile.findUnique({ where: { id: file.id } })).resolves.toMatchObject({ commitId: commit.id });
    await expect(prisma.activityEvent.findUnique({ where: { id: activity.id } })).resolves.toMatchObject({ repositoryId: repository.id });
    await expect(prisma.report.findUnique({ where: { id: report.id } })).resolves.toMatchObject({
      userId: actorUserId,
      inputSnapshot: { repositoryIds: [repository.id], activityIds: [activity.id] },
    });

    const disconnected = await request(server).get('/api/v1/github/status').set('Cookie', sessionCookie).expect(200);
    expect(disconnected.body).toMatchObject({ accountConnection: { status: 'RECONNECT_REQUIRED', account: { username: 'fake-octocat' } } });
    const actions = (await prisma.auditLog.findMany({ where: { actorUserId }, select: { action: true } })).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['github.connected', 'github.disconnected']));
  });

  it('binds single-use state to the originating live Trace session and closes provider failures', async () => {
    const first = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const firstCookie = cookie(first);
    const firstCsrf = (first.body as { csrfToken: string }).csrfToken;
    const connect = await request(server).post('/api/v1/github/connect').set('Cookie', firstCookie).set('X-CSRF-Token', firstCsrf).expect(200);
    const state = new URL((connect.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');

    const withoutSession = await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state }).expect(302);
    expect(withoutSession.headers.location).toBe('http://localhost:3000/github?result=error&reason=session_expired');

    const sameUserLogin = await request(server).post('/api/v1/auth/login').send({ username, password }).expect(200);
    const wrongSameUserSession = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', cookie(sameUserLogin))
      .expect(302);
    expect(wrongSameUserSession.headers.location).toBe('http://localhost:3000/github?result=error&reason=state_invalid');

    const second = await request(server)
      .post('/api/v1/auth/register')
      .send({ username: `${username}.other`, email: `other.${email}`, password })
      .expect(201);
    const wrongSession = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', cookie(second))
      .expect(302);
    expect(wrongSession.headers.location).toBe('http://localhost:3000/github?result=error&reason=state_invalid');

    const invalidCode = await request(server).post('/api/v1/github/connect').set('Cookie', firstCookie).set('X-CSRF-Token', firstCsrf).expect(200);
    const invalidState = new URL((invalidCode.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    const failed = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-invalid-code', state: invalidState })
      .set('Cookie', firstCookie)
      .expect(302);
    expect(failed.headers.location).toBe('http://localhost:3000/github?result=error&reason=callback_failed');

    const deniedConnect = await request(server).post('/api/v1/github/connect').set('Cookie', firstCookie).set('X-CSRF-Token', firstCsrf).expect(200);
    const deniedState = new URL((deniedConnect.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    const denied = await request(server)
      .get('/api/v1/github/callback')
      .query({ error: 'access_denied', state: deniedState })
      .set('Cookie', firstCookie)
      .expect(302);
    expect(denied.headers.location).toBe('http://localhost:3000/github?result=error&reason=access_denied');
  });

  it('reports GitHub App installation authorization independently from account connection', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const sessionCookie = cookie(registered);
    const csrfToken = (registered.body as { csrfToken: string }).csrfToken;
    const connect = await request(server).post('/api/v1/github/connect').set('Cookie', sessionCookie).set('X-CSRF-Token', csrfToken).expect(200);
    const state = new URL((connect.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', sessionCookie)
      .expect(302);
    await request(server).post('/api/v1/github/installation').set('Cookie', sessionCookie).expect(403);
    const installationStart = await request(server).post('/api/v1/github/installation').set('Cookie', sessionCookie).set('X-CSRF-Token', csrfToken).expect(200);
    expect(installationStart.body).toMatchObject({ outcome: 'INSTALL_REQUIRED' });
    const installationState = new URL((installationStart.body as { installationUrl: string }).installationUrl).searchParams.get('state');
    const setupCallback = await request(server)
      .get('/api/v1/github/installation/callback')
      .query({ installation_id: '91', setup_action: 'install', state: installationState })
      .set('Cookie', sessionCookie)
      .expect(302);
    const verificationState = new URL(setupCallback.headers.location as string).searchParams.get('state');
    expect(setupCallback.headers.location).toContain('https://github.com/login/oauth/authorize');
    await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-installation-verification-code', state: verificationState })
      .set('Cookie', sessionCookie)
      .expect(302);
    const status = await request(server).get('/api/v1/github/status').set('Cookie', sessionCookie).expect(200);
    expect(status.body).toMatchObject({
      accountConnection: { status: 'CONNECTED' },
      installationAuthorization: { status: 'ACTIVE', installation: { accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org' } },
    });
    expect(JSON.stringify(status.body)).not.toMatch(/token|secret/i);
  });

  it('continues to authoritative user verification when the immediate App installation lookup is not yet consistent', async () => {
    const identity = await registerIdentity({ username, email });
    const oauthState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: oauthState }).set('Cookie', identity.cookie).expect(302);

    const start = await request(server).post('/api/v1/github/installation').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const setupState = new URL((start.body as { installationUrl: string }).installationUrl).searchParams.get('state');
    const originalInstallation = githubAdapter.installation.bind(githubAdapter);
    githubAdapter.installation = () => Promise.reject(new Error('GitHub installation lookup is not yet consistent'));
    const setup = await request(server).get('/api/v1/github/installation/callback')
      .query({ installation_id: '91', setup_action: 'install', state: setupState }).set('Cookie', identity.cookie).expect(302);
    githubAdapter.installation = originalInstallation;

    expect(setup.headers.location).toContain('https://github.com/login/oauth/authorize');
    const verificationState = new URL(setup.headers.location as string).searchParams.get('state');
    const verification = await request(server).get('/api/v1/github/callback')
      .query({ code: 'fake-installation-verification-code', state: verificationState }).set('Cookie', identity.cookie).expect(302);
    expect(verification.headers.location).toBe('http://localhost:3000/github?result=connected');
    const status = await request(server).get('/api/v1/github/status').set('Cookie', identity.cookie).expect(200);
    expect(status.body).toMatchObject({ installationAuthorization: { status: 'ACTIVE' } });
  });

  it('recognizes an existing personal installation instead of returning to the GitHub Configure page', async () => {
    const identity = await registerIdentity({ username, email });
    const oauthState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: oauthState }).set('Cookie', identity.cookie).expect(302);

    const adapterWithDiscovery = githubAdapter as GithubAuthorizationAdapter & {
      installationForUser: (githubUserId: bigint) => Promise<{ id: bigint; accountType: 'USER'; accountLogin: string; suspended: boolean } | null>;
    };
    adapterWithDiscovery.installationForUser = (githubUserId) => Promise.resolve(githubUserId === 583_231n
      ? { id: 91n, accountType: 'USER', accountLogin: 'fake-octocat', suspended: false }
      : null);
    const start = await request(server).post('/api/v1/github/installation')
      .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    delete (adapterWithDiscovery as Partial<typeof adapterWithDiscovery>).installationForUser;

    expect(start.body).toEqual({ outcome: 'CONNECTED' });
    const status = await request(server).get('/api/v1/github/status').set('Cookie', identity.cookie).expect(200);
    expect(status.body).toMatchObject({
      accountConnection: { status: 'CONNECTED' },
      installationAuthorization: { status: 'ACTIVE', installation: { accountType: 'USER', accountLogin: 'fake-octocat' } },
    });
  });

  it('rejects stale installation discovery after a concurrent GitHub identity switch', async () => {
    const identity = await registerIdentity({ username, email });
    const oauthState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: oauthState }).set('Cookie', identity.cookie).expect(302);
    const switchOauthState = await switchState(identity.cookie, identity.csrfToken);

    const adapterWithDiscovery = githubAdapter as GithubAuthorizationAdapter & {
      installationForUser: (githubUserId: bigint) => Promise<{ id: bigint; accountType: 'USER'; accountLogin: string; suspended: boolean } | null>;
    };
    let signalDiscoveryStarted!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => { signalDiscoveryStarted = resolve; });
    let releaseDiscovery!: () => void;
    const discoveryRelease = new Promise<void>((resolve) => { releaseDiscovery = resolve; });
    adapterWithDiscovery.installationForUser = async (githubUserId) => {
      signalDiscoveryStarted();
      await discoveryRelease;
      return githubUserId === 583_231n
        ? { id: 91n, accountType: 'USER', accountLogin: 'fake-octocat', suspended: false }
        : null;
    };

    try {
      const installationRequest = Promise.resolve(request(server).post('/api/v1/github/installation')
        .set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200));
      await discoveryStarted;
      const switched = await request(server).get('/api/v1/github/callback')
        .query({ code: 'fake-switch-code', state: switchOauthState }).set('Cookie', identity.cookie).expect(302);
      expect(switched.headers.location).toBe('http://localhost:3000/github?result=connected');
      releaseDiscovery();
      const installation = await installationRequest;

      const installationBody = installation.body as { outcome: unknown; installationUrl: unknown };
      expect(installationBody.outcome).toBe('INSTALL_REQUIRED');
      expect(installationBody.installationUrl).toEqual(expect.stringMatching(/^https:\/\/github\.com\/apps\//));
      const user = await prisma.user.findUniqueOrThrow({ where: { username } });
      const account = await prisma.githubAccount.findUniqueOrThrow({ where: { userId: user.id } });
      expect(account).toMatchObject({ githubUserId: 583_232n, githubUsername: 'fake-switcher' });
      await expect(prisma.githubInstallation.findUnique({ where: { githubInstallationId: 91n } })).resolves.toBeNull();
    } finally {
      releaseDiscovery();
      delete (adapterWithDiscovery as Partial<typeof adapterWithDiscovery>).installationForUser;
    }
  });

  it('rejects a substituted installation id unless the linked GitHub user can access it', async () => {
    const identity = await registerIdentity({ username, email });
    const oauthState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: oauthState }).set('Cookie', identity.cookie).expect(302);
    const start = await request(server).post('/api/v1/github/installation').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const setupState = new URL((start.body as { installationUrl: string }).installationUrl).searchParams.get('state');
    const setup = await request(server).get('/api/v1/github/installation/callback')
      .query({ installation_id: '999', setup_action: 'install', state: setupState }).set('Cookie', identity.cookie).expect(302);
    const verificationState = new URL(setup.headers.location as string).searchParams.get('state');
    const verification = await request(server).get('/api/v1/github/callback')
      .query({ code: 'fake-installation-verification-code', state: verificationState }).set('Cookie', identity.cookie).expect(302);
    expect(verification.headers.location).toBe('http://localhost:3000/github?result=error&reason=callback_failed');
    const status = await request(server).get('/api/v1/github/status').set('Cookie', identity.cookie).expect(200);
    expect(status.body).toMatchObject({ installationAuthorization: { status: 'NOT_INSTALLED', installation: null } });
  });

  it('reports reconnect required after disconnect and connected after a successful reconnect', async () => {
    const identity = await registerIdentity({ username, email });
    const firstState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: firstState }).set('Cookie', identity.cookie).expect(302);
    await request(server).delete('/api/v1/github/connection').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    const disconnected = await request(server).get('/api/v1/github/status').set('Cookie', identity.cookie).expect(200);
    expect(disconnected.body).toMatchObject({ accountConnection: { status: 'RECONNECT_REQUIRED', account: { username: 'fake-octocat' } } });
    const reconnectState = await connectState(identity.cookie, identity.csrfToken);
    const reconnected = await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: reconnectState }).set('Cookie', identity.cookie).expect(302);
    expect(reconnected.headers.location).toBe('http://localhost:3000/github?result=connected');
    const status = await request(server).get('/api/v1/github/status').set('Cookie', identity.cookie).expect(200);
    expect(status.body).toMatchObject({ accountConnection: { status: 'CONNECTED' } });
  });

  it('rejects a different GitHub identity during an ordinary reconnect', async () => {
    const identity = await registerIdentity({ username, email });
    const initialState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: initialState }).set('Cookie', identity.cookie).expect(302);
    await request(server).delete('/api/v1/github/connection').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);

    const reconnectState = await connectState(identity.cookie, identity.csrfToken);
    const rejected = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-switch-code', state: reconnectState })
      .set('Cookie', identity.cookie)
      .expect(302);

    const rejectedLocation = new URL(rejected.headers.location as string);
    expect(rejectedLocation.searchParams.get('result')).toBe('error');
    expect(rejectedLocation.searchParams.get('reason')).toBe('callback_failed');
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const rejectedAccount = await prisma.githubAccount.findUniqueOrThrow({ where: { userId: user.id } });
    expect(rejectedAccount).toMatchObject({
      githubUserId: 583_231n,
      githubUsername: 'fake-octocat',
    });
    expect(rejectedAccount.unlinkedAt).toBeInstanceOf(Date);
  });

  it('switches verified GitHub identity atomically while retaining old repository history', async () => {
    const identity = await registerIdentity({ username, email });
    const initialState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: initialState }).set('Cookie', identity.cookie).expect(302);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const account = await prisma.githubAccount.findUniqueOrThrow({ where: { userId: user.id } });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 92_001n, githubAccountId: account.id, accountType: 'USER', accountLogin: 'fake-octocat' },
    });
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId: 72_001n,
        githubInstallationId: installation.id,
        owner: 'fake-octocat',
        name: 'retained-after-switch',
        fullName: 'fake-octocat/retained-after-switch',
        private: true,
        defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({ data: { userId: user.id, repositoryId: repository.id, trackingEnabled: true } });
    const activity = await prisma.activityEvent.create({
      data: { sourceKey: 'github:switch-retained', repositoryId: repository.id, source: 'github', type: 'commit', occurredAt: new Date('2026-08-17T08:00:00.000Z'), metadata: { sha: 'retained' } },
    });

    const switchedState = await switchState(identity.cookie, identity.csrfToken);
    const switched = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-switch-code', state: switchedState })
      .set('Cookie', identity.cookie)
      .expect(302);
    expect(switched.headers.location).toBe('http://localhost:3000/github?result=connected');

    await expect(prisma.githubAccount.findUniqueOrThrow({ where: { id: account.id } })).resolves.toMatchObject({
      githubUserId: 583_232n,
      githubUsername: 'fake-switcher',
      unlinkedAt: null,
    });
    const oldInstallation = await prisma.githubInstallation.findUniqueOrThrow({ where: { id: installation.id } });
    expect(oldInstallation.suspendedAt).toBeInstanceOf(Date);
    const oldMembership = await prisma.userRepository.findUniqueOrThrow({ where: { userId_repositoryId: { userId: user.id, repositoryId: repository.id } } });
    expect(oldMembership.trackingEnabled).toBe(false);
    expect(oldMembership.accessRemovedAt).toBeInstanceOf(Date);
    await expect(prisma.repository.findUnique({ where: { id: repository.id } })).resolves.not.toBeNull();
    await expect(prisma.activityEvent.findUnique({ where: { id: activity.id } })).resolves.not.toBeNull();

    const status = await request(server).get('/api/v1/github/status').set('Cookie', identity.cookie).expect(200);
    expect(status.body).toMatchObject({
      accountConnection: { status: 'CONNECTED', account: { username: 'fake-switcher' } },
      installationAuthorization: { status: 'SUSPENDED' },
      accessibleRepositoryCount: 0,
      trackedRepositoryCount: 0,
      historyRetained: true,
    });
    const switchAudit = await prisma.auditLog.findFirst({ where: { actorUserId: user.id, action: 'github.account_switched' } });
    expect(switchAudit?.targetId).toBe(account.id);
    expect(switchAudit?.metadata).toMatchObject({ previousGithubUsername: 'fake-octocat', newGithubUsername: 'fake-switcher', disabledRepositoryCount: 1 });

    const other = await registerIdentity({ username: `${username}.other`, email: `other.${email}` });
    const otherState = await connectState(other.cookie, other.csrfToken);
    const conflict = await request(server).get('/api/v1/github/callback').query({ code: 'fake-switch-code', state: otherState }).set('Cookie', other.cookie).expect(302);
    expect(conflict.headers.location).toBe('http://localhost:3000/github?result=error&reason=callback_failed');
  });

  it('invalidates superseded switch states so a stale callback cannot switch the account back', async () => {
    const identity = await registerIdentity({ username, email });
    const initialState = await connectState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: initialState }).set('Cookie', identity.cookie).expect(302);

    const staleState = await switchState(identity.cookie, identity.csrfToken);
    const currentState = await switchState(identity.cookie, identity.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-switch-code', state: currentState }).set('Cookie', identity.cookie).expect(302);
    const stale = await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: staleState }).set('Cookie', identity.cookie).expect(302);

    const staleLocation = new URL(stale.headers.location as string);
    expect(staleLocation.searchParams.get('result')).toBe('error');
    expect(staleLocation.searchParams.get('reason')).toBe('state_invalid');
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    await expect(prisma.githubAccount.findUniqueOrThrow({ where: { userId: user.id } })).resolves.toMatchObject({
      githubUserId: 583_232n,
      githubUsername: 'fake-switcher',
      unlinkedAt: null,
    });
  });

  it('rate limits GitHub linking by direct address and user', async () => {
    const identity = await registerIdentity({ username, email });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(server).post('/api/v1/github/connect').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(200);
    }
    await request(server).post('/api/v1/github/connect').set('Cookie', identity.cookie).set('X-CSRF-Token', identity.csrfToken).expect(429);
  });

  it('does not let another Trace user claim an already linked GitHub account', async () => {
    const first = await registerIdentity({ username, email });
    const firstState = await connectState(first.cookie, first.csrfToken);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: firstState }).set('Cookie', first.cookie).expect(302);

    const second = await registerIdentity({ username: `${username}.other`, email: `other.${email}` });
    const secondState = await connectState(second.cookie, second.csrfToken);
    const conflict = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state: secondState })
      .set('Cookie', second.cookie)
      .expect(302);
    expect(conflict.headers.location).toBe('http://localhost:3000/github?result=error&reason=callback_failed');
    const secondStatus = await request(server).get('/api/v1/github/status').set('Cookie', second.cookie).expect(200);
    expect(secondStatus.body).toMatchObject({ accountConnection: { status: 'DISCONNECTED', account: null } });
  });
});
