import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

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
});
