import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/api/auth";
import { AuthSessionProvider, safeReturnPath, useAuthSession } from "./session-provider";

const session = {
  user: { id: "usr_1", username: "alice.dev", displayName: "Alice", email: null, createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_value",
};

describe("AuthSessionProvider", () => {
  it("bootstraps an authenticated cookie session", async () => {
    const loadSession = vi.fn().mockResolvedValue(session);
    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }) => <AuthSessionProvider loadSession={loadSession}>{children}</AuthSessionProvider>,
    });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.user?.username).toBe("alice.dev");
  });

  it("treats an unauthenticated bootstrap as a normal anonymous state", async () => {
    const loadSession = vi.fn().mockRejectedValue(new AuthApiError("UNAUTHENTICATED", "expired", 401));
    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }) => <AuthSessionProvider loadSession={loadSession}>{children}</AuthSessionProvider>,
    });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.error).toBeUndefined();
  });

  it("does not let a late bootstrap overwrite a newly established session", async () => {
    let finishBootstrap!: (value: typeof session) => void;
    const loadSession = vi.fn().mockReturnValue(new Promise<typeof session>((resolve) => { finishBootstrap = resolve; }));
    const freshSession = { ...session, user: { ...session.user, username: "fresh.login" }, csrfToken: "fresh_csrf" };
    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }) => <AuthSessionProvider loadSession={loadSession}>{children}</AuthSessionProvider>,
    });

    act(() => result.current.establishSession(freshSession));
    await act(async () => finishBootstrap(session));

    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.username).toBe("fresh.login");
  });

  it("logs out with the in-memory CSRF token and clears state", async () => {
    const revokeSession = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }) => <AuthSessionProvider initialSession={session} revokeSession={revokeSession}>{children}</AuthSessionProvider>,
    });
    const didSignOut = await act(async () => result.current.signOut());
    expect(didSignOut).toBe(true);
    expect(revokeSession).toHaveBeenCalledWith("csrf_value");
    expect(result.current.status).toBe("anonymous");
  });

  it("does not let a late logout clear a newly established session", async () => {
    let finishLogout!: (value: { success: true }) => void;
    const revokeSession = vi.fn().mockReturnValue(new Promise<{ success: true }>((resolve) => { finishLogout = resolve; }));
    const freshSession = { ...session, user: { ...session.user, username: "fresh.login" }, csrfToken: "fresh_csrf" };
    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }) => <AuthSessionProvider initialSession={session} revokeSession={revokeSession}>{children}</AuthSessionProvider>,
    });

    let pendingLogout!: Promise<boolean>;
    act(() => { pendingLogout = result.current.signOut(); });
    act(() => result.current.establishSession(freshSession));
    let didSignOut!: boolean;
    await act(async () => {
      finishLogout({ success: true });
      didSignOut = await pendingLogout;
    });

    expect(didSignOut).toBe(false);
    expect(result.current.user?.username).toBe("fresh.login");
    expect(result.current.isSigningOut).toBe(false);
  });

  it("restores the authenticated state when revocation fails", async () => {
    const revokeSession = vi.fn().mockRejectedValue(new AuthApiError("NETWORK_ERROR", "Could not sign out.", 0));
    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }) => <AuthSessionProvider initialSession={session} revokeSession={revokeSession}>{children}</AuthSessionProvider>,
    });

    await act(async () => {
      await expect(result.current.signOut()).rejects.toThrow("Could not sign out.");
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.isSigningOut).toBe(false);
    expect(result.current.user?.username).toBe("alice.dev");
  });
});

describe("safeReturnPath", () => {
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%5cevil.test",
    "/login",
    "/register",
    "javascript:alert(1)",
  ])("rejects unsafe return %s", (value) => {
    expect(safeReturnPath(value)).toBe("/dashboard");
  });
  it("accepts an internal protected path", () => expect(safeReturnPath("/reports?range=week")).toBe("/reports?range=week"));
});
