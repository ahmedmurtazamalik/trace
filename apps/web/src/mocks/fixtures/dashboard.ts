import { dashboardResponseSchema, type DashboardResponse, type DashboardState } from "@trace/shared";

const activity = {
  id: "activity_commit_1",
  repository: { id: "repo_1", fullName: "trace-fixture-org/trace", url: "https://github.com/trace-fixture-org/trace" },
  contributor: { id: "contributor_1", username: "alice-dev", displayName: "Alice Developer", avatarUrl: null },
  source: "github" as const,
  type: "commit" as const,
  occurredAt: "2026-08-12T09:30:00.000Z",
  facts: {
    sha: "0123456789abcdef0123456789abcdef01234567",
    message: "Add repository synchronization",
    branch: "main",
    filesChanged: 4,
    additions: 120,
    deletions: 18,
    url: "https://github.com/trace-fixture-org/trace/commit/0123456789abcdef0123456789abcdef01234567",
  },
};

function fixture(state: DashboardState, overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return dashboardResponseSchema.parse({
    date: "2026-08-12",
    timezone: "UTC",
    state,
    metrics: { activityCount: 2, repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 4, additions: 120, deletions: 18 },
    recentActivity: [activity],
    ...overrides,
  });
}

const zeroMetrics = { activityCount: 0, repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 };

export const dashboardFixtures = {
  ready: fixture("READY"),
  githubNotConnected: fixture("GITHUB_NOT_CONNECTED", { metrics: zeroMetrics, recentActivity: [] }),
  noTrackedRepositories: fixture("NO_TRACKED_REPOSITORIES", { metrics: zeroMetrics, recentActivity: [] }),
  noActivity: fixture("NO_ACTIVITY", { metrics: { ...zeroMetrics, repositoryCount: 1 }, recentActivity: [] }),
  partial: fixture("PARTIAL"),
} as const;
