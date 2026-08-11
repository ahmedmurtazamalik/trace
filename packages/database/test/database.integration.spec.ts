
import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';

const prisma = new PrismaClient();

describe('database foundation', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('contains one copy of each deterministic seed entity after repeated seeding', async () => {
    const [users, repositories, contributors, commits, reports] = await Promise.all([
      prisma.user.count({ where: { id: { startsWith: 'seed_' } } }),
      prisma.repository.count({ where: { id: { startsWith: 'seed_' } } }),
      prisma.contributor.count({ where: { id: { startsWith: 'seed_' } } }),
      prisma.commit.count({ where: { id: { startsWith: 'seed_' } } }),
      prisma.report.count({ where: { id: { startsWith: 'seed_' } } }),
    ]);

    expect({ users, repositories, contributors, commits, reports }).toEqual({
      users: 2,
      repositories: 2,
      contributors: 2,
      commits: 1,
      reports: 1,
    });
  });

  it('enforces canonical repository and SHA uniqueness in PostgreSQL', async () => {
    const existing = await prisma.commit.findUniqueOrThrow({ where: { id: 'seed_commit_api_foundation' } });

    await expect(
      prisma.commit.create({
        data: {
          repositoryId: existing.repositoryId,
          sha: existing.sha,
          message: 'Duplicate must be rejected',
          authoredAt: existing.authoredAt,
          committedAt: existing.committedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores tracking state per user rather than globally on repositories', async () => {
    const memberships = await prisma.userRepository.findMany({
      where: { repositoryId: 'seed_repository_web' },
      orderBy: { userId: 'asc' },
      select: { userId: true, trackingEnabled: true },
    });

    expect(memberships).toEqual([
      { userId: 'seed_user_alice', trackingEnabled: true },
      { userId: 'seed_user_bob', trackingEnabled: false },
    ]);
  });

  it('enforces case-insensitive Trace username and email ownership in PostgreSQL', async () => {
    const ids = ['test_ci_identity_owner', 'test_ci_username_conflict', 'test_ci_email_conflict'];
    await prisma.user.create({
      data: {
        id: ids[0],
        username: 'Case.Owner',
        email: 'case.owner@example.test',
        passwordHash: 'test-only-hash',
      },
    });

    try {
      await expect(prisma.user.create({
        data: {
          id: ids[1],
          username: 'CASE.OWNER',
          passwordHash: 'test-only-hash',
        },
      })).rejects.toMatchObject({ code: 'P2002' });

      await expect(prisma.user.create({
        data: {
          id: ids[2],
          username: 'different.owner',
          email: 'CASE.OWNER@EXAMPLE.TEST',
          passwordHash: 'test-only-hash',
        },
      })).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('prevents an artifact from referencing another report’s revision', async () => {
    const otherReport = await prisma.report.create({
      data: {
        id: 'test_cross_report_artifact_owner',
        userId: 'seed_user_bob',
        reportDate: new Date('2026-08-12T00:00:00.000Z'),
        timezone: 'UTC',
        inputSnapshot: { test: true },
      },
    });

    try {
      await expect(
        prisma.reportArtifact.create({
          data: {
            id: 'test_cross_report_artifact',
            reportId: otherReport.id,
            revisionId: 'seed_report_revision_1',
            kind: 'pdf',
            storageKey: 'test/cross-report.pdf',
            sizeBytes: 10,
            checksum: 'test-checksum',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    } finally {
      await prisma.report.delete({ where: { id: otherReport.id } });
    }
  });

  it('never resets credentials or reassigns identities on a seed rerun', async () => {
    const originalUser = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_alice' } });
    const originalGithub = await prisma.githubAccount.findUniqueOrThrow({ where: { id: 'seed_github_alice' } });
    const disabledAt = new Date('2026-08-11T18:00:00.000Z');
    const unlinkedAt = new Date('2026-08-11T18:01:00.000Z');

    await prisma.user.update({
      where: { id: originalUser.id },
      data: { passwordHash: 'sentinel-password-hash', disabledAt },
    });
    await prisma.githubAccount.update({
      where: { id: originalGithub.id },
      data: { userId: 'seed_user_bob', unlinkedAt },
    });

    const previousNodeEnv = process.env.NODE_ENV;
    const previousSeedFlag = process.env.ALLOW_DEMO_SEED;
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEMO_SEED = 'true';

    try {
      await seed(prisma);

      await expect(prisma.user.findUniqueOrThrow({ where: { id: originalUser.id } })).resolves.toMatchObject({
        passwordHash: 'sentinel-password-hash',
        disabledAt,
      });
      await expect(prisma.githubAccount.findUniqueOrThrow({ where: { id: originalGithub.id } })).resolves.toMatchObject({
        userId: 'seed_user_bob',
        unlinkedAt,
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousSeedFlag === undefined) delete process.env.ALLOW_DEMO_SEED;
      else process.env.ALLOW_DEMO_SEED = previousSeedFlag;

      await prisma.githubAccount.update({
        where: { id: originalGithub.id },
        data: { userId: originalGithub.userId, unlinkedAt: originalGithub.unlinkedAt },
      });
      await prisma.user.update({
        where: { id: originalUser.id },
        data: { passwordHash: originalUser.passwordHash, disabledAt: originalUser.disabledAt },
      });
    }
  });
});
