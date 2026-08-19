import { afterEach, describe, expect, it, vi } from "vitest";
import { connectGithub, disconnectGithub, getGithubInstallation, getGithubStatus, GithubApiError, switchGithub } from "./github";

const connected = {
  accountConnection: { status: "CONNECTED" as const, account: { id: "github-account-1", username: "alice-dev", displayName: "Alice Developer", avatarUrl: "https://avatars.githubusercontent.com/u/12345" } },
  installationAuthorization: { status: "ACTIVE" as const, installation: { id: "installation-1", accountType: "ORGANIZATION" as const, accountLogin: "trace-example" } },
  accessibleRepositoryCount: 4,
  trackedRepositoryCount: 2,
  historyRetained: true as const,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("GitHub API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates status and connect responses with cookie credentials", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(connected))
      .mockResolvedValueOnce(response({ authorizationUrl: "https://github.com/login/oauth/authorize?client_id=trace&state=opaque-state" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubStatus()).resolves.toEqual(connected);
    await expect(connectGithub("csrf-value")).resolves.toEqual(expect.objectContaining({ authorizationUrl: expect.stringMatching(/^https:\/\/github\.com\//) }));
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.credentials])).toEqual([
      ["http://localhost:3001/api/v1/github/status", "GET", "include"],
      ["http://localhost:3001/api/v1/github/connect", "POST", "include"],
    ]);
  });

  it("starts confirmed account changes through the dedicated switch endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ authorizationUrl: "https://github.com/login/oauth/authorize?state=switch-state" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(switchGithub("csrf-value")).resolves.toEqual(expect.objectContaining({ authorizationUrl: expect.stringMatching(/^https:\/\/github\.com\//) }));
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/v1/github/switch", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": "csrf-value" },
    }));
  });

  it("sends disconnect CSRF only in the canonical header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ success: true, historyRetained: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(disconnectGithub("csrf-value")).resolves.toEqual({ success: true, historyRetained: true });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/v1/github/connection", expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      body: undefined,
      headers: { "x-csrf-token": "csrf-value" },
    }));
  });

  it("starts GitHub App installation through the contract endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      outcome: "INSTALL_REQUIRED",
      installationUrl: "https://github.com/apps/trace/installations/new?state=opaque-state",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubInstallation("csrf-value")).resolves.toEqual({
      outcome: "INSTALL_REQUIRED",
      installationUrl: "https://github.com/apps/trace/installations/new?state=opaque-state",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/github/installation",
      expect.objectContaining({ method: "POST", credentials: "include", headers: { "x-csrf-token": "csrf-value" } }),
    );
  });

  it("accepts the explicit already-connected installation outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ outcome: "CONNECTED" })));
    await expect(getGithubInstallation("csrf-value")).resolves.toEqual({ outcome: "CONNECTED" });
  });

  it("rejects malformed successes and hides raw backend failures", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ accountConnection: null }))
      .mockResolvedValueOnce(response({ code: "GITHUB_CALLBACK_FAILED", message: "raw provider secret", requestId: "request-1" }, 502)));

    await expect(getGithubStatus()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(connectGithub("csrf-value")).rejects.toEqual(expect.objectContaining({
      name: "GithubApiError",
      code: "GITHUB_CALLBACK_FAILED",
      message: "GitHub could not complete the connection. Please try again.",
    }));
    expect(new GithubApiError("NETWORK_ERROR", "safe", 0)).toBeInstanceOf(Error);
  });
});
