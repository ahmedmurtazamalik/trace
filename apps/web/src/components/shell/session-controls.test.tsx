import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider, useAuthSession } from "@/auth/session-provider";
import { SessionControls } from "./session-controls";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session = {
  user: { id: "usr_1", username: "alice.dev", displayName: "Alice", email: null, createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "old_csrf",
};
const freshSession = {
  ...session,
  user: { ...session.user, username: "fresh.login", displayName: "Fresh Login" },
  csrfToken: "fresh_csrf",
};

function EstablishFreshSession() {
  const { establishSession } = useAuthSession();
  return <button type="button" onClick={() => establishSession(freshSession)}>Establish fresh session</button>;
}

describe("SessionControls", () => {
  beforeEach(() => { replace.mockClear(); });

  it("does not revoke the session when discarding unsaved report edits is declined", async () => {
    const revokeSession = vi.fn().mockResolvedValue({ success: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <AuthSessionProvider initialSession={session} revokeSession={revokeSession}>
        <SessionControls reportDirty />
      </AuthSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(revokeSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("does not redirect when a stale logout finishes after a fresh login", async () => {
    let finishLogout!: (value: { success: true }) => void;
    const revokeSession = vi.fn().mockReturnValue(new Promise<{ success: true }>((resolve) => { finishLogout = resolve; }));
    const user = userEvent.setup();
    render(
      <AuthSessionProvider initialSession={session} revokeSession={revokeSession}>
        <SessionControls />
        <EstablishFreshSession />
      </AuthSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Establish fresh session" }));
    finishLogout({ success: true });
    await screen.findByText("Fresh Login");

    expect(replace).not.toHaveBeenCalled();
  });
});
