import { activityListResponseSchema, type ActivityListResponse, type ActivitySummary } from "@trace/shared";

const commit: ActivitySummary = {
  id: "activity-01",
  repository: { id: "repo-01", fullName: "trace-fixture-org/trace", url: "https://github.com/trace-fixture-org/trace" },
  contributor: { id: "contributor-01", username: "maya", displayName: "Maya Chen", avatarUrl: null },
  source: "github",
  type: "commit",
  occurredAt: "2026-08-12T09:42:00.000Z",
  facts: { sha: "a1b2c3d4", message: "Refine activity timeline", branch: "day5", filesChanged: 8, additions: 248, deletions: 31, url: "https://github.com/trace-fixture-org/trace/commit/a1b2c3d4" },
};

const push: ActivitySummary = {
  id: "activity-02",
  repository: { id: "repo-02", fullName: "trace-fixture-org/api", url: "https://github.com/trace-fixture-org/api" },
  contributor: { id: "external-01", username: "external-contributor", displayName: null, avatarUrl: null },
  source: "github",
  type: "push",
  occurredAt: "2026-08-12T08:18:00.000Z",
  facts: { sha: "b2c3d4e5", message: "Publish webhook acceptance", branch: "main", filesChanged: 3, additions: 74, deletions: 6, url: null },
};

const localCommit: ActivitySummary = {
  id: "activity-03",
  repository: { id: "repo-01", fullName: "trace-fixture-org/trace", url: null },
  contributor: null,
  source: "cli",
  type: "local_commit",
  occurredAt: "2026-08-11T16:05:00.000Z",
  facts: { sha: "c3d4e5f6", message: "Draft activity filters", branch: "day5", filesChanged: 2, additions: 31, deletions: 4, url: null },
};

const firstPage: ActivityListResponse = {
  items: [commit, push],
  pageInfo: { nextCursor: "activity-page-2", hasNextPage: true },
};
const secondPage: ActivityListResponse = {
  items: [push, localCommit],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

export const activityFixturePages: { first: ActivityListResponse; second: ActivityListResponse } = {
  first: activityListResponseSchema.parse(firstPage),
  second: activityListResponseSchema.parse(secondPage),
};

export const activityFixtureItems = activityListResponseSchema.parse({
  items: [commit, push, localCommit],
  pageInfo: { nextCursor: null, hasNextPage: false },
}).items;
