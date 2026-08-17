import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { activityFixturePages } from "@/mocks/fixtures/activity";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";
import { login } from "./auth";
import { getGithubStatus, switchGithub } from "./github";
import { listRepositories, setRepositoryTracking } from "./repositories";
import { listActivity } from "./activity";
import { getDashboard } from "./dashboard";

const origin = "http://localhost:3001";
const session = {
  user: {
    id: "usr_01HXYZ",
    username: "alice.dev",
    displayName: "Alice Developer",
    email: "alice@example.com",
    createdAt: "2026-08-11T12:00:00.000Z",
  },
  csrfToken: "csrf_opaque_value",
};
const githubStatus = {
  accountConnection: {
    status: "CONNECTED" as const,
    account: {
      id: "github-account-1",
      username: "alice-dev",
      displayName: "Alice Developer",
      avatarUrl: "https://avatars.githubusercontent.com/u/12345",
    },
  },
  installationAuthorization: {
    status: "ACTIVE" as const,
    installation: {
      id: "installation-1",
      accountType: "ORGANIZATION" as const,
      accountLogin: "trace-example",
    },
  },
  accessibleRepositoryCount: 4,
  trackedRepositoryCount: 2,
  historyRetained: true as const,
};
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
  removed: false,
  lastActivityAt: null,
  contributorCount: 0,
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Day 12 API clients through the MSW HTTP boundary", () => {
  it("covers authentication request bodies, cookies, and contract validation", async () => {
    let observed: { credentials: RequestCredentials; body: unknown } | undefined;
    server.use(http.post(`${origin}/api/v1/auth/login`, async ({ request }) => {
      observed = { credentials: request.credentials, body: await request.json() };
      return HttpResponse.json(session);
    }));

    await expect(login({ username: "alice.dev", password: "correct-horse-battery-staple" })).resolves.toEqual(session);
    expect(observed).toEqual({
      credentials: "include",
      body: { username: "alice.dev", password: "correct-horse-battery-staple" },
    });
  });

  it("covers GitHub status and state-changing CSRF requests", async () => {
    let csrf: string | null = null;
    server.use(
      http.get(`${origin}/api/v1/github/status`, () => HttpResponse.json(githubStatus)),
      http.post(`${origin}/api/v1/github/switch`, ({ request }) => {
        csrf = request.headers.get("x-csrf-token");
        return HttpResponse.json({ authorizationUrl: "https://github.com/login/oauth/authorize?state=switch-state" });
      }),
    );

    await expect(getGithubStatus()).resolves.toEqual(githubStatus);
    await expect(switchGithub("csrf-github")).resolves.toMatchObject({ authorizationUrl: expect.stringMatching(/^https:\/\/github\.com\//) });
    expect(csrf).toBe("csrf-github");
  });

  it("covers repository search, pagination, and tracking mutations", async () => {
    let requestedUrl = "";
    let trackingCsrf: string | null = null;
    server.use(
      http.get(`${origin}/api/v1/repositories`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ items: [repository], pageInfo: { nextCursor: "next-page", hasNextPage: true } });
      }),
      http.post(`${origin}/api/v1/repositories/repo_01/tracking`, ({ request }) => {
        trackingCsrf = request.headers.get("x-csrf-token");
        return HttpResponse.json({ repositoryId: "repo_01", trackingEnabled: true });
      }),
    );

    await expect(listRepositories({ search: " web ", cursor: "cursor-1", limit: 25 })).resolves.toMatchObject({ items: [repository] });
    await expect(setRepositoryTracking("repo_01", true, "csrf-repository")).resolves.toEqual({ repositoryId: "repo_01", trackingEnabled: true });
    expect(new URL(requestedUrl).searchParams.toString()).toBe("limit=25&cursor=cursor-1&search=web");
    expect(trackingCsrf).toBe("csrf-repository");
  });

  it("covers activity filters and cursor responses", async () => {
    let requestedUrl = "";
    server.use(http.get(`${origin}/api/v1/activity`, ({ request }) => {
      requestedUrl = request.url;
      return HttpResponse.json(activityFixturePages.first);
    }));

    await expect(listActivity({
      date: "2026-08-12",
      timezone: "UTC",
      repositoryId: "repo-01",
      source: "github",
      type: "commit",
      limit: 25,
    })).resolves.toEqual(activityFixturePages.first);
    expect(new URL(requestedUrl).searchParams.toString()).toBe("date=2026-08-12&timezone=UTC&repositoryId=repo-01&source=github&type=commit&limit=25");
  });

  it("covers dashboard filters and validated factual states", async () => {
    let requestedUrl = "";
    server.use(http.get(`${origin}/api/v1/dashboard`, ({ request }) => {
      requestedUrl = request.url;
      return HttpResponse.json(dashboardFixtures.ready);
    }));

    await expect(getDashboard({ date: "2026-08-12", timezone: "UTC", repositoryId: "repo_1" })).resolves.toEqual(dashboardFixtures.ready);
    expect(new URL(requestedUrl).searchParams.toString()).toBe("date=2026-08-12&timezone=UTC&repositoryId=repo_1");
  });

  it("maps an expired session safely after a real intercepted HTTP response", async () => {
    server.use(http.get(`${origin}/api/v1/activity`, () => HttpResponse.json({
      code: "UNAUTHENTICATED",
      message: "internal session detail",
      requestId: "request-expired",
    }, { status: 401 })));

    await expect(listActivity({ timezone: "UTC" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
      requestId: "request-expired",
      message: "Your session has expired. Please sign in again.",
    });
  });
});
