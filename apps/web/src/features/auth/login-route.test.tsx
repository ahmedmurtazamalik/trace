import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginRoute } from "./login-route";

const replace = vi.fn();
const establishSession = vi.fn();
let returnTo = "/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams({ returnTo }),
}));

vi.mock("@/auth/session-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session-provider")>();
  return {
    ...actual,
    useAuthSession: () => ({ establishSession, status: "anonymous" }),
  };
});

vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./login-form", () => ({
  LoginForm: ({ onAuthenticated }: { onAuthenticated: (session: { csrfToken: string }) => void }) => (
    <button type="button" onClick={() => onAuthenticated({ csrfToken: "csrf" })}>Complete login</button>
  ),
}));

describe("LoginRoute invitation return", () => {
  beforeEach(() => {
    replace.mockReset();
    establishSession.mockReset();
    returnTo = "/dashboard";
    window.location.hash = "";
  });

  it("restores a valid invitation token from the login fragment after authentication", () => {
    returnTo = "/invitations/invitation_1";
    window.location.hash = "#token=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

    render(<LoginRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Complete login" }));

    expect(establishSession).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/invitations/invitation_1#token=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG");
  });

  it("does not attach an invitation token to an unrelated return path", () => {
    window.location.hash = "#token=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

    render(<LoginRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Complete login" }));

    expect(replace).toHaveBeenCalledWith("/dashboard");
  });
});
