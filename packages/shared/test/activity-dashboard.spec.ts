import activityListFixture from './fixtures/activity/list.success.json';
import repositoryActivityFixture from './fixtures/activity/repository.success.json';
import dashboardFixture from './fixtures/dashboard/ready.success.json';
import {
  activityListQuerySchema,
  activityListResponseSchema,
  activitySummarySchema,
  dashboardQuerySchema,
  dashboardResponseSchema,
} from '../src';

describe('Frozen Day 5-7 activity and dashboard contract', () => {
  it('freezes bounded activity filters and stable cursor pagination', () => {
    expect(activityListQuerySchema.parse({
      date: '2026-08-12',
      timezone: 'Asia/Karachi',
      repositoryId: 'repo_1',
      contributorId: 'contributor_1',
      source: 'github',
      type: 'commit',
      limit: '25',
    })).toEqual({
      date: '2026-08-12',
      timezone: 'Asia/Karachi',
      repositoryId: 'repo_1',
      contributorId: 'contributor_1',
      source: 'github',
      type: 'commit',
      limit: 25,
    });
    expect(activityListResponseSchema.parse(activityListFixture)).toEqual(activityListFixture);
    expect(activityListResponseSchema.parse(repositoryActivityFixture)).toEqual(repositoryActivityFixture);
  });

  it('freezes deterministic dashboard state, metrics, and recent activity', () => {
    expect(dashboardQuerySchema.parse({ date: '2026-08-12', timezone: 'UTC', repositoryId: 'repo_1' })).toEqual({
      date: '2026-08-12', timezone: 'UTC', repositoryId: 'repo_1',
    });
    expect(dashboardResponseSchema.parse(dashboardFixture)).toEqual(dashboardFixture);
  });

  it('rejects secret-like, invalid-timezone, and unbounded fields', () => {
    expect(activityListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(activityListQuerySchema.safeParse({ cursor: 'c'.repeat(2_049) }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ date: '2026-08-12', repositoryId: 'r'.repeat(257) }).success).toBe(false);
    expect(activityListQuerySchema.safeParse({ timezone: 'not/a-zone' }).success).toBe(false);
    expect(activityListQuerySchema.safeParse({ source: 'github', type: 'untracked_file' }).success).toBe(false);
    expect(activityListResponseSchema.safeParse({
      ...activityListFixture,
      items: [{ ...activityListFixture.items[0], source: 'cli', type: 'push' }],
    }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ date: '2026-08-12', timezone: 'not/a-zone' }).success).toBe(false);
    expect(dashboardResponseSchema.safeParse({ ...dashboardFixture, timezone: 'not/a-zone' }).success).toBe(false);
    expect(activityListResponseSchema.safeParse({ ...activityListFixture, installationToken: 'secret' }).success).toBe(false);
    expect(dashboardResponseSchema.safeParse({ ...dashboardFixture, productivityScore: 99 }).success).toBe(false);
  });

  it('accepts only exact SHA-1 or SHA-256 Git object IDs in projected activity', () => {
    for (const length of [40, 64]) {
      expect(activitySummarySchema.safeParse({
        ...activityListFixture.items[0],
        facts: { ...activityListFixture.items[0]!.facts, sha: 'a'.repeat(length) },
      }).success).toBe(true);
    }
    for (const sha of ['a'.repeat(41), 'a'.repeat(42), 'a'.repeat(63), 'g'.repeat(40)]) {
      expect(activitySummarySchema.safeParse({
        ...activityListFixture.items[0],
        facts: { ...activityListFixture.items[0]!.facts, sha },
      }).success).toBe(false);
    }
  });

  it('bounds activity identifiers and projected display strings', () => {
    expect(activityListQuerySchema.safeParse({ repositoryId: 'r'.repeat(257) }).success).toBe(false);
    expect(activityListQuerySchema.safeParse({ contributorId: 'c'.repeat(257) }).success).toBe(false);
    expect(activitySummarySchema.safeParse({
      ...activityListFixture.items[0],
      facts: { ...activityListFixture.items[0]!.facts, message: 'm'.repeat(10_001) },
    }).success).toBe(false);
    expect(activitySummarySchema.safeParse({
      ...activityListFixture.items[0],
      contributor: { ...activityListFixture.items[0]!.contributor!, displayName: 'd'.repeat(257) },
    }).success).toBe(false);
  });
});
