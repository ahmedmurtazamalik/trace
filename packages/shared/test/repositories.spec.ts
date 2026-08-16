import listFixture from './fixtures/repositories/list.success.json';
import detailFixture from './fixtures/repositories/detail.success.json';
import trackingFixture from './fixtures/repositories/tracking.enabled.json';
import {
  repositoryDetailResponseSchema,
  repositoryListQuerySchema,
  repositoryListResponseSchema,
  repositoryTrackingResponseSchema,
} from '../src/repositories';

describe('Day 4 repository contract', () => {
  it('freezes stable cursor pagination, search, and accessibility/tracking separation', () => {
    expect(repositoryListQuerySchema.parse({ limit: '25', search: 'trace' })).toEqual({ limit: 25, search: 'trace' });
    expect(repositoryListQuerySchema.safeParse({ cursor: 'c'.repeat(2_049) }).success).toBe(false);
    expect(repositoryListResponseSchema.parse(listFixture)).toEqual(listFixture);
  });

  it('freezes repository detail and idempotent tracking responses', () => {
    expect(repositoryDetailResponseSchema.parse(detailFixture)).toEqual(detailFixture);
    expect(repositoryTrackingResponseSchema.parse(trackingFixture)).toEqual(trackingFixture);
    expect(repositoryTrackingResponseSchema.safeParse({ repositoryId: 'repo_1', trackingEnabled: true, installationToken: 'secret' }).success).toBe(false);
  });
});
