import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { reportCreateResponseSchema, reportDetailResponseSchema, reportListResponseSchema } from '@trace/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import { RedisService } from '../src/common/redis/redis.service';
import { createApplication } from '../src/bootstrap';
import { ReportPublisher } from '../src/modules/reports/report.publisher';
import { ReportQueue } from '../src/modules/reports/report.queue';

const username = 'day8.report.user';
const email = 'day8.report@example.test';
const password = 'correct-horse-battery-staple';
const otherUsername = 'day8.report.other';
const otherEmail = 'day8.report.other@example.test';

function cookie(response: request.Response): string {
  const value: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  const header = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  return header.split(';', 1)[0] ?? '';
}

function csrfToken(response: request.Response): string {
  return (response.body as { csrfToken: string }).csrfToken;
}

describe('Reports API', () => {
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
    const other = await prisma.user.findUnique({ where: { username: otherUsername } });
    if (other !== null) {
      await prisma.report.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
    const user = await prisma.user.findUnique({
      where: { username },
      include: { githubAccount: { include: { installations: true } } },
    });
    if (user === null) return;
    await prisma.reportArtifact.deleteMany({ where: { report: { userId: user.id } } });
    await prisma.reportRevision.deleteMany({ where: { report: { userId: user.id } } });
    await prisma.report.deleteMany({ where: { userId: user.id } });
    if (user.githubAccount !== null) {
      const installationIds = user.githubAccount.installations.map((installation) => installation.id);
      const repositoryIds = (await prisma.repository.findMany({
        where: { githubInstallationId: { in: installationIds } },
        select: { id: true },
      })).map((repository) => repository.id);
      await prisma.activityEvent.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.userRepository.deleteMany({ where: { repositoryId: { in: repositoryIds } } });
      await prisma.repository.deleteMany({ where: { id: { in: repositoryIds } } });
      await prisma.githubInstallation.deleteMany({ where: { githubAccountId: user.githubAccount.id } });
      await prisma.githubAccount.delete({ where: { id: user.githubAccount.id } });
    }
    await prisma.contributor.deleteMany({ where: { username: { startsWith: 'day8-report-' } } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  it('persists one immutable pending report input from authorized activity on the requested local day', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId: 880_001n, githubUsername: 'day8-report-user' },
    });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 880_002n, githubAccountId: account.id, accountType: 'ORGANIZATION', accountLogin: 'day8-org' },
    });
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId: 880_003n,
        githubInstallationId: installation.id,
        owner: 'day8-org',
        name: 'report-pipeline',
        fullName: 'day8-org/report-pipeline',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/day8-org/report-pipeline',
      },
    });
    await prisma.userRepository.create({
      data: {
        userId: user.id,
        repositoryId: repository.id,
        trackingEnabled: true,
        createdAt: new Date('2026-08-12T00:00:00.000Z'),
      },
    });
    const contributor = await prisma.contributor.create({
      data: { githubUserId: 880_004n, username: 'day8-report-contributor', displayName: 'Day 8 Contributor' },
    });
    const commitActivity = await prisma.activityEvent.create({
      data: {
        sourceKey: `day8:commit:${repository.id}`,
        repositoryId: repository.id,
        contributorId: contributor.id,
        source: 'github',
        type: 'commit',
        occurredAt: new Date('2026-08-12T20:30:00.000Z'),
        metadata: { sha: '8'.repeat(40), message: 'Build report facts', branch: 'main', changedFiles: 3, additions: 11, deletions: 4 },
      },
    });
    await prisma.activityEvent.createMany({
      data: [
        {
          sourceKey: `day8:push:${repository.id}`,
          repositoryId: repository.id,
          contributorId: contributor.id,
          source: 'github',
          type: 'push',
          occurredAt: new Date('2026-08-12T20:31:00.000Z'),
          metadata: { ref: 'refs/heads/main' },
        },
        {
          sourceKey: `day8:outside:${repository.id}`,
          repositoryId: repository.id,
          contributorId: contributor.id,
          source: 'github',
          type: 'commit',
          occurredAt: new Date('2026-08-13T19:00:00.000Z'),
          metadata: { sha: '9'.repeat(40), message: 'Outside local day', branch: 'main', changedFiles: 99, additions: 99, deletions: 99 },
        },
      ],
    });

    const response = await request(server)
      .post('/api/v1/reports')
      .set('Cookie', cookie(registered))
      .set('X-CSRF-Token', csrfToken(registered))
      .send({ reportDate: '2026-08-13', timezone: 'Asia/Karachi' })
      .expect(201);
    const body = reportCreateResponseSchema.parse(response.body as unknown);
    expect(body.report).toMatchObject({
      reportDate: '2026-08-13',
      timezone: 'Asia/Karachi',
      status: 'pending',
      completedAt: null,
      errorMessage: null,
      revision: null,
      downloadAvailable: false,
    });

    const reports = await prisma.report.findMany({ where: { userId: user.id } });
    expect(reports).toHaveLength(1);
    expect(reports[0]?.publishedAt).toBeInstanceOf(Date);
    expect(reports[0]?.inputSnapshot).toEqual({
      version: 1,
      reportDate: '2026-08-13',
      timezone: 'Asia/Karachi',
      facts: {
        repositoryCount: 1,
        contributorCount: 1,
        commitCount: 1,
        filesChanged: 3,
        additions: 11,
        deletions: 4,
      },
      repositories: [{
        id: repository.id,
        fullName: 'day8-org/report-pipeline',
        facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 3, additions: 11, deletions: 4 },
        contributors: [{
          id: contributor.id,
          username: 'day8-report-contributor',
          displayName: 'Day 8 Contributor',
          facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 3, additions: 11, deletions: 4 },
        }],
        evidence: [{
          activityId: commitActivity.id,
          occurredAt: '2026-08-12T20:30:00.000Z',
          type: 'commit',
          sha: '8'.repeat(40),
          message: 'Build report facts',
        }],
      }],
    });
    const queue = new Queue('report-generation', { connection: { url: process.env.REDIS_URL! } });
    try {
      const job = await queue.getJob(`report-${reports[0]!.id}`);
      expect(job?.id).toBe(`report-${reports[0]!.id}`);
      expect(job?.name).toBe('generate-report');
      expect(job?.data).toEqual({ reportId: reports[0]!.id });
    } finally {
      await queue.close();
    }
  });

  it('lists and reads only owned reports with stable filter-bound pagination', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const owner = await prisma.user.findUniqueOrThrow({ where: { username } });
    await request(server).post('/api/v1/auth/register').send({
      username: otherUsername,
      email: otherEmail,
      password,
    }).expect(201);
    const other = await prisma.user.findUniqueOrThrow({ where: { username: otherUsername } });
    const emptySnapshot = {
      version: 1,
      reportDate: '2026-08-10',
      timezone: 'UTC',
      facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
      repositories: [],
    };
    const owned = await Promise.all([
      ['2026-08-10', new Date('2026-08-10T10:00:00.000Z')],
      ['2026-08-11', new Date('2026-08-11T10:00:00.000Z')],
      ['2026-08-12', new Date('2026-08-12T10:00:00.000Z')],
    ].map(async ([date, createdAt]) => prisma.report.create({
      data: {
        userId: owner.id,
        reportDate: new Date(`${date as string}T00:00:00.000Z`),
        timezone: 'UTC',
        status: 'pending',
        inputSnapshot: { ...emptySnapshot, reportDate: date as string },
        createdAt: createdAt as Date,
      },
    })));
    const foreign = await prisma.report.create({
      data: {
        userId: other.id,
        reportDate: new Date('2026-08-12T00:00:00.000Z'),
        timezone: 'UTC',
        status: 'pending',
        inputSnapshot: { ...emptySnapshot, reportDate: '2026-08-12' },
      },
    });

    const firstResponse = await request(server).get('/api/v1/reports')
      .query({ status: 'pending', limit: 1 }).set('Cookie', cookie(registered)).expect(200);
    const first = reportListResponseSchema.parse(firstResponse.body as unknown);
    expect(first.items.map((report) => report.id)).toEqual([owned[2]!.id]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(first.pageInfo.nextCursor).not.toBeNull();

    const secondResponse = await request(server).get('/api/v1/reports')
      .query({ status: 'pending', limit: 1, cursor: first.pageInfo.nextCursor })
      .set('Cookie', cookie(registered)).expect(200);
    const second = reportListResponseSchema.parse(secondResponse.body as unknown);
    expect(second.items.map((report) => report.id)).toEqual([owned[1]!.id]);

    await request(server).get('/api/v1/reports')
      .query({ limit: 2, cursor: first.pageInfo.nextCursor })
      .set('Cookie', cookie(registered)).expect(400);

    const detailResponse = await request(server).get(`/api/v1/reports/${owned[0]!.id}`)
      .set('Cookie', cookie(registered)).expect(200);
    const detail = reportDetailResponseSchema.parse(detailResponse.body as unknown);
    expect(detail.report).toMatchObject({
      id: owned[0]!.id,
      reportDate: '2026-08-10',
      status: 'pending',
      revision: null,
      revisionSource: null,
      content: null,
      facts: emptySnapshot.facts,
      artifacts: [],
      downloadAvailable: false,
    });
    const foreignResponse = await request(server).get(`/api/v1/reports/${foreign.id}`)
      .set('Cookie', cookie(registered)).expect(404);
    expect(foreignResponse.body).toMatchObject({
      code: 'REPORT_NOT_FOUND',
      message: 'Report not found.',
    });
  });

  it('rejects duplicate report dates and recovers an unpublished pending report exactly once', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const owner = await prisma.user.findUniqueOrThrow({ where: { username } });
    const snapshot = {
      version: 1,
      reportDate: '2026-08-09',
      timezone: 'UTC',
      facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
      repositories: [],
    };
    const report = await prisma.report.create({
      data: {
        userId: owner.id,
        reportDate: new Date('2026-08-09T00:00:00.000Z'),
        timezone: 'UTC',
        status: 'pending',
        inputSnapshot: snapshot,
        publishedAt: null,
      },
    });

    const duplicate = await request(server).post('/api/v1/reports')
      .set('Cookie', cookie(registered))
      .set('X-CSRF-Token', csrfToken(registered))
      .send({ reportDate: '2026-08-09', timezone: 'UTC' })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      code: 'REPORT_ALREADY_EXISTS',
      message: 'A report already exists for this date.',
    });

    const publisher = app.get(ReportPublisher);
    await Promise.all([publisher.publishOwed(), publisher.publishOwed()]);
    await publisher.publishOwed();
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).publishedAt).toBeInstanceOf(Date);

    const queue = new Queue('report-generation', { connection: { url: process.env.REDIS_URL! } });
    try {
      const job = await queue.getJob(`report-${report.id}`);
      expect(job).toMatchObject({
        id: `report-${report.id}`,
        name: 'generate-report',
        data: { reportId: report.id },
      });
    } finally {
      await queue.close();
    }
  });

  it('requires the session CSRF token for report creation', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const body = { reportDate: '2026-08-08', timezone: 'UTC' };

    const missing = await request(server).post('/api/v1/reports')
      .set('Cookie', cookie(registered)).send(body).expect(403);
    expect(missing.body).toMatchObject({ code: 'CSRF_INVALID' });
    const invalid = await request(server).post('/api/v1/reports')
      .set('Cookie', cookie(registered)).set('X-CSRF-Token', 'invalid-token').send(body).expect(403);
    expect(invalid.body).toMatchObject({ code: 'CSRF_INVALID' });
    expect(await prisma.report.count({ where: { user: { username } } })).toBe(0);
  });

  it('keeps the report durable when queue publication fails and reconciles it later', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const reportQueue = app.get(ReportQueue);
    const enqueue = jest.spyOn(reportQueue, 'enqueue').mockRejectedValueOnce(new Error('Redis unavailable'));

    const created = await request(server).post('/api/v1/reports')
      .set('Cookie', cookie(registered))
      .set('X-CSRF-Token', csrfToken(registered))
      .send({ reportDate: '2026-08-07', timezone: 'UTC' })
      .expect(201);
    const reportId = reportCreateResponseSchema.parse(created.body as unknown).report.id;
    const failedAttempt = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(failedAttempt).toMatchObject({ status: 'pending' });
    expect(failedAttempt.publishedAt).toBeInstanceOf(Date);

    enqueue.mockRestore();
    const secondPublisher = new ReportPublisher(prisma, reportQueue);
    await Promise.all([app.get(ReportPublisher).publishOwed(), secondPublisher.publishOwed()]);
    const retriedAttempt = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(retriedAttempt.publishedAt).toBeInstanceOf(Date);
    expect(retriedAttempt.publishedAt!.getTime()).toBeGreaterThanOrEqual(failedAttempt.publishedAt!.getTime());
    const queue = new Queue('report-generation', { connection: { url: process.env.REDIS_URL! } });
    try {
      const job = await queue.getJob(`report-${reportId}`);
      expect(job).toMatchObject({ id: `report-${reportId}`, name: 'generate-report', data: { reportId } });
    } finally {
      await queue.close();
    }
  });

  it('retains report jobs so periodic reconciliation cannot recreate completed or failed queue entries', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const created = await request(server).post('/api/v1/reports')
      .set('Cookie', cookie(registered))
      .set('X-CSRF-Token', csrfToken(registered))
      .send({ reportDate: '2026-08-06', timezone: 'UTC' })
      .expect(201);
    const reportId = reportCreateResponseSchema.parse(created.body as unknown).report.id;
    const queue = new Queue('report-generation', { connection: { url: process.env.REDIS_URL! } });
    try {
      const job = await queue.getJob(`report-${reportId}`);
      expect(job?.opts.removeOnComplete).toBe(false);
      expect(job?.opts.removeOnFail).toBe(false);
      expect(job?.opts.attempts).toBe(3);
    } finally {
      await queue.close();
    }
  });

  it('rejects a report whose aggregate evidence text exceeds the snapshot budget', async () => {
    const registered = await request(server).post('/api/v1/auth/register').send({ username, email, password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const account = await prisma.githubAccount.create({
      data: { userId: user.id, githubUserId: 881_001n, githubUsername: 'day8-budget-user' },
    });
    const installation = await prisma.githubInstallation.create({
      data: { githubInstallationId: 881_002n, githubAccountId: account.id, accountType: 'ORGANIZATION', accountLogin: 'day8-budget-org' },
    });
    const repository = await prisma.repository.create({
      data: {
        githubRepositoryId: 881_003n, githubInstallationId: installation.id, owner: 'day8-budget-org',
        name: 'budget', fullName: 'day8-budget-org/budget', private: true, defaultBranch: 'main',
      },
    });
    await prisma.userRepository.create({
      data: { userId: user.id, repositoryId: repository.id, trackingEnabled: true, createdAt: new Date('2026-08-01T00:00:00.000Z') },
    });
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        sourceKey: `day8:budget:${index}`,
        repositoryId: repository.id,
        source: 'github' as const,
        type: 'commit' as const,
        occurredAt: new Date('2026-08-05T12:00:00.000Z'),
        metadata: { sha: index.toString(16).padStart(40, 'a'), message: 'x'.repeat(10_000), changedFiles: 1, additions: 1, deletions: 0 },
      })),
    });

    const response = await request(server).post('/api/v1/reports')
      .set('Cookie', cookie(registered))
      .set('X-CSRF-Token', csrfToken(registered))
      .send({ reportDate: '2026-08-05', timezone: 'UTC' })
      .expect(422);
    expect(response.body).toMatchObject({ code: 'REPORT_GENERATION_UNAVAILABLE' });
    expect(await prisma.report.count({ where: { userId: user.id } })).toBe(0);
  });
});
