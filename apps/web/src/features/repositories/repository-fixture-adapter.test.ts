import { afterEach, describe, expect, it, vi } from "vitest";
import { listFixtureRepositories, updateFixtureRepositoryTracking } from "./repository-fixture-adapter";

describe("repository fixture adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns data validated by the frozen repository contract", async () => {
    const result = await listFixtureRepositories();
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ fullName: "trace-fixture-org/trace", accessible: true, trackingEnabled: false });
    expect(result.items[2]).toMatchObject({ url: null, accessible: false, trackingEnabled: true });
  });

  it("returns a contract-shaped tracking result without changing GitHub accessibility", async () => {
    const result = await updateFixtureRepositoryTracking("repo_01", true);
    expect(result).toEqual({ repositoryId: "repo_01", trackingEnabled: true });

    const repositories = await listFixtureRepositories();
    expect(repositories.items.find((repository) => repository.id === "repo_01")).toMatchObject({ accessible: true, trackingEnabled: true });
  });
});
