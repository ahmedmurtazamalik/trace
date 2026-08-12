import activityListFixture from './fixtures/activity/list.success.json';
import repositoryActivityFixture from './fixtures/activity/repository.success.json';
import dashboardFixture from './fixtures/dashboard/ready.success.json';
import {
  activityListQuerySchema,
  activityListResponseSchema,
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
});
