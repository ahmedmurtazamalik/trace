import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/api/auth";
import { AuthSessionProvider } from "./session-provider";
import { ProtectedSession } from "./protected-session";

const replace = vi.fn();
let pathname = "/reports";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams("range=week"),
  useRouter: () => ({ replace }),
}));

const session = {
  user: { id: "usr_1", username: "alice.dev", displayName: "Alice", email: null, createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_value",
};

describe("ProtectedSession", () => {
  it("shows a stable loading state while session bootstrap is pending", () => {
    render(<AuthSessionProvider loadSession={() => new Promise(() => undefined)}><ProtectedSession>Private</ProtectedSession></AuthSessionProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Verifying your secure session…");
  });

  it("redirects anonymous users with an encoded local return path", async () => {
    window.location.hash = "";
    replace.mockReset();
    render(<AuthSessionProvider loadSession={vi.fn().mockRejectedValue(new AuthApiError("UNAUTHENTICATED", "expired", 401))}><ProtectedSession>Private</ProtectedSession></AuthSessionProvider>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Freports%3Frange%3Dweek"));
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("preserves an invitation token only in the login fragment", async () => {
    pathname = "/invitations/invitation_1";
    window.location.hash = "#token=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
    replace.mockReset();
    render(<AuthSessionProvider loadSession={vi.fn().mockRejectedValue(new AuthApiError("UNAUTHENTICATED", "expired", 401))}><ProtectedSession>Private</ProtectedSession></AuthSessionProvider>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Finvitations%2Finvitation_1%3Frange%3Dweek#token=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"));
    const destination = String(replace.mock.calls[0]?.[0]);
    expect(destination.slice(0, destination.indexOf("#"))).not.toContain("token");
    pathname = "/reports";
    window.location.hash = "";
  });

  it("renders protected content only for an authenticated session", () => {
    render(<AuthSessionProvider initialSession={session}><ProtectedSession><h1>Private</h1></ProtectedSession></AuthSessionProvider>);
    expect(screen.getByRole("heading", { name: "Private" })).toBeVisible();
  });
});
