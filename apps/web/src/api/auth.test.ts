import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  forgotPassword,
  getSession,
  login,
  logout,
  register,
  resetPassword,
} from "./auth";

const validSession = {
  user: {
    id: "usr_01HXYZ",
    username: "alice.dev",
    displayName: "Alice Developer",
    email: "alice@example.com",
    createdAt: "2026-08-11T12:00:00.000Z",
  },
  csrfToken: "csrf_opaque_value",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("auth API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("logs in with cookie credentials and validates the session contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validSession));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(
      login({ username: "alice.dev", password: "correct-horse-battery-staple" }, { signal }),
    ).resolves.toEqual(validSession);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/auth/login",
      expect.objectContaining({ method: "POST", credentials: "include", signal }),
    );
  });

  it("normalizes a documented API error without exposing an unsafe server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      code: "INVALID_CREDENTIALS",
      message: "internal credential comparison detail",
      requestId: "request-123",
    }, 401)));

    await expect(login({ username: "alice.dev", password: "wrong" })).rejects.toMatchObject({
      name: "AuthApiError",
      code: "INVALID_CREDENTIALS",
      status: 401,
      requestId: "request-123",
      message: "The username or password is incorrect.",
    });
  });

  it("converts malformed failures into a generic safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway detail", { status: 500 })));

    await expect(getSession()).rejects.toEqual(
      expect.objectContaining({ code: "UNEXPECTED_ERROR", message: "Trace could not complete the request. Please try again." }),
    );
  });

  it("throws a response-contract error when success JSON is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ user: null, csrfToken: "" })));

    await expect(getSession()).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_RESPONSE", message: "Trace received an invalid response. Please try again." }),
    );
  });

  it("forwards cancellation without converting the AbortError", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(getSession({ signal: new AbortController().signal })).rejects.toBe(abortError);
  });

  it("calls every frozen endpoint with the documented method and body", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(validSession, 201))
      .mockResolvedValueOnce(jsonResponse(validSession))
      .mockResolvedValueOnce(jsonResponse({ message: "If the account exists, password reset instructions have been sent." }, 202))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await register({ username: "alice.dev", displayName: "Alice", email: "alice@example.com", password: "correct-horse-battery-staple" });
    await getSession();
    await forgotPassword({ identifier: "alice@example.com" });
    await resetPassword({ token: "opaque-reset-token", password: "correct-horse-battery-staple" });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["http://localhost:3001/api/v1/auth/register", "POST"],
      ["http://localhost:3001/api/v1/auth/me", "GET"],
      ["http://localhost:3001/api/v1/auth/password/forgot", "POST"],
      ["http://localhost:3001/api/v1/auth/password/reset", "POST"],
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === "include")).toBe(true);
  });

  it("sends logout CSRF only in the canonical header and no request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout("csrf_opaque_value")).resolves.toEqual({ success: true });

    const [, init] = fetchMock.mock.calls[0];
    expect(init).toEqual(expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: undefined,
      headers: { "x-csrf-token": "csrf_opaque_value" },
    }));
  });

  it("provides a typed error guard for UI state handling", () => {
    expect(new AuthApiError("RATE_LIMITED", "Try later", 429, "request-1")).toBeInstanceOf(Error);
  });
});
