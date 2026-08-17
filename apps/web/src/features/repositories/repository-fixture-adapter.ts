import {
  repositoryListResponseSchema,
  repositoryTrackingResponseSchema,
  type RepositoryListResponse,
  type RepositoryTrackingResponse,
} from "@trace/shared";

const fixturePayload: unknown = {
  items: [
    {
      id: "repo_01",
      owner: "trace-fixture-org",
      name: "trace",
      fullName: "trace-fixture-org/trace",
      private: true,
      defaultBranch: "main",
      url: "https://github.com/trace-fixture-org/trace",
      accessible: true,
      trackingEnabled: false,
      removed: false,
      lastActivityAt: "2026-08-12T09:30:00.000Z",
      contributorCount: 3,
    },
    {
      id: "repo_02",
      owner: "trace-fixture-org",
      name: "docs",
      fullName: "trace-fixture-org/docs",
      private: false,
      defaultBranch: "main",
      url: "https://github.com/trace-fixture-org/docs",
      accessible: true,
      trackingEnabled: true,
      removed: false,
      lastActivityAt: "2026-08-11T16:45:00.000Z",
      contributorCount: 2,
    },
    {
      id: "repo_03",
      owner: "archive-fixture-org",
      name: "legacy-api",
      fullName: "archive-fixture-org/legacy-api",
      private: false,
      defaultBranch: "trunk",
      url: null,
      accessible: false,
      trackingEnabled: true,
      removed: false,
      lastActivityAt: null,
      contributorCount: 0,
    },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

let repositories = repositoryListResponseSchema.parse(fixturePayload);

/** Contract-validated deterministic data until Person A's Day 4 endpoints integrate. */
export async function listFixtureRepositories(): Promise<RepositoryListResponse> {
  return repositoryListResponseSchema.parse(repositories);
}

/** Mimics an idempotent tracking completion without changing provider accessibility. */
export async function updateFixtureRepositoryTracking(repositoryId: string, trackingEnabled: boolean): Promise<RepositoryTrackingResponse> {
  const repository = repositories.items.find((item) => item.id === repositoryId);
  if (repository === undefined || !repository.accessible) throw new Error("Repository tracking is unavailable.");

  repositories = repositoryListResponseSchema.parse({
    ...repositories,
    items: repositories.items.map((item) => item.id === repositoryId ? { ...item, trackingEnabled } : item),
  });
  return repositoryTrackingResponseSchema.parse({ repositoryId, trackingEnabled });
}
