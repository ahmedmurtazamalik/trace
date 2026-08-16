import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { RedisService } from '../src/common/redis/redis.service';
import { githubConnectResponseSchema, githubConnectionStatusSchema } from '@trace/shared';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';

const username = 'day3.github.user';
const email = 'day3.github@example.test';
const password = 'correct-horse-battery-staple';

async function removeTestUser(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: username } }, include: { githubAccount: true } });
  for (const user of users) {
    if (user.githubAccount !== null) {
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
    }
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: username } } });
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

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://trace:trace_dev_password@localhost:5432/trace?schema=public';
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

    await request(server).delete('/api/v1/github/connection').set('Cookie', sessionCookie).expect(403);
    await request(server)
      .delete('/api/v1/github/connection')
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(200, { success: true, historyRetained: true });

    const disconnected = await request(server).get('/api/v1/github/status').set('Cookie', sessionCookie).expect(200);
    expect(disconnected.body).toMatchObject({ accountConnection: { status: 'RECONNECT_REQUIRED', account: { username: 'fake-octocat' } } });
    const actorUserId = (registered.body as { user: { id: string } }).user.id;
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
