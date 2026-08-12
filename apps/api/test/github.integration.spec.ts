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
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    process.env.GITHUB_APP_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3001/api/v1/github/callback';
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

  async function connectState(sessionCookie: string): Promise<string> {
    const response = await request(server).get('/api/v1/github/connect').set('Cookie', sessionCookie).expect(200);
    const state = new URL((response.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    if (state === null) throw new Error('Expected GitHub OAuth state');
    return state;
  }

  it('connects through single-use state, reports separate installation status, and disconnects with CSRF', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const sessionCookie = cookie(registered);
    const csrfToken = (registered.body as { csrfToken: string }).csrfToken;

    const connect = await request(server).get('/api/v1/github/connect').set('Cookie', sessionCookie).expect(200);
    const connectBody = githubConnectResponseSchema.parse(connect.body as unknown);
    const state = new URL(connectBody.authorizationUrl).searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const callback = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', sessionCookie)
      .expect(302);
    expect(callback.headers.location).toBe('http://localhost:3000/settings/github?result=connected');

    const replay = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', sessionCookie)
      .expect(302);
    expect(replay.headers.location).toBe('http://localhost:3000/settings/github?result=error&reason=state_invalid');

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
    expect(disconnected.body).toMatchObject({ accountConnection: { status: 'DISCONNECTED', account: null } });
  });

  it('binds single-use state to the originating live Trace session and closes provider failures', async () => {
    const first = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const firstCookie = cookie(first);
    const connect = await request(server).get('/api/v1/github/connect').set('Cookie', firstCookie).expect(200);
    const state = new URL((connect.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');

    const withoutSession = await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state }).expect(302);
    expect(withoutSession.headers.location).toBe('http://localhost:3000/settings/github?result=error&reason=session_expired');

    const second = await request(server)
      .post('/api/v1/auth/register')
      .send({ username: `${username}.other`, email: `other.${email}`, password })
      .expect(201);
    const wrongSession = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state })
      .set('Cookie', cookie(second))
      .expect(302);
    expect(wrongSession.headers.location).toBe('http://localhost:3000/settings/github?result=error&reason=state_invalid');

    const invalidCode = await request(server).get('/api/v1/github/connect').set('Cookie', firstCookie).expect(200);
    const invalidState = new URL((invalidCode.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    const failed = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-invalid-code', state: invalidState })
      .set('Cookie', firstCookie)
      .expect(302);
    expect(failed.headers.location).toBe('http://localhost:3000/settings/github?result=error&reason=callback_failed');

    const deniedConnect = await request(server).get('/api/v1/github/connect').set('Cookie', firstCookie).expect(200);
    const deniedState = new URL((deniedConnect.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    const denied = await request(server)
      .get('/api/v1/github/callback')
      .query({ error: 'access_denied', state: deniedState })
      .set('Cookie', firstCookie)
      .expect(302);
    expect(denied.headers.location).toBe('http://localhost:3000/settings/github?result=error&reason=access_denied');
  });

  it('reports GitHub App installation authorization independently from account connection', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const sessionCookie = cookie(registered);
    const connect = await request(server).get('/api/v1/github/connect').set('Cookie', sessionCookie).expect(200);
    const state = new URL((connect.body as { authorizationUrl: string }).authorizationUrl).searchParams.get('state');
    await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-installation-code', state })
      .set('Cookie', sessionCookie)
      .expect(302);
    const status = await request(server).get('/api/v1/github/status').set('Cookie', sessionCookie).expect(200);
    expect(status.body).toMatchObject({
      accountConnection: { status: 'CONNECTED' },
      installationAuthorization: { status: 'ACTIVE', installation: { accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org' } },
    });
    expect(JSON.stringify(status.body)).not.toMatch(/token|secret/i);
  });

  it('does not let another Trace user claim an already linked GitHub account', async () => {
    const first = await registerIdentity({ username, email });
    const firstState = await connectState(first.cookie);
    await request(server).get('/api/v1/github/callback').query({ code: 'fake-success-code', state: firstState }).set('Cookie', first.cookie).expect(302);

    const second = await registerIdentity({ username: `${username}.other`, email: `other.${email}` });
    const secondState = await connectState(second.cookie);
    const conflict = await request(server)
      .get('/api/v1/github/callback')
      .query({ code: 'fake-success-code', state: secondState })
      .set('Cookie', second.cookie)
      .expect(302);
    expect(conflict.headers.location).toBe('http://localhost:3000/settings/github?result=error&reason=callback_failed');
    const secondStatus = await request(server).get('/api/v1/github/status').set('Cookie', second.cookie).expect(200);
    expect(secondStatus.body).toMatchObject({ accountConnection: { status: 'DISCONNECTED', account: null } });
  });
});
