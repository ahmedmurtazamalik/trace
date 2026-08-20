import { createServer, type Server } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import {
  workspaceCreateResponseSchema,
  workspaceDetailResponseSchema,
  workspaceListResponseSchema,
  workspaceInvitationCreateResponseSchema,
  workspaceInvitationListResponseSchema,
  workspaceInvitationDetailResponseSchema,
  workspaceInvitationAcceptResponseSchema,
  workspaceRepositoryAssignmentResponseSchema,
  workspaceAnalysisResponseSchema,
  workspaceAnalysisStartResponseSchema,
  workspaceReportGenerateResponseSchema,
  workspaceReportOccurrenceListResponseSchema,
  workspaceReportScheduleResponseSchema,
  workspaceReportDetailResponseSchema,
  reportListResponseSchema,
} from '@trace/shared';
import request from 'supertest';
import { RedisService } from '../src/common/redis/redis.service';
import { createApplication } from '../src/bootstrap';
import { applyIntegrationEnvironment } from './support/integration-environment';

const password = 'correct-horse-battery-staple';
const usernames = ['workspace.manager', 'workspace.developer', 'workspace.outsider'] as const;
const workspaceGithubUserId = 9_910_001n;
const workspaceInstallationId = 9_910_002n;
const workspaceRepositoryGithubId = 9_910_003n;
const workspaceRepositoryId = 'workspace-accessible-repository';
const baselineSha = 'a'.repeat(40);
const incrementalSha = 'b'.repeat(40);
const readmeBlobSha = 'c'.repeat(40);
const githubHeadSha = baselineSha;

function cookie(response: request.Response): string {
  const value: unknown = (response.headers as Record<string, unknown>)['set-cookie'];
  const header = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  return header.split(';', 1)[0] ?? '';
}

describe('Workspace API', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let githubServer: Server;

  async function clean(): Promise<void> {
    await prisma.workspace.deleteMany({ where: { createdBy: { username: { in: [...usernames] } } } });
    await prisma.userRepository.deleteMany({ where: { user: { username: { in: [...usernames] } } } });
    await prisma.repository.deleteMany({ where: { id: workspaceRepositoryId } });
    await prisma.githubInstallation.deleteMany({ where: { githubInstallationId: workspaceInstallationId } });
    await prisma.githubAccount.deleteMany({ where: { user: { username: { in: [...usernames] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [...usernames] } } });
  }

  beforeAll(async () => {
    applyIntegrationEnvironment();
    process.env.SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.GITHUB_APP_ID = '9910000';
    process.env.GITHUB_APP_PRIVATE_KEY = key;
    githubServer = createServer((incoming, outgoing) => {
      const path = incoming.url ?? '';
      outgoing.setHeader('content-type', 'application/json');
      if (incoming.method === 'POST' && path === `/app/installations/${workspaceInstallationId.toString()}/access_tokens`) return void outgoing.end(JSON.stringify({ token: 'test-installation-token' }));
      if (incoming.method === 'GET' && path === '/repos/workspace-manager/accessible-repository/commits/main') return void outgoing.end(JSON.stringify({ sha: githubHeadSha }));
      if (incoming.method === 'GET' && path === `/repos/workspace-manager/accessible-repository/git/trees/${githubHeadSha}?recursive=1`) return void outgoing.end(JSON.stringify({ truncated: false, tree: [
        { path: 'README.md', mode: '100644', type: 'blob', sha: readmeBlobSha, size: 14 },
        { path: 'vendor/dependency.js', mode: '100644', type: 'blob', sha: 'd'.repeat(40), size: 500 },
        { path: 'logo.png', mode: '100644', type: 'blob', sha: 'e'.repeat(40), size: 1024 },
      ] }));
      if (incoming.method === 'GET' && path === `/repos/workspace-manager/accessible-repository/git/blobs/${readmeBlobSha}`) return void outgoing.end(JSON.stringify({ encoding: 'base64', content: Buffer.from('# Trace\nUseful\n').toString('base64'), size: 15 }));
      if (incoming.method === 'GET' && path === `/repos/workspace-manager/accessible-repository/compare/${baselineSha}...${incrementalSha}`) return void outgoing.end(JSON.stringify({ files: [{ filename: 'README.md', previous_filename: null, status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n-Trace\n+Trace Workspace' }] }));
      outgoing.statusCode = 404;
      outgoing.end(JSON.stringify({ message: `unhandled ${incoming.method ?? ''} ${path}` }));
    });
    await new Promise<void>((resolve) => githubServer.listen(0, '127.0.0.1', resolve));
    const address = githubServer.address();
    if (address === null || typeof address === 'string') throw new Error('GitHub test server did not bind.');
    process.env.GITHUB_API_ORIGIN = `http://127.0.0.1:${address.port}`;
    app = await createApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  beforeEach(async () => {
    await redis.flushdb();
    await clean();
  });

  afterAll(async () => {
    try {
      await clean();
    } finally {
      await app.close();
      await new Promise<void>((resolve, reject) => githubServer.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  async function register(username: typeof usernames[number]): Promise<{ cookie: string; csrfToken: string; userId: string }> {
    const response = await request(server).post('/api/v1/auth/register').send({ username, password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    return { cookie: cookie(response), csrfToken: (response.body as { csrfToken: string }).csrfToken, userId: user.id };
  }

  async function createWorkspace() {
    const manager = await register('workspace.manager');
    const response = await request(server)
      .post('/api/v1/workspaces')
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ name: 'Product Delivery' })
      .expect(201);
    return { manager, created: workspaceCreateResponseSchema.parse(response.body as unknown) };
  }

  async function inviteAndAccept(
    manager: { cookie: string; csrfToken: string },
    recipient: { cookie: string; csrfToken: string },
    workspaceId: string,
    username: typeof usernames[number],
    role: 'MANAGER' | 'DEVELOPER' = 'DEVELOPER',
  ) {
    const invitationResponse = await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).send({ username, role }).expect(201);
    const invitation = workspaceInvitationCreateResponseSchema.parse(invitationResponse.body as unknown).invitation;
    return request(server).post(`/api/v1/workspace-invitations/${invitation.id}/accept`)
      .set('Cookie', recipient.cookie).set('X-CSRF-Token', recipient.csrfToken).expect(200);
  }

  async function createAccessibleRepository(managerUserId: string) {
    await prisma.githubAccount.create({
      data: {
        userId: managerUserId,
        githubUserId: workspaceGithubUserId,
        githubUsername: 'workspace-manager',
        installations: {
          create: {
            githubInstallationId: workspaceInstallationId,
            accountType: 'USER',
            accountLogin: 'workspace-manager',
            repositories: {
              create: {
                id: workspaceRepositoryId,
                githubRepositoryId: workspaceRepositoryGithubId,
                owner: 'workspace-manager',
                name: 'accessible-repository',
                fullName: 'workspace-manager/accessible-repository',
                private: true,
                defaultBranch: 'main',
              },
            },
          },
        },
      },
    });
    await prisma.userRepository.create({
      data: { userId: managerUserId, repositoryId: workspaceRepositoryId, trackingEnabled: true },
    });
    return prisma.repository.findUniqueOrThrow({ where: { id: workspaceRepositoryId } });
  }

  it('creates a workspace atomically with the creator as manager and lists only memberships', async () => {
    await request(server).post('/api/v1/workspaces').send({ name: 'Product Delivery' }).expect(401);
    const manager = await register('workspace.manager');
    await request(server).post('/api/v1/workspaces').set('Cookie', manager.cookie).send({ name: 'Product Delivery' }).expect(403);

    const createdResponse = await request(server)
      .post('/api/v1/workspaces')
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ name: '  Product Delivery  ' })
      .expect(201);
    const created = workspaceCreateResponseSchema.parse(createdResponse.body as unknown);
    expect(created.workspace).toMatchObject({ name: 'Product Delivery', role: 'MANAGER', memberCount: 1, repositoryCount: 0 });
    expect(created.workspace.slug).toMatch(/^product-delivery-[a-z0-9]+$/);

    const listedResponse = await request(server).get('/api/v1/workspaces').set('Cookie', manager.cookie).expect(200);
    expect(workspaceListResponseSchema.parse(listedResponse.body as unknown).items).toEqual([created.workspace]);

    const outsider = await register('workspace.outsider');
    await request(server).get(`/api/v1/workspaces/${created.workspace.id}`).set('Cookie', outsider.cookie).expect(404);
    expect(workspaceListResponseSchema.parse((await request(server).get('/api/v1/workspaces').set('Cookie', outsider.cookie).expect(200)).body as unknown).items).toEqual([]);
  });

  it('creates a targeted invitation without membership and removes direct member creation', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const workspaceId = created.workspace.id;

    await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.developer', role: 'DEVELOPER' })
      .expect(404);

    const response = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.developer', role: 'DEVELOPER' })
      .expect(201);
    const createdInvitation = workspaceInvitationCreateResponseSchema.parse(response.body as unknown);
    const invitation = createdInvitation.invitation;
    const token = createdInvitation.copyablePath.split('#token=')[1] ?? '';

    expect(createdInvitation.copyablePath).toBe(`/invitations/${invitation.id}#token=${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: { tokenHash: true } }))
      .toEqual({ tokenHash: createHash('sha256').update(token).digest('hex') });
    await request(server).get(`/api/v1/workspace-invitations/${invitation.id}`)
      .set('Cookie', developer.cookie).set('X-Workspace-Invitation-Token', 'x'.repeat(43)).expect(404);
    await request(server).get(`/api/v1/workspace-invitations/${invitation.id}`)
      .set('Cookie', developer.cookie).set('X-Workspace-Invitation-Token', token).expect(200);

    expect(invitation).toMatchObject({
      workspace: { id: workspaceId, name: 'Product Delivery' },
      invitedUser: { id: developer.userId, username: 'workspace.developer' },
      invitedBy: { id: manager.userId, username: 'workspace.manager' },
      role: 'DEVELOPER',
      status: 'PENDING',
      acceptancePath: `/invitations/${invitation.id}`,
    });
    expect(new Date(invitation.expiresAt).getTime() - new Date(invitation.createdAt).getTime()).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(await prisma.workspaceMembership.count({ where: { workspaceId, userId: developer.userId } })).toBe(0);
  });

  it('authorizes and transitions invitation recipient and manager lifecycles', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const outsider = await register('workspace.outsider');
    const workspaceId = created.workspace.id;
    const createInvitation = async (target: 'workspace.developer' | 'workspace.outsider' = 'workspace.developer') => {
      const response = await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations`)
        .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
        .send({ username: target, role: 'DEVELOPER' }).expect(201);
      return workspaceInvitationCreateResponseSchema.parse(response.body as unknown).invitation;
    };

    const acceptedInvitation = await createInvitation();
    const managerList = workspaceInvitationListResponseSchema.parse((await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/invitations`).set('Cookie', manager.cookie).expect(200)).body as unknown);
    expect(managerList.items.map(({ id }) => id)).toContain(acceptedInvitation.id);
    await request(server).get(`/api/v1/workspaces/${workspaceId}/invitations`).set('Cookie', developer.cookie).expect(404);

    const ownList = workspaceInvitationListResponseSchema.parse((await request(server)
      .get('/api/v1/workspace-invitations').set('Cookie', developer.cookie).expect(200)).body as unknown);
    expect(ownList.items.map(({ id }) => id)).toContain(acceptedInvitation.id);
    expect(workspaceInvitationDetailResponseSchema.parse((await request(server)
      .get(`/api/v1/workspace-invitations/${acceptedInvitation.id}`).set('Cookie', developer.cookie).expect(200)).body as unknown).invitation.id)
      .toBe(acceptedInvitation.id);
    const hidden = await request(server).get(`/api/v1/workspace-invitations/${acceptedInvitation.id}`).set('Cookie', outsider.cookie).expect(404);
    expect(hidden.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_INVITATION_NOT_FOUND' }));

    await request(server).post(`/api/v1/workspace-invitations/${acceptedInvitation.id}/accept`)
      .set('Cookie', outsider.cookie).set('X-CSRF-Token', outsider.csrfToken).expect(404);
    const accepted = workspaceInvitationAcceptResponseSchema.parse((await request(server)
      .post(`/api/v1/workspace-invitations/${acceptedInvitation.id}/accept`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken).expect(200)).body as unknown);
    expect(accepted).toMatchObject({ invitation: { status: 'ACCEPTED' }, member: { userId: developer.userId, role: 'DEVELOPER' } });
    expect(await prisma.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId: developer.userId } },
    })).toMatchObject({ invitationId: acceptedInvitation.id });
    await request(server).post(`/api/v1/workspace-invitations/${acceptedInvitation.id}/accept`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken).expect(409);
    const memberConflict = await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.developer', role: 'MANAGER' }).expect(409);
    expect(memberConflict.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_MEMBER_EXISTS' }));

    const declinedInvitation = await createInvitation('workspace.outsider');
    const duplicate = await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.outsider', role: 'MANAGER' }).expect(409);
    expect(duplicate.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_INVITATION_EXISTS' }));
    await request(server).post(`/api/v1/workspace-invitations/${declinedInvitation.id}/decline`)
      .set('Cookie', outsider.cookie).set('X-CSRF-Token', outsider.csrfToken).expect(200);

    const revokedInvitation = await createInvitation('workspace.outsider');
    await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations/${revokedInvitation.id}/revoke`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken).expect(403);
    await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations/${revokedInvitation.id}/revoke`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200);
    await request(server).post(`/api/v1/workspace-invitations/${revokedInvitation.id}/accept`)
      .set('Cookie', outsider.cookie).set('X-CSRF-Token', outsider.csrfToken).expect(409);

    const expiredInvitation = await createInvitation('workspace.outsider');
    await prisma.workspaceInvitation.update({ where: { id: expiredInvitation.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const expiredDetail = workspaceInvitationDetailResponseSchema.parse((await request(server)
      .get(`/api/v1/workspace-invitations/${expiredInvitation.id}`).set('Cookie', outsider.cookie).expect(200)).body as unknown);
    expect(expiredDetail.invitation.status).toBe('EXPIRED');
    const expiredAccept = await request(server).post(`/api/v1/workspace-invitations/${expiredInvitation.id}/accept`)
      .set('Cookie', outsider.cookie).set('X-CSRF-Token', outsider.csrfToken).expect(410);
    expect(expiredAccept.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_INVITATION_EXPIRED' }));
    expect(await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expiredInvitation.id } })).toMatchObject({ status: 'REVOKED', revokedAt: null });

    const expiredDecline = await createInvitation('workspace.outsider');
    await prisma.workspaceInvitation.update({ where: { id: expiredDecline.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(server).post(`/api/v1/workspace-invitations/${expiredDecline.id}/decline`)
      .set('Cookie', outsider.cookie).set('X-CSRF-Token', outsider.csrfToken).expect(410);
    expect(await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expiredDecline.id } })).toMatchObject({ status: 'REVOKED', revokedAt: null });

    const expiredRevoke = await createInvitation('workspace.outsider');
    await prisma.workspaceInvitation.update({ where: { id: expiredRevoke.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(server).post(`/api/v1/workspaces/${workspaceId}/invitations/${expiredRevoke.id}/revoke`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(410);
    expect(await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expiredRevoke.id } })).toMatchObject({ status: 'REVOKED', revokedAt: null });

    expect(await prisma.auditLog.count({ where: { targetId: workspaceId, action: 'workspace.invitation.expired' } })).toBe(3);
    await createInvitation('workspace.outsider');

    const actions = (await prisma.auditLog.findMany({ where: { targetType: 'workspace', targetId: workspaceId } }))
      .map(({ action }) => action);
    expect(actions).toEqual(expect.arrayContaining([
      'workspace.invitation.created', 'workspace.invitation.accepted',
      'workspace.invitation.declined', 'workspace.invitation.revoked', 'workspace.invitation.expired',
    ]));
  });

  it('revokes pending invitations when a workspace is archived', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const invitation = workspaceInvitationCreateResponseSchema.parse((await request(server)
      .post(`/api/v1/workspaces/${created.workspace.id}/invitations`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.developer', role: 'DEVELOPER' }).expect(201)).body as unknown).invitation;

    await request(server).post(`/api/v1/workspaces/${created.workspace.id}/archive`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200);

    const archivedInvitation = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(archivedInvitation.status).toBe('REVOKED');
    expect(archivedInvitation.revokedAt).toBeInstanceOf(Date);
    await request(server).post(`/api/v1/workspace-invitations/${invitation.id}/accept`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken).expect(409);
    expect(await prisma.workspaceMembership.count({ where: { workspaceId: created.workspace.id, userId: developer.userId } })).toBe(0);
  });

  it('serializes concurrent duplicate creation and acceptance into one invitation and one membership', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const sendInvitation = () => request(server).post(`/api/v1/workspaces/${created.workspace.id}/invitations`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.developer', role: 'DEVELOPER' });
    const createResponses = await Promise.all([sendInvitation(), sendInvitation()]);
    expect(createResponses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const invitation = workspaceInvitationCreateResponseSchema.parse(createResponses.find(({ status }) => status === 201)?.body as unknown).invitation;
    expect(await prisma.workspaceInvitation.count({ where: { workspaceId: created.workspace.id, invitedUserId: developer.userId, status: 'PENDING' } })).toBe(1);

    const acceptInvitation = () => request(server).post(`/api/v1/workspace-invitations/${invitation.id}/accept`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken);
    const acceptResponses = await Promise.all([acceptInvitation(), acceptInvitation()]);
    expect(acceptResponses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(await prisma.workspaceMembership.count({ where: { workspaceId: created.workspace.id, userId: developer.userId } })).toBe(1);
  });

  it('lets invited users join while developers cannot invite members', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');

    const acceptedResponse = await inviteAndAccept(manager, developer, created.workspace.id, 'workspace.developer');
    expect(workspaceInvitationAcceptResponseSchema.parse(acceptedResponse.body as unknown).member).toMatchObject({
      userId: developer.userId, username: 'workspace.developer', role: 'DEVELOPER',
    });

    const detail = workspaceDetailResponseSchema.parse((await request(server)
      .get(`/api/v1/workspaces/${created.workspace.id}`).set('Cookie', developer.cookie).expect(200)).body as unknown);
    expect(detail.workspace).toMatchObject({ role: 'DEVELOPER', memberCount: 2 });
    expect(detail.members.map((member) => member.username)).toEqual(['workspace.manager', 'workspace.developer']);

    const duplicate = await request(server).post(`/api/v1/workspaces/${created.workspace.id}/invitations`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ username: 'workspace.developer', role: 'MANAGER' }).expect(409);
    expect(duplicate.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_MEMBER_EXISTS' }));

    const forbidden = await request(server).post(`/api/v1/workspaces/${created.workspace.id}/invitations`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken)
      .send({ username: 'workspace.outsider', role: 'DEVELOPER' }).expect(403);
    expect(forbidden.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_MANAGER_REQUIRED' }));
  });

  it('lets a manager assign a repository authorized by any current workspace member and keeps the operation idempotent', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    await inviteAndAccept(manager, developer, created.workspace.id, 'workspace.developer');
    const unrelatedRepository = await prisma.repository.findUniqueOrThrow({ where: { id: 'seed_repository_web' } });

    const unavailable = await request(server)
      .post(`/api/v1/workspaces/${created.workspace.id}/repositories`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ repositoryId: unrelatedRepository.id })
      .expect(404);
    expect(unavailable.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_REPOSITORY_NOT_AVAILABLE' }));

    await prisma.userRepository.create({ data: { userId: manager.userId, repositoryId: unrelatedRepository.id, trackingEnabled: true } });
    await request(server)
      .post(`/api/v1/workspaces/${created.workspace.id}/repositories`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ repositoryId: unrelatedRepository.id })
      .expect(404);

    const repository = await createAccessibleRepository(developer.userId);
    const managerGithubAccount = await prisma.githubAccount.create({
      data: { userId: manager.userId, githubUserId: workspaceGithubUserId + 100n, githubUsername: 'workspace-manager-split' },
    });
    await prisma.userRepository.delete({ where: { userId_repositoryId: { userId: developer.userId, repositoryId: repository.id } } });
    await prisma.userRepository.create({ data: { userId: manager.userId, repositoryId: repository.id, trackingEnabled: true } });
    const splitMemberAuthority = await request(server)
      .post(`/api/v1/workspaces/${created.workspace.id}/repositories`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ repositoryId: repository.id })
      .expect(404);
    expect(splitMemberAuthority.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_REPOSITORY_NOT_AVAILABLE' }));
    await prisma.userRepository.delete({ where: { userId_repositoryId: { userId: manager.userId, repositoryId: repository.id } } });
    await prisma.githubAccount.delete({ where: { id: managerGithubAccount.id } });
    await prisma.userRepository.create({ data: { userId: developer.userId, repositoryId: repository.id, trackingEnabled: true } });
    const assigned = await Promise.all([0, 1].map(() => request(server)
        .post(`/api/v1/workspaces/${created.workspace.id}/repositories`)
        .set('Cookie', manager.cookie)
        .set('X-CSRF-Token', manager.csrfToken)
        .send({ repositoryId: repository.id })));
    expect(assigned.map((response) => response.status).sort()).toEqual([200, 201]);
    for (const assignedResponse of assigned) {
      expect(workspaceRepositoryAssignmentResponseSchema.parse(assignedResponse.body as unknown).repository).toMatchObject({
        id: repository.id,
        fullName: repository.fullName,
      });
    }

    const detail = workspaceDetailResponseSchema.parse((await request(server).get(`/api/v1/workspaces/${created.workspace.id}`).set('Cookie', manager.cookie).expect(200)).body as unknown);
    expect(detail.workspace.repositoryCount).toBe(1);
    expect(detail.repositories).toHaveLength(1);

    await prisma.repository.update({ where: { id: repository.id }, data: { accessRemovedAt: new Date() } });
    const accessRemovedDetail = workspaceDetailResponseSchema.parse(
      (await request(server).get(`/api/v1/workspaces/${created.workspace.id}`).set('Cookie', manager.cookie).expect(200)).body as unknown,
    );
    expect(accessRemovedDetail.repositories[0]?.accessState).toBe('ACCESS_REMOVED');

    await request(server)
      .delete(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}`)
      .set('Cookie', developer.cookie)
      .set('X-CSRF-Token', developer.csrfToken)
      .expect(403);
    await request(server)
      .delete(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .expect(200, { removed: true });
    await request(server)
      .delete(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .expect(404);
  });

  it('supports the complete Manager lifecycle and serializes concurrent last-Manager changes', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const workspaceId = created.workspace.id;

    await inviteAndAccept(manager, developer, workspaceId, 'workspace.developer');

    await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', developer.cookie)
      .set('X-CSRF-Token', developer.csrfToken)
      .send({ name: 'Forbidden Rename' })
      .expect(403);
    await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', manager.cookie)
      .send({ name: 'Delivery Platform' })
      .expect(403);
    const renamed = await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ name: ' Delivery Platform ' })
      .expect(200);
    expect(workspaceCreateResponseSchema.parse(renamed.body as unknown).workspace.name).toBe('Delivery Platform');

    await request(server)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${developer.userId}`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .expect(200, { removed: true });
    await request(server).get(`/api/v1/workspaces/${workspaceId}`).set('Cookie', developer.cookie).expect(404);

    await inviteAndAccept(manager, developer, workspaceId, 'workspace.developer');
    await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${developer.userId}`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .send({ role: 'MANAGER' })
      .expect(200);

    const concurrent = await Promise.all([
      request(server)
        .patch(`/api/v1/workspaces/${workspaceId}/members/${developer.userId}`)
        .set('Cookie', manager.cookie)
        .set('X-CSRF-Token', manager.csrfToken)
        .send({ role: 'DEVELOPER' }),
      request(server)
        .patch(`/api/v1/workspaces/${workspaceId}/members/${manager.userId}`)
        .set('Cookie', developer.cookie)
        .set('X-CSRF-Token', developer.csrfToken)
        .send({ role: 'DEVELOPER' }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 403]);
    expect(concurrent.find((response) => response.status === 403)?.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_MANAGER_REQUIRED' }));
    expect(await prisma.workspaceMembership.count({ where: { workspaceId, role: 'MANAGER' } })).toBe(1);

    const finalManager = await prisma.workspaceMembership.findFirstOrThrow({ where: { workspaceId, role: 'MANAGER' } });
    const finalManagerSession = finalManager.userId === manager.userId ? manager : developer;
    const lastManagerRemoval = await request(server)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${finalManager.userId}`)
      .set('Cookie', finalManagerSession.cookie)
      .set('X-CSRF-Token', finalManagerSession.csrfToken)
      .expect(409);
    expect(lastManagerRemoval.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_LAST_MANAGER_REQUIRED' }));

    const archived = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/archive`)
      .set('Cookie', finalManagerSession.cookie)
      .set('X-CSRF-Token', finalManagerSession.csrfToken)
      .expect(200);
    expect(workspaceCreateResponseSchema.parse(archived.body as unknown).workspace.archivedAt).not.toBeNull();

    const rejectedMutation = await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', finalManagerSession.cookie)
      .set('X-CSRF-Token', finalManagerSession.csrfToken)
      .send({ name: 'Archived Rename' })
      .expect(409);
    expect(rejectedMutation.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_ARCHIVED' }));

    const auditActions = (await prisma.auditLog.findMany({
      where: { targetType: 'workspace', targetId: workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    })).map((entry) => entry.action);
    expect(auditActions).toEqual(expect.arrayContaining([
      'workspace.created',
      'workspace.renamed',
      'workspace.invitation.created',
      'workspace.invitation.accepted',
      'workspace.member.removed',
      'workspace.member.role_changed',
      'workspace.archived',
    ]));
  });

  it('creates one immutable manual report occurrence per idempotency request and preserves archived reads', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const outsider = await register('workspace.outsider');
    const workspaceId = created.workspace.id;
    await inviteAndAccept(manager, developer, workspaceId, 'workspace.developer');

    const body = { windowStart: '2026-08-17T00:00:00.000Z', windowEnd: '2026-08-18T00:00:00.000Z' };
    await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie).set('Idempotency-Key', 'manual-one').send(body).expect(403);
    await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).send(body).expect(422);
    await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken)
      .set('Idempotency-Key', 'developer-denied').send(body).expect(403);
    await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', outsider.cookie).set('X-CSRF-Token', outsider.csrfToken)
      .set('Idempotency-Key', 'outsider-denied').send(body).expect(404);

    const firstResponse = await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .set('Idempotency-Key', 'manual-one').send(body).expect(201);
    const first = workspaceReportGenerateResponseSchema.parse(firstResponse.body as unknown).occurrence;
    expect(first).toMatchObject({ trigger: 'MANUAL', status: 'PENDING', noActivity: true });
    expect(first.dataCutoffAt).toBe(first.windowEnd);

    const retryResponse = await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .set('Idempotency-Key', 'manual-one').send(body).expect(200);
    expect(workspaceReportGenerateResponseSchema.parse(retryResponse.body as unknown).occurrence.id).toBe(first.id);
    const conflict = await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .set('Idempotency-Key', 'manual-one')
      .send({ ...body, windowStart: '2026-08-16T00:00:00.000Z' }).expect(409);
    expect(conflict.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_IDEMPOTENCY_CONFLICT' }));
    expect(await prisma.workspaceReportOccurrence.count({ where: { workspaceId } })).toBe(1);
    expect(await prisma.report.count({ where: { workspaceId } })).toBe(1);
    const frozen = await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: first.id } });
    expect(frozen.evidenceSnapshot).toEqual(expect.objectContaining({ version: 1, repositories: [] }));
    const personalList = await request(server).get('/api/v1/reports').set('Cookie', manager.cookie).expect(200);
    expect((personalList.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(first.reportId);
    if (first.reportId !== null) {
      await request(server).get(`/api/v1/reports/${first.reportId}`).set('Cookie', manager.cookie).expect(404);

      const managerReports = reportListResponseSchema.parse((await request(server)
        .get(`/api/v1/workspaces/${workspaceId}/reports`)
        .set('Cookie', manager.cookie).expect(200)).body as unknown);
      expect(managerReports.items.map(({ id }) => id)).toEqual([first.reportId]);
      expect(reportListResponseSchema.parse((await request(server)
        .get(`/api/v1/workspaces/${workspaceId}/reports`)
        .set('Cookie', developer.cookie).expect(200)).body as unknown).items).toEqual([]);
      expect(workspaceReportDetailResponseSchema.parse((await request(server)
        .get(`/api/v1/workspaces/${workspaceId}/reports/${first.reportId}`)
        .set('Cookie', manager.cookie).expect(200)).body as unknown).report.id).toBe(first.reportId);
      await request(server).get(`/api/v1/workspaces/${workspaceId}/reports/${first.reportId}`)
        .set('Cookie', developer.cookie).expect(404);
      await request(server).get(`/api/v1/workspaces/${workspaceId}/reports`)
        .set('Cookie', outsider.cookie).expect(404);
      await request(server).put(`/api/v1/workspaces/${workspaceId}/reports/${first.reportId}/revision`)
        .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken)
        .send({ expectedRevision: 1, prosePatch: { executiveSummary: 'Not authorized' } }).expect(403);
      await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/${first.reportId}/regenerate`)
        .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken)
        .send({ expectedRevision: 1 }).expect(403);
      await request(server).get(`/api/v1/workspaces/${workspaceId}/reports/${first.reportId}/download?artifactId=missing`)
        .set('Cookie', developer.cookie).expect(404);
    }

    await request(server).post(`/api/v1/workspaces/${workspaceId}/archive`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200);
    await request(server).post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .set('Idempotency-Key', 'after-archive').send(body).expect(409);
    await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/report-occurrences`)
      .set('Cookie', developer.cookie).expect(403);
    const historical = workspaceReportOccurrenceListResponseSchema.parse((await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/report-occurrences`)
      .set('Cookie', manager.cookie).expect(200)).body as unknown);
    expect(historical.items.map((item) => item.id)).toContain(first.id);
  });

  it('freezes report repository currentness from canonical same-member authority', async () => {
    const { manager, created } = await createWorkspace();
    const repository = await createAccessibleRepository(manager.userId);
    await request(server).post(`/api/v1/workspaces/${created.workspace.id}/repositories`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ repositoryId: repository.id }).expect(201);
    await prisma.githubAccount.update({ where: { userId: manager.userId }, data: { unlinkedAt: new Date() } });

    const response = await request(server).post(`/api/v1/workspaces/${created.workspace.id}/reports/generate`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .set('Idempotency-Key', 'revoked-freeze')
      .send({ windowStart: '2026-08-17T00:00:00.000Z', windowEnd: '2026-08-18T00:00:00.000Z' }).expect(201);
    const occurrenceId = workspaceReportGenerateResponseSchema.parse(response.body as unknown).occurrence.id;
    const occurrence = await prisma.workspaceReportOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } });
    expect(occurrence.evidenceSnapshot).toEqual(expect.objectContaining({ repositories: [
      expect.objectContaining({ repositoryId: repository.id, accessState: 'ACCESS_REMOVED' }),
    ] }));
  });

  it('serializes concurrent manual report retries into one occurrence and one report', async () => {
    const { manager, created } = await createWorkspace();
    const workspaceId = created.workspace.id;
    const body = { windowStart: '2026-08-17T00:00:00.000Z', windowEnd: '2026-08-18T00:00:00.000Z' };
    const submit = () => request(server)
      .post(`/api/v1/workspaces/${workspaceId}/reports/generate`)
      .set('Cookie', manager.cookie)
      .set('X-CSRF-Token', manager.csrfToken)
      .set('Idempotency-Key', 'manual-concurrent')
      .send(body);

    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const occurrences = responses.map(({ body: responseBody }) => workspaceReportGenerateResponseSchema.parse(responseBody as unknown).occurrence);
    expect(new Set(occurrences.map(({ id }) => id))).toEqual(new Set([occurrences[0]?.id]));
    expect(await prisma.workspaceReportOccurrence.count({ where: { workspaceId } })).toBe(1);
    expect(await prisma.report.count({ where: { workspaceId } })).toBe(1);
  });

  it('lets managers version, read, and disable a validated timezone schedule', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const workspaceId = created.workspace.id;
    await inviteAndAccept(manager, developer, workspaceId, 'workspace.developer');
    const daily = { enabled: true, frequency: 'DAILY', selectedDays: [], localTime: '17:00', timezone: 'America/Los_Angeles' };

    await request(server).put(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).send(daily).expect(403);
    await request(server).put(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken).send(daily).expect(403);
    await request(server).put(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ ...daily, timezone: 'PST' }).expect(422);

    const createdSchedule = workspaceReportScheduleResponseSchema.parse((await request(server)
      .put(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).send(daily).expect(200)).body as unknown).schedule!;
    expect(createdSchedule).toMatchObject({ version: 1, ...daily });
    expect(createdSchedule.nextRunAt).not.toBeNull();
    expect(createdSchedule.nextRunLocal).not.toBeNull();
    await request(server).get(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', developer.cookie).expect(403);
    expect(workspaceReportScheduleResponseSchema.parse((await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).expect(200)).body as unknown).schedule?.id).toBe(createdSchedule.id);

    const updated = workspaceReportScheduleResponseSchema.parse((await request(server)
      .put(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ enabled: true, frequency: 'SELECTED_DAYS', selectedDays: [5, 1], localTime: '09:30', timezone: 'UTC' }).expect(200)).body as unknown).schedule!;
    expect(updated).toMatchObject({ version: 2, selectedDays: [1, 5], localTime: '09:30', timezone: 'UTC' });

    const disabled = workspaceReportScheduleResponseSchema.parse((await request(server)
      .delete(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200)).body as unknown).schedule!;
    expect(disabled).toMatchObject({ enabled: false, version: 3, nextRunAt: null, nextRunLocal: null });

    await request(server).post(`/api/v1/workspaces/${workspaceId}/archive`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200);
    await request(server).put(`/api/v1/workspaces/${workspaceId}/report-schedule`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).send(daily).expect(409);
    expect((await prisma.auditLog.findMany({ where: { targetId: workspaceId, action: { startsWith: 'workspace.schedule_' } } })).map((entry) => entry.action))
      .toEqual(['workspace.schedule_created', 'workspace.schedule_updated', 'workspace.schedule_disabled']);
  });

  it('claims one durable analysis run for the worker while preserving authorization and access-loss history', async () => {
    const { manager, created } = await createWorkspace();
    const developer = await register('workspace.developer');
    const repository = await createAccessibleRepository(manager.userId);
    await inviteAndAccept(manager, developer, created.workspace.id, 'workspace.developer');
    await request(server).post(`/api/v1/workspaces/${created.workspace.id}/repositories`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken)
      .send({ repositoryId: repository.id }).expect(201);

    const initial = workspaceAnalysisResponseSchema.parse((await request(server)
      .get(`/api/v1/workspaces/${created.workspace.id}/analysis`)
      .set('Cookie', developer.cookie).expect(200)).body as unknown);
    expect(initial.items[0]).toMatchObject({ status: 'UNINITIALIZED', baselineSha: null, accessState: 'ACTIVE' });

    await request(server).post(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}/baseline`)
      .set('Cookie', developer.cookie).set('X-CSRF-Token', developer.csrfToken).expect(403);

    const pending = workspaceAnalysisStartResponseSchema.parse((await request(server)
      .post(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}/baseline`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200)).body as unknown);
    expect(pending.run).toMatchObject({ kind: 'BASELINE', fromSha: null, toSha: null, status: 'PENDING', coverage: null });

    const duplicate = workspaceAnalysisStartResponseSchema.parse((await request(server)
      .post(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}/baseline`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(200)).body as unknown);
    expect(duplicate.run.id).toBe(pending.run.id);
    expect(await prisma.workspaceAnalysisRun.count({ where: { workspaceId: created.workspace.id } })).toBe(1);

    await prisma.githubAccount.update({ where: { userId: manager.userId }, data: { unlinkedAt: new Date() } });
    const unlinked = await request(server).post(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}/baseline`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(409);
    expect(unlinked.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_REPOSITORY_ACCESS_REMOVED' }));
    await prisma.githubAccount.update({ where: { userId: manager.userId }, data: { unlinkedAt: null } });

    await prisma.repository.update({ where: { id: repository.id }, data: { accessRemovedAt: new Date() } });
    const blocked = await request(server).post(`/api/v1/workspaces/${created.workspace.id}/repositories/${repository.id}/baseline`)
      .set('Cookie', manager.cookie).set('X-CSRF-Token', manager.csrfToken).expect(409);
    expect(blocked.body).toEqual(expect.objectContaining({ code: 'WORKSPACE_REPOSITORY_ACCESS_REMOVED' }));
    expect((await prisma.workspaceAnalysisRun.findUniqueOrThrow({ where: { id: pending.run.id } })).id).toBe(pending.run.id);
  });
});
