import { ActivitySource, ActivityType, GithubAccountType, PrismaClient, ReportRevisionSource, ReportStatus } from '@prisma/client';
import { argon2id, hash } from 'argon2';

const prisma = new PrismaClient();
const seedDate = new Date('2026-08-11T09:00:00.000Z');
const reportDate = new Date('2026-08-11T00:00:00.000Z');

export async function seed(client: PrismaClient = prisma): Promise<void> {
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

  const alice = await client.user.upsert({
    where: { id: 'seed_user_alice' },
    update: {},
    create: {
      id: 'seed_user_alice',
      username: 'alice.dev',
      displayName: 'Alice Developer',
      email: 'alice@example.test',
      passwordHash,
    },
  });

  const bob = await client.user.upsert({
    where: { id: 'seed_user_bob' },
    update: {},
    create: {
      id: 'seed_user_bob',
      username: 'bob.dev',
      displayName: 'Bob Developer',
      email: 'bob@example.test',
      passwordHash,
    },
  });

  const aliceGithub = await client.githubAccount.upsert({
    where: { id: 'seed_github_alice' },
    update: {},
    create: {
      id: 'seed_github_alice',
      userId: alice.id,
      githubUserId: 10_001n,
      githubUsername: 'alice-dev',
      displayName: 'Alice Developer',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10001',
    },
  });

  const installation = await client.githubInstallation.upsert({
    where: { id: 'seed_installation_trace_demo' },
    update: {},
    create: {
      id: 'seed_installation_trace_demo',
      githubInstallationId: 20_001n,
      githubAccountId: aliceGithub.id,
      accountType: GithubAccountType.ORGANIZATION,
      accountLogin: 'trace-demo',
    },
  });

  const apiRepository = await client.repository.upsert({
    where: { id: 'seed_repository_api' },
    update: {},
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

  const webRepository = await client.repository.upsert({
    where: { id: 'seed_repository_web' },
    update: {},
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
    await client.userRepository.upsert({
      where: { userId_repositoryId: { userId: membership.userId, repositoryId: membership.repositoryId } },
      update: {},
      create: membership,
    });
  }

  const aliceContributor = await client.contributor.upsert({
    where: { id: 'seed_contributor_alice' },
    update: {},
    create: {
      id: 'seed_contributor_alice',
      githubUserId: 10_001n,
      username: 'alice-dev',
      displayName: 'Alice Developer',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10001',
    },
  });

  const externalContributor = await client.contributor.upsert({
    where: { id: 'seed_contributor_external' },
    update: {},
    create: {
      id: 'seed_contributor_external',
      githubUserId: 10_002n,
      username: 'external-dev',
      displayName: 'External Contributor',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10002',
    },
  });

  const commit = await client.commit.upsert({
    where: { id: 'seed_commit_api_foundation' },
    update: {},
    create: {
      id: 'seed_commit_api_foundation',
      repositoryId: apiRepository.id,
      sha: 'a'.repeat(40),
      message: 'Establish Trace API foundation',
      authorName: 'Alice Developer',
      authorEmail: 'alice@example.test',
      authorUsername: 'alice-dev',
      committerName: 'Alice Developer',
      committerEmail: 'alice@example.test',
      committerUsername: 'alice-dev',
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

  await client.commitFile.upsert({
    where: { id: 'seed_commit_file_main' },
    update: {},
    create: {
      id: 'seed_commit_file_main',
      commitId: commit.id,
      path: 'apps/api/src/main.ts',
      status: 'added',
      additions: 42,
      deletions: 0,
    },
  });

  await client.pushEvent.upsert({
    where: { id: 'seed_push_api' },
    update: {},
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

  await client.activityEvent.upsert({
    where: { id: 'seed_activity_commit' },
    update: {},
    create: {
      id: 'seed_activity_commit',
      sourceKey: 'seed:github:commit:api-foundation',
      repositoryId: apiRepository.id,
      contributorId: aliceContributor.id,
      source: ActivitySource.github,
      type: ActivityType.commit,
      occurredAt: seedDate,
      metadata: { sha: commit.sha, message: commit.message },
    },
  });

  const report = await client.report.upsert({
    where: { id: 'seed_report_alice_2026_08_11' },
    update: {},
    create: {
      id: 'seed_report_alice_2026_08_11',
      userId: alice.id,
      reportDate,
      timezone: 'UTC',
      status: ReportStatus.pending,
      inputSnapshot: { date: '2026-08-11', repositories: ['trace-demo/api'] },
    },
  });

  await client.reportRevision.upsert({
    where: { id: 'seed_report_revision_1' },
    update: {},
    create: {
      id: 'seed_report_revision_1',
      reportId: report.id,
      revision: 1,
      source: ReportRevisionSource.manual,
      content: { executiveSummary: 'Seed report awaiting generation.' },
    },
  });

  await client.auditLog.upsert({
    where: { id: 'seed_audit_tracking_enabled' },
    update: {},
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

if (require.main === module) {
  void run();
}
