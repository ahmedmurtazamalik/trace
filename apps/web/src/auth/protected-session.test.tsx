import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/api/auth";
import { AuthSessionProvider } from "./session-provider";
import { ProtectedSession } from "./protected-session";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
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
    replace.mockReset();
    render(<AuthSessionProvider loadSession={vi.fn().mockRejectedValue(new AuthApiError("UNAUTHENTICATED", "expired", 401))}><ProtectedSession>Private</ProtectedSession></AuthSessionProvider>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Freports%3Frange%3Dweek"));
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("renders protected content only for an authenticated session", () => {
    render(<AuthSessionProvider initialSession={session}><ProtectedSession><h1>Private</h1></ProtectedSession></AuthSessionProvider>);
    expect(screen.getByRole("heading", { name: "Private" })).toBeVisible();
  });
});
