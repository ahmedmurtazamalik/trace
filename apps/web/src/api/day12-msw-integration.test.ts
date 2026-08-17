import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { activityFixturePages } from "@/mocks/fixtures/activity";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";
import { forgotPassword, getSession, login, logout, register, resetPassword } from "./auth";
import { connectGithub, disconnectGithub, getGithubInstallation, getGithubStatus, switchGithub } from "./github";
import { getRepository, listRepositories, setRepositoryRemoved, setRepositoryTracking, synchronizeRepositories } from "./repositories";
import { listActivity, listRepositoryActivity } from "./activity";
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

  it("covers the complete authentication lifecycle through MSW", async () => {
    const observedCsrf: Array<string | null> = [];
    server.use(
      http.post(`${origin}/api/v1/auth/register`, () => HttpResponse.json(session, { status: 201 })),
      http.get(`${origin}/api/v1/auth/me`, () => HttpResponse.json(session)),
      http.post(`${origin}/api/v1/auth/logout`, ({ request }) => {
        observedCsrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ success: true });
      }),
      http.post(`${origin}/api/v1/auth/password/forgot`, () => HttpResponse.json({
        message: "If the account exists, password reset instructions have been sent.",
      }, { status: 202 })),
      http.post(`${origin}/api/v1/auth/password/reset`, () => HttpResponse.json({ success: true })),
    );

    await expect(register({
      username: "alice.dev",
      displayName: "Alice Developer",
      email: "alice@example.com",
      password: "correct-horse-battery-staple",
    })).resolves.toEqual(session);
    await expect(getSession()).resolves.toEqual(session);
    await expect(logout("csrf-auth")).resolves.toEqual({ success: true });
    await expect(forgotPassword({ identifier: "alice@example.com" })).resolves.toMatchObject({ message: expect.stringContaining("If the account exists") });
    await expect(resetPassword({ token: "opaque-reset-token", password: "correct-horse-battery-staple" })).resolves.toEqual({ success: true });
    expect(observedCsrf).toEqual(["csrf-auth"]);
  });

  it("covers the complete GitHub lifecycle and state-changing CSRF requests", async () => {
    const csrf: Array<string | null> = [];
    server.use(
      http.get(`${origin}/api/v1/github/status`, () => HttpResponse.json(githubStatus)),
      http.post(`${origin}/api/v1/github/connect`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ authorizationUrl: "https://github.com/login/oauth/authorize?state=connect-state" });
      }),
      http.post(`${origin}/api/v1/github/switch`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ authorizationUrl: "https://github.com/login/oauth/authorize?state=switch-state" });
      }),
      http.post(`${origin}/api/v1/github/installation`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ installationUrl: "https://github.com/apps/trace/installations/new?state=installation-state" });
      }),
      http.delete(`${origin}/api/v1/github/connection`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ success: true, historyRetained: true });
      }),
    );

    await expect(getGithubStatus()).resolves.toEqual(githubStatus);
    await expect(connectGithub("csrf-connect")).resolves.toMatchObject({ authorizationUrl: expect.stringMatching(/^https:\/\/github\.com\//) });
    await expect(switchGithub("csrf-github")).resolves.toMatchObject({ authorizationUrl: expect.stringMatching(/^https:\/\/github\.com\//) });
    await expect(getGithubInstallation("csrf-install")).resolves.toMatchObject({ installationUrl: expect.stringMatching(/^https:\/\/github\.com\/apps\//) });
    await expect(disconnectGithub("csrf-disconnect")).resolves.toEqual({ success: true, historyRetained: true });
    expect(csrf).toEqual(["csrf-connect", "csrf-github", "csrf-install", "csrf-disconnect"]);
  });

  it("covers repository search, detail, synchronization, tracking, removal, and restoration", async () => {
    let requestedUrl = "";
    const csrf: Array<string | null> = [];
    server.use(
      http.get(`${origin}/api/v1/repositories`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ items: [repository], pageInfo: { nextCursor: "next-page", hasNextPage: true } });
      }),
      http.get(`${origin}/api/v1/repositories/repo_01`, () => HttpResponse.json({ repository })),
      http.post(`${origin}/api/v1/repositories/sync`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ accessibleRepositoryCount: 1 });
      }),
      http.post(`${origin}/api/v1/repositories/repo_01/tracking`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ repositoryId: "repo_01", trackingEnabled: true });
      }),
      http.delete(`${origin}/api/v1/repositories/repo_01`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ repositoryId: "repo_01", trackingEnabled: false, removed: true });
      }),
      http.post(`${origin}/api/v1/repositories/repo_01/restore`, ({ request }) => {
        csrf.push(request.headers.get("x-csrf-token"));
        return HttpResponse.json({ repositoryId: "repo_01", trackingEnabled: false, removed: false });
      }),
    );

    await expect(listRepositories({ search: " web ", cursor: "cursor-1", limit: 25 })).resolves.toMatchObject({ items: [repository] });
    await expect(getRepository("repo_01")).resolves.toEqual({ repository });
    await expect(synchronizeRepositories("csrf-sync")).resolves.toEqual({ accessibleRepositoryCount: 1 });
    await expect(setRepositoryTracking("repo_01", true, "csrf-repository")).resolves.toEqual({ repositoryId: "repo_01", trackingEnabled: true });
    await expect(setRepositoryRemoved("repo_01", true, "csrf-remove")).resolves.toEqual({ repositoryId: "repo_01", trackingEnabled: false, removed: true });
    await expect(setRepositoryRemoved("repo_01", false, "csrf-restore")).resolves.toEqual({ repositoryId: "repo_01", trackingEnabled: false, removed: false });
    expect(new URL(requestedUrl).searchParams.toString()).toBe("limit=25&cursor=cursor-1&search=web");
    expect(csrf).toEqual(["csrf-sync", "csrf-repository", "csrf-remove", "csrf-restore"]);
  });

  it("covers global and repository-scoped activity filters and cursor responses", async () => {
    let requestedUrl = "";
    let repositoryUrl = "";
    server.use(
      http.get(`${origin}/api/v1/activity`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(activityFixturePages.first);
      }),
      http.get(`${origin}/api/v1/repositories/repo%2Fid/activity`, ({ request }) => {
        repositoryUrl = request.url;
        return HttpResponse.json(activityFixturePages.second);
      }),
    );

    await expect(listActivity({
      date: "2026-08-12",
      timezone: "UTC",
      repositoryId: "repo-01",
      source: "github",
      type: "commit",
      limit: 25,
    })).resolves.toEqual(activityFixturePages.first);
    await expect(listRepositoryActivity("repo/id", { timezone: "UTC", cursor: "activity-page-2", limit: 25 })).resolves.toEqual(activityFixturePages.second);
    expect(new URL(requestedUrl).searchParams.toString()).toBe("date=2026-08-12&timezone=UTC&repositoryId=repo-01&source=github&type=commit&limit=25");
    expect(new URL(repositoryUrl).searchParams.toString()).toBe("timezone=UTC&cursor=activity-page-2&limit=25");
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

  it("keeps a mutation pending before mapping a delayed expired-session response safely", async () => {
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(`${origin}/api/v1/repositories/repo_01/tracking`, async () => {
      await responseGate;
      return HttpResponse.json({
        code: "UNAUTHENTICATED",
        message: "internal session detail",
        requestId: "request-expired",
      }, { status: 401 });
    }));

    const pending = setRepositoryTracking("repo_01", true, "csrf-expired");
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();

    await expect(pending).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
      requestId: "request-expired",
      message: "Your session has expired. Please sign in again.",
    });
  });
});
