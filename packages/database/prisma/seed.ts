import { ActivitySource, ActivityType, GithubAccountType, Prisma, PrismaClient, ReportRevisionSource, ReportStatus } from '@prisma/client';
import { argon2id, hash } from 'argon2';

const prisma = new PrismaClient();
const seedDate = new Date('2026-08-11T09:00:00.000Z');
const reportDate = new Date('2026-08-11T00:00:00.000Z');

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed is disabled in production.');
  }
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_DEMO_SEED=true to load deterministic development data.');
  }

  const passwordHash = await hash('TraceDevOnly!2026', {
    type: argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    salt: Buffer.from('trace-seed-salt!'),
  });

  const alice = await prisma.user.upsert({
    where: { username: 'alice.dev' },
    update: { displayName: 'Alice Developer', email: 'alice@example.test', passwordHash, disabledAt: null },
    create: {
      id: 'seed_user_alice',
      username: 'alice.dev',
      displayName: 'Alice Developer',
      email: 'alice@example.test',
      passwordHash,
    },
  });

  const bob = await prisma.user.upsert({
    where: { username: 'bob.dev' },
    update: { displayName: 'Bob Developer', email: 'bob@example.test', passwordHash, disabledAt: null },
    create: {
      id: 'seed_user_bob',
      username: 'bob.dev',
      displayName: 'Bob Developer',
      email: 'bob@example.test',
      passwordHash,
    },
  });

  const aliceGithub = await prisma.githubAccount.upsert({
    where: { githubUserId: 10_001n },
    update: { userId: alice.id, githubUsername: 'alice-dev', displayName: 'Alice Developer', unlinkedAt: null },
    create: {
      id: 'seed_github_alice',
      userId: alice.id,
      githubUserId: 10_001n,
      githubUsername: 'alice-dev',
      displayName: 'Alice Developer',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10001',
    },
  });

  const installation = await prisma.githubInstallation.upsert({
    where: { githubInstallationId: 20_001n },
    update: { githubAccountId: aliceGithub.id, accountLogin: 'trace-demo', suspendedAt: null },
    create: {
      id: 'seed_installation_trace_demo',
      githubInstallationId: 20_001n,
      githubAccountId: aliceGithub.id,
      accountType: GithubAccountType.ORGANIZATION,
      accountLogin: 'trace-demo',
    },
  });

  const apiRepository = await prisma.repository.upsert({
    where: { githubRepositoryId: 30_001n },
    update: {
      githubInstallationId: installation.id,
      owner: 'trace-demo',
      name: 'api',
      fullName: 'trace-demo/api',
      private: true,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/trace-demo/api',
    },
    create: {
      id: 'seed_repository_api',
      githubRepositoryId: 30_001n,
      githubInstallationId: installation.id,
      owner: 'trace-demo',
      name: 'api',
      fullName: 'trace-demo/api',
      private: true,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/trace-demo/api',
    },
  });

  const webRepository = await prisma.repository.upsert({
    where: { githubRepositoryId: 30_002n },
    update: {
      githubInstallationId: installation.id,
      owner: 'trace-demo',
      name: 'web',
      fullName: 'trace-demo/web',
      private: false,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/trace-demo/web',
    },
    create: {
      id: 'seed_repository_web',
      githubRepositoryId: 30_002n,
      githubInstallationId: installation.id,
      owner: 'trace-demo',
      name: 'web',
      fullName: 'trace-demo/web',
      private: false,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/trace-demo/web',
    },
  });

  for (const membership of [
    { userId: alice.id, repositoryId: apiRepository.id, trackingEnabled: true },
    { userId: alice.id, repositoryId: webRepository.id, trackingEnabled: true },
    { userId: bob.id, repositoryId: webRepository.id, trackingEnabled: false },
  ]) {
    await prisma.userRepository.upsert({
      where: { userId_repositoryId: { userId: membership.userId, repositoryId: membership.repositoryId } },
      update: { trackingEnabled: membership.trackingEnabled },
      create: membership,
    });
  }

  const aliceContributor = await prisma.contributor.upsert({
    where: { githubUserId: 10_001n },
    update: { username: 'alice-dev', displayName: 'Alice Developer' },
    create: {
      id: 'seed_contributor_alice',
      githubUserId: 10_001n,
      username: 'alice-dev',
      displayName: 'Alice Developer',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10001',
    },
  });

  const externalContributor = await prisma.contributor.upsert({
    where: { githubUserId: 10_002n },
    update: { username: 'external-dev', displayName: 'External Contributor' },
    create: {
      id: 'seed_contributor_external',
      githubUserId: 10_002n,
      username: 'external-dev',
      displayName: 'External Contributor',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10002',
    },
  });

  const commit = await prisma.commit.upsert({
    where: { repositoryId_sha: { repositoryId: apiRepository.id, sha: 'a'.repeat(40) } },
    update: {
      message: 'Establish Trace API foundation',
      authorContributorId: aliceContributor.id,
      committerContributorId: aliceContributor.id,
      additions: 240,
      deletions: 12,
      changedFiles: 8,
    },
    create: {
      id: 'seed_commit_api_foundation',
      repositoryId: apiRepository.id,
      sha: 'a'.repeat(40),
      message: 'Establish Trace API foundation',
      authorContributorId: aliceContributor.id,
      committerContributorId: aliceContributor.id,
      authoredAt: seedDate,
      committedAt: seedDate,
      branch: 'main',
      additions: 240,
      deletions: 12,
      changedFiles: 8,
    },
  });

  await prisma.commitFile.upsert({
    where: { commitId_path: { commitId: commit.id, path: 'apps/api/src/main.ts' } },
    update: { status: 'added', additions: 42, deletions: 0 },
    create: {
      id: 'seed_commit_file_main',
      commitId: commit.id,
      path: 'apps/api/src/main.ts',
      status: 'added',
      additions: 42,
      deletions: 0,
    },
  });

  await prisma.pushEvent.upsert({
    where: { githubDeliveryId: 'seed-delivery-0001' },
    update: { senderContributorId: externalContributor.id },
    create: {
      id: 'seed_push_api',
      repositoryId: apiRepository.id,
      githubDeliveryId: 'seed-delivery-0001',
      ref: 'refs/heads/main',
      beforeSha: '0'.repeat(40),
      afterSha: commit.sha,
      senderContributorId: externalContributor.id,
      createdAt: seedDate,
    },
  });

  await prisma.activityEvent.upsert({
    where: { id: 'seed_activity_commit' },
    update: { metadata: { sha: commit.sha, message: commit.message } },
    create: {
      id: 'seed_activity_commit',
      repositoryId: apiRepository.id,
      contributorId: aliceContributor.id,
      source: ActivitySource.github,
      type: ActivityType.commit,
      occurredAt: seedDate,
      metadata: { sha: commit.sha, message: commit.message },
    },
  });

  const report = await prisma.report.upsert({
    where: { userId_reportDate: { userId: alice.id, reportDate } },
    update: {
      timezone: 'UTC',
      status: ReportStatus.pending,
      inputSnapshot: { date: '2026-08-11', repositories: ['trace-demo/api'] },
      aiOutput: Prisma.DbNull,
      latexPath: null,
      pdfPath: null,
      completedAt: null,
      error: null,
    },
    create: {
      id: 'seed_report_alice_2026_08_11',
      userId: alice.id,
      reportDate,
      timezone: 'UTC',
      status: ReportStatus.pending,
      inputSnapshot: { date: '2026-08-11', repositories: ['trace-demo/api'] },
    },
  });

  await prisma.reportRevision.upsert({
    where: { reportId_revision: { reportId: report.id, revision: 1 } },
    update: { content: { executiveSummary: 'Seed report awaiting generation.' } },
    create: {
      id: 'seed_report_revision_1',
      reportId: report.id,
      revision: 1,
      source: ReportRevisionSource.manual,
      content: { executiveSummary: 'Seed report awaiting generation.' },
    },
  });

  await prisma.auditLog.upsert({
    where: { id: 'seed_audit_tracking_enabled' },
    update: { metadata: { repositoryId: apiRepository.id } },
    create: {
      id: 'seed_audit_tracking_enabled',
      actorUserId: alice.id,
      action: 'repository.tracking_enabled',
      targetType: 'repository',
      targetId: apiRepository.id,
      requestId: 'seed_request_0001',
      metadata: { repositoryId: apiRepository.id },
      createdAt: seedDate,
    },
  });

  console.info('Seeded Trace development data: 2 users, 2 repositories, 2 contributors, 1 commit, 1 report.');
}

async function run(): Promise<void> {
  try {
    await seed();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'Unknown seed failure');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void run();
