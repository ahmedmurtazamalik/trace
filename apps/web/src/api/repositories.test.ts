import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RepositoryApiError,
  getRepository,
  listRepositories,
  setRepositoryTracking,
  synchronizeRepositories,
} from "./repositories";

const repository = {
  id: "repo_01",
  owner: "trace-fixture-org",
  name: "web",
  fullName: "trace-fixture-org/web",
  private: true,
  defaultBranch: "main",
  url: "https://github.com/trace-fixture-org/web",
  accessible: true,
  trackingEnabled: false,
  lastActivityAt: null,
  contributorCount: 0,
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("repository API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists with server search/cursor and validates the shared response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [repository], pageInfo: { nextCursor: "next", hasNextPage: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRepositories({ search: " web ", cursor: "cursor", limit: 20 })).resolves.toMatchObject({ items: [repository] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/repositories?limit=20&cursor=cursor&search=web",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("loads detail and rejects an invalid success payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ repository }))
      .mockResolvedValueOnce(jsonResponse({ repository: { id: "broken" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRepository("repo_01")).resolves.toEqual({ repository });
    await expect(getRepository("bad id")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3001/api/v1/repositories/repo_01");
  });

  it("synchronizes and toggles tracking with cookie credentials and in-memory CSRF", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ accessibleRepositoryCount: 2 }))
      .mockResolvedValueOnce(jsonResponse({ repositoryId: "repo_01", trackingEnabled: true }))
      .mockResolvedValueOnce(jsonResponse({ repositoryId: "repo_01", trackingEnabled: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(synchronizeRepositories("csrf-live")).resolves.toEqual({ accessibleRepositoryCount: 2 });
    await expect(setRepositoryTracking("repo_01", true, "csrf-live")).resolves.toMatchObject({ trackingEnabled: true });
    await expect(setRepositoryTracking("repo_01", false, "csrf-live")).resolves.toMatchObject({ trackingEnabled: false });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.headers])).toEqual([
      ["http://localhost:3001/api/v1/repositories/sync", "POST", { "x-csrf-token": "csrf-live" }],
      ["http://localhost:3001/api/v1/repositories/repo_01/tracking", "POST", { "x-csrf-token": "csrf-live" }],
      ["http://localhost:3001/api/v1/repositories/repo_01/tracking", "DELETE", { "x-csrf-token": "csrf-live" }],
    ]);
  });

  it("maps repository lifecycle errors to safe actionable messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: "GITHUB_INSTALLATION_SUSPENDED", message: "raw provider detail", requestId: "request-1" }, 409)));

    await expect(synchronizeRepositories("csrf-live")).rejects.toEqual(expect.objectContaining<Partial<RepositoryApiError>>({
      code: "GITHUB_INSTALLATION_SUSPENDED",
      message: "The GitHub App installation is suspended. Restore it before synchronizing repositories.",
      status: 409,
    }));
  });
});
