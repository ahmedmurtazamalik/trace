import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { authSessionResponseSchema } from '@trace/shared';
import { RedisService } from '../src/common/redis/redis.service';
import { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';
import request from 'supertest';

import { createApplication } from '../src/bootstrap';
import { applyIntegrationEnvironment } from './support/integration-environment';

const username = 'day2.auth.user';
const email = 'day2.auth@example.test';
const password = 'correct-horse-battery-staple';
const replacementPassword = 'replacement-horse-battery-staple';
let prisma: PrismaService;

function sessionCookie(response: request.Response): string {
  return setCookieHeader(response).split(';', 1)[0] ?? '';
}

function setCookieHeader(response: request.Response): string {
  const values: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  if (typeof values === 'string') {
    return values;
  }
  if (Array.isArray(values) && typeof values[0] === 'string') {
    return values[0];
  }
  throw new Error('Expected a Set-Cookie header');
}

async function removeTestUser(): Promise<void> {
  await prisma.user.deleteMany({ where: { username } });
}

describe('authentication API', () => {
  let app: INestApplication;
  let server: Server;
  let redis: RedisService;
  let rateLimits: AuthRateLimitService;

  beforeAll(async () => {
    applyIntegrationEnvironment();
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    redis = app.get(RedisService);
    rateLimits = app.get(AuthRateLimitService);
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await removeTestUser();
    await redis.flushdb();
  });

  afterAll(async () => {
    await removeTestUser();
    await app.close();
  });

  it('renews password-reset issuance ownership beyond the initial lease', async () => {
    const mutations: string[] = [];
    const first = rateLimits.withLock('lease-regression', username, 50, async (assertOwned) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (await assertOwned()) mutations.push('first-owner');
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = rateLimits.withLock('lease-regression', username, 50, async (assertOwned) => {
      if (await assertOwned()) mutations.push('new-owner');
    });

    await Promise.all([first, second]);
    expect(mutations).toEqual(['first-owner']);
  });

  it('never lets an older reset issuer retire a newer delivered token', async () => {
    await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const previous = await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: createHash('sha256').update('previous').digest('hex'), expiresAt: new Date(Date.now() + 60_000) },
    });
    const olderIssuer = await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: createHash('sha256').update('older').digest('hex'), expiresAt: new Date(Date.now() + 60_000) },
    });
    const newerIssuer = await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: createHash('sha256').update('newer').digest('hex'), expiresAt: new Date(Date.now() + 60_000) },
    });

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, id: { in: [previous.id] }, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: previous.id } })).consumedAt).not.toBeNull();
    expect(await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: olderIssuer.id } })).toMatchObject({ consumedAt: null });
    expect(await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: newerIssuer.id } })).toMatchObject({ consumedAt: null });
  });

  it('rejects form-encoded login attempts that can bypass CORS preflight', async () => {
    await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);

    const response = await request(server)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example.test')
      .type('form')
      .send({ username, password })
      .expect(400);

    expect((response.headers as Record<string, unknown>)['set-cookie']).toBeUndefined();
  });

  it('registers a user, establishes a secure session, and requires CSRF to log out', async () => {
    const registered = await request(server)
      .post('/api/v1/auth/register')
      .send({ username, displayName: 'Day Two User', email, password })
      .expect(201);
    const registeredBody = authSessionResponseSchema.parse(registered.body as unknown);

    expect(registeredBody.user).toMatchObject({ username, displayName: 'Day Two User', email });
    expect(registered.body).not.toHaveProperty('sessionToken');
    expect(registeredBody.csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(setCookieHeader(registered)).toContain('HttpOnly');
    expect(setCookieHeader(registered)).toContain('SameSite=Lax');
    expect(setCookieHeader(registered)).toContain('Path=/api/v1');

    const cookie = sessionCookie(registered);
    const current = await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(current.body as unknown).toEqual(registeredBody);

    const missingCsrf = await request(server).post('/api/v1/auth/logout').set('Cookie', cookie).expect(403);
    expect(missingCsrf.body).toEqual(expect.objectContaining({
      code: 'CSRF_INVALID',
      message: 'The CSRF token is missing or invalid.',
    }));
    expect(typeof (missingCsrf.body as Record<string, unknown>)['requestId']).toBe('string');

    const loggedOut = await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', registeredBody.csrfToken)
      .expect(200);
    expect(loggedOut.body).toEqual({ success: true });
    expect(setCookieHeader(loggedOut)).toContain('Max-Age=0');

    await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('enforces unique identity fields and generic login failures', async () => {
    await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);

    const duplicateUsername = await request(server)
      .post('/api/v1/auth/register')
      .send({ username: username.toUpperCase(), password })
      .expect(409);
    expect(duplicateUsername.body).toEqual(expect.objectContaining({ code: 'USERNAME_TAKEN' }));
    const duplicateEmail = await request(server)
      .post('/api/v1/auth/register')
      .send({ username: 'another.day2.user', email: email.toUpperCase(), password })
      .expect(409);
    expect(duplicateEmail.body).toEqual(expect.objectContaining({ code: 'EMAIL_TAKEN' }));

    const wrongPassword = await request(server)
      .post('/api/v1/auth/login')
      .send({ username, password: 'wrong-password-value' })
      .expect(401);
    const unknownUser = await request(server)
      .post('/api/v1/auth/login')
      .send({ username: 'unknown.day2.user', password: 'wrong-password-value' })
      .expect(401);
    expect(wrongPassword.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'The supplied credentials are invalid.' });
    expect(unknownUser.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'The supplied credentials are invalid.' });
  });

  it('rejects disabled users and revokes their existing sessions', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const cookie = sessionCookie(registered);
    await prisma.user.update({ where: { username }, data: { disabledAt: new Date() } });

    await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    const disabledLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(403);
    expect(disabledLogin.body).toEqual(expect.objectContaining({ code: 'ACCOUNT_DISABLED' }));
  });

  it('keeps forgot-password non-enumerating and rotates credentials atomically', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const oldCookie = sessionCookie(registered);

    const knownStartedAt = Date.now();
    const known = await request(server).post('/api/v1/auth/password/forgot').send({ identifier: email }).expect(202);
    const knownDuration = Date.now() - knownStartedAt;
    const unknownStartedAt = Date.now();
    const unknown = await request(server).post('/api/v1/auth/password/forgot').send({ identifier: 'missing@example.test' }).expect(202);
    const unknownDuration = Date.now() - unknownStartedAt;
    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual({ message: 'If the account exists, password reset instructions have been sent.' });
    expect(knownDuration).toBeGreaterThanOrEqual(200);
    expect(unknownDuration).toBeGreaterThanOrEqual(200);
    expect(Math.abs(knownDuration - unknownDuration)).toBeLessThan(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
    const requestAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.password_reset_requested', targetId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(requestAudit).toMatchObject({ actorUserId: null, targetType: 'user', targetId: user.id });

    await Promise.all([
      request(server).post('/api/v1/auth/password/forgot').send({ identifier: email }).expect(202),
      request(server).post('/api/v1/auth/password/forgot').send({ identifier: email }).expect(202),
    ]);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id, consumedAt: null } })).toBe(1);

    const rawToken = 'test-reset-token-with-at-least-thirty-two-bytes';
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const [firstReset, secondReset, racingLogin] = await Promise.all([
      request(server).post('/api/v1/auth/password/reset').send({ token: rawToken, password: replacementPassword }),
      request(server).post('/api/v1/auth/password/reset').send({ token: rawToken, password: replacementPassword }),
      request(server).post('/api/v1/auth/login').send({ username, password }),
    ]);
    expect([firstReset.status, secondReset.status].sort()).toEqual([200, 400]);
    if (racingLogin.status === 200) {
      await request(server).get('/api/v1/auth/me').set('Cookie', sessionCookie(racingLogin)).expect(401);
    } else {
      expect(racingLogin.status).toBe(401);
    }
    const rejectedReset = [firstReset, secondReset].find((response) => response.status === 400);
    expect(rejectedReset?.body).toEqual(expect.objectContaining({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' }));

    await request(server).get('/api/v1/auth/me').set('Cookie', oldCookie).expect(401);
    await request(server).post('/api/v1/auth/login').send({ username, password }).expect(401);
    await request(server).post('/api/v1/auth/login').send({ username, password: replacementPassword }).expect(200);

    const resetAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.password_reset_completed', targetId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(resetAudit).toMatchObject({ actorUserId: null, targetType: 'user', targetId: user.id });
    const replay = await request(server)
      .post('/api/v1/auth/password/reset')
      .send({ token: rawToken, password })
      .expect(400);
    expect(replay.body).toEqual(expect.objectContaining({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' }));
  });

  it('issues a development-capable reset token for an account without email', async () => {
    await request(server).post('/api/v1/auth/register').send({ username, password }).expect(201);

    const response = await request(server)
      .post('/api/v1/auth/password/forgot')
      .send({ identifier: username })
      .expect(202);
    expect(response.body).toEqual({ message: 'If the account exists, password reset instructions have been sent.' });

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(user.email).toBeNull();
    await expect(prisma.passwordResetToken.count({ where: { userId: user.id, consumedAt: null } })).resolves.toBe(1);
  });

  it('persists security-relevant audit events without raw credentials or tokens', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const registeredBody = authSessionResponseSchema.parse(registered.body as unknown);
    const cookie = sessionCookie(registered);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', registeredBody.csrfToken)
      .expect(200);
    await request(server).post('/api/v1/auth/login').send({ username, password }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const logs = await prisma.auditLog.findMany({ where: { actorUserId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((entry) => entry.action)).toEqual(expect.arrayContaining(['auth.registered', 'auth.logged_out', 'auth.logged_in']));
    const loginLog = logs.find((entry) => entry.action === 'auth.logged_in');
    expect(await prisma.userSession.findUnique({ where: { id: loginLog?.targetId ?? '' } })).toMatchObject({ userId: user.id });
    expect(JSON.stringify(logs)).not.toContain(password);
    expect(JSON.stringify(logs)).not.toContain(registeredBody.csrfToken);
    expect(JSON.stringify(logs)).not.toContain(cookie);
  });

  it('rate-limits repeated login attempts per normalized account', async () => {
    await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${attempt + 1}`)
        .send({ username, password: 'wrong-password-value' })
        .expect(401);
    }
    const limited = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.200')
      .send({ username: username.toUpperCase(), password: 'wrong-password-value' })
      .expect(429);
    expect(limited.body).toEqual(expect.objectContaining({ code: 'RATE_LIMITED' }));
  });

  it('does not create principal limiter keys after the direct-address limit is exhausted', async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ username: `missing.user.${attempt}`, password: 'wrong-password-value' });
      expect(response.status).toBe(attempt < 20 ? 401 : 429);
    }

    const principalKeys = await redis.keys('trace:auth-limit:login-account:*');
    expect(principalKeys).toHaveLength(20);
  });
});
