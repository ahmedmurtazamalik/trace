import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { FileSystemArtifactStorage } from '@trace/report-storage';
import { reportDetailResponseSchema } from '@trace/shared';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';

const password = 'correct-horse-battery-staple';
const content = {
  executiveSummary: 'Initial summary.',
  repositories: [{
    repositoryId: 'repo_1', summary: 'Repository summary.',
    contributors: [{ contributorId: 'person_1', summary: 'Contributor summary.', accomplishments: ['Shipped reports.'] }],
  }],
};
const snapshot = {
  version: 1, reportDate: '2026-08-13', timezone: 'UTC',
  facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 2, additions: 3, deletions: 1 },
  repositories: [{
    id: 'repo_1', fullName: 'trace/backend',
    facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 2, additions: 3, deletions: 1 },
    contributors: [{ id: 'person_1', username: 'person', displayName: 'Person', facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 2, additions: 3, deletions: 1 } }],
    evidence: [{ activityId: 'activity_1', occurredAt: '2026-08-13T10:00:00.000Z', type: 'commit', sha: 'a'.repeat(40), message: 'Ship reports' }],
  }],
};

function cookie(response: request.Response): string {
  const value: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  const header = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  return header.split(';', 1)[0] ?? '';
}

describe('Report revisions and artifacts API', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let storageRoot: string;
  let ownerCookie: string;
  let ownerCsrf: string;
  let otherCookie: string;
  let otherCsrf: string;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'trace-api-artifacts-'));
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    process.env.REPORT_STORAGE_ROOT = storageRoot;
    for (const name of ['GITHUB_APP_PRIVATE_KEY', 'LLM_API_KEY', 'STORAGE_BUCKET', 'STORAGE_ENDPOINT', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']) {
      if (process.env[name] === '') delete process.env[name];
    }
    process.env.GITHUB_APP_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_APP_SLUG = 'trace-test-app';
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3001/api/v1/github/callback';
    process.env.GITHUB_INSTALLATION_CALLBACK_URL = 'http://localhost:3001/api/v1/github/installation/callback';
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    await cleanupUsers();
    const owner = await request(server).post('/api/v1/auth/register').send({ username: 'day10.owner', email: 'day10.owner@example.test', password }).expect(201);
    const other = await request(server).post('/api/v1/auth/register').send({ username: 'day10.other', email: 'day10.other@example.test', password }).expect(201);
    ownerCookie = cookie(owner);
    ownerCsrf = (owner.body as { csrfToken: string }).csrfToken;
    otherCookie = cookie(other);
    otherCsrf = (other.body as { csrfToken: string }).csrfToken;
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { username: 'day10.owner' } })).id;
    otherId = (await prisma.user.findUniqueOrThrow({ where: { username: 'day10.other' } })).id;
  });

  async function cleanupUsers(): Promise<void> {
    const users = await prisma.user.findMany({
      where: { username: { in: ['day10.owner', 'day10.other'] } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length === 0) return;
    await prisma.report.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  beforeEach(async () => {
    await prisma.report.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  });

  afterAll(async () => {
    await cleanupUsers();
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function completedReport(userId = ownerId): Promise<{ reportId: string; revisionId: string; artifactId: string }> {
    const report = await prisma.report.create({
      data: { userId, reportDate: new Date('2026-08-13T00:00:00.000Z'), timezone: 'UTC', status: 'processing', inputSnapshot: snapshot },
    });
    const revision = await prisma.reportRevision.create({ data: { reportId: report.id, revision: 1, source: 'ai', content } });
    const bytes = Buffer.from('%PDF-1.7\nDay 10\n%%EOF');
    const key = `users/${ownerId}/reports/${report.id}/revisions/1/report.pdf`;
    await new FileSystemArtifactStorage(storageRoot).put(key, bytes);
    const artifact = await prisma.reportArtifact.create({
      data: { reportId: report.id, revisionId: revision.id, kind: 'pdf', storageKey: key, sizeBytes: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') },
    });
    await prisma.report.update({ where: { id: report.id }, data: { status: 'completed', currentRevisionId: revision.id, completedAt: new Date(), pdfPath: key } });
    return { reportId: report.id, revisionId: revision.id, artifactId: artifact.id };
  }

  it('creates an owner-only manual revision with an atomic durable render obligation', async () => {
    const fixture = await completedReport();
    const response = await request(server)
      .put(`/api/v1/reports/${fixture.reportId}/revision`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ expectedRevision: 1, prosePatch: { executiveSummary: 'Updated safely.' } })
      .expect(200);
    const body = reportDetailResponseSchema.parse(response.body as unknown);
    expect(body.report).toMatchObject({ status: 'processing', revision: 2, revisionSource: 'manual', completedAt: null, downloadAvailable: false });
    expect(body.report.content?.executiveSummary).toBe('Updated safely.');
    expect(body.report.artifacts).toEqual([]);

    const stored = await prisma.report.findUniqueOrThrow({ where: { id: fixture.reportId }, include: { currentRevision: true } });
    expect(stored).toMatchObject({ status: 'processing', renderRevision: 2, renderGeneration: 1 });
    expect(stored.renderPublishedAt).toBeInstanceOf(Date);
    expect(stored.currentRevision).toMatchObject({ revision: 2, source: 'manual' });

    await request(server)
      .put(`/api/v1/reports/${fixture.reportId}/revision`)
      .set('Cookie', ownerCookie).set('X-CSRF-Token', ownerCsrf)
      .send({ expectedRevision: 1, prosePatch: { executiveSummary: 'Stale.' } })
      .expect(409)
      .expect(({ body: error }) => expect(error).toMatchObject({ code: 'REPORT_REVISION_CONFLICT' }));
  });

  it('requires CSRF and hides foreign reports for revision and regeneration', async () => {
    const fixture = await completedReport();
    const input = { expectedRevision: 1, prosePatch: { executiveSummary: 'No.' } };
    await request(server).put(`/api/v1/reports/${fixture.reportId}/revision`).set('Cookie', ownerCookie).send(input).expect(403);
    await request(server).put(`/api/v1/reports/${fixture.reportId}/revision`).set('Cookie', otherCookie).set('X-CSRF-Token', otherCsrf).send(input).expect(404);
    await request(server).post(`/api/v1/reports/${fixture.reportId}/regenerate`).set('Cookie', otherCookie).set('X-CSRF-Token', otherCsrf).send({ expectedRevision: 1 }).expect(404);
  });

  it('regenerates the current revision without overwriting its content', async () => {
    const fixture = await completedReport();
    const response = await request(server)
      .post(`/api/v1/reports/${fixture.reportId}/regenerate`)
      .set('Cookie', ownerCookie).set('X-CSRF-Token', ownerCsrf)
      .send({ expectedRevision: 1 }).expect(201);
    const body = reportDetailResponseSchema.parse(response.body as unknown);
    expect(body.report).toMatchObject({ status: 'processing', revision: 1, downloadAvailable: false });
    expect(body.report.content).toEqual(content);
    const revisions = await prisma.reportRevision.count({ where: { reportId: fixture.reportId } });
    expect(revisions).toBe(1);
  });

  it('streams only an owned current artifact and verifies stored bytes', async () => {
    const fixture = await completedReport();
    const response = await request(server)
      .get(`/api/v1/reports/${fixture.reportId}/download?artifactId=${fixture.artifactId}`)
      .set('Cookie', ownerCookie).expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.body as Buffer).toEqual(Buffer.from('%PDF-1.7\nDay 10\n%%EOF'));
    await request(server).get(`/api/v1/reports/${fixture.reportId}/download?artifactId=${fixture.artifactId}`).set('Cookie', otherCookie).expect(404);

    const foreign = await completedReport(otherId);
    await request(server).get(`/api/v1/reports/${fixture.reportId}/download?artifactId=${foreign.artifactId}`).set('Cookie', ownerCookie).expect(404);
  });
});
