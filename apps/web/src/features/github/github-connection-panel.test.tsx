import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "@/auth/session-provider";
import { GithubConnectionPanel } from "./github-connection-panel";

const session = {
  user: { id: "usr_01", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.test", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf-value",
};
const disconnected = {
  accountConnection: { status: "DISCONNECTED" as const, account: null },
  installationAuthorization: { status: "NOT_INSTALLED" as const, installation: null },
  accessibleRepositoryCount: 0,
  trackedRepositoryCount: 0,
  historyRetained: true as const,
};
const connected = {
  accountConnection: { status: "CONNECTED" as const, account: { id: "github-1", username: "alice-dev", displayName: "Alice Developer", avatarUrl: null } },
  installationAuthorization: { status: "ACTIVE" as const, installation: { id: "installation-1", accountType: "ORGANIZATION" as const, accountLogin: "trace-example" } },
  accessibleRepositoryCount: 4,
  trackedRepositoryCount: 2,
  historyRetained: true as const,
};
const reconnect = {
  ...connected,
  accountConnection: { ...connected.accountConnection, status: "RECONNECT_REQUIRED" as const },
  installationAuthorization: { ...connected.installationAuthorization, status: "SUSPENDED" as const },
  accessibleRepositoryCount: 0,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof GithubConnectionPanel>> = {}) {
  const props = {
    loadStatus: vi.fn().mockResolvedValue(disconnected),
    beginConnection: vi.fn().mockResolvedValue({ authorizationUrl: "https://github.com/login/oauth/authorize?client_id=trace&state=opaque" }),
    beginInstallation: vi.fn().mockResolvedValue({ installationUrl: "https://github.com/apps/trace/installations/new?state=opaque" }),
    revokeConnection: vi.fn().mockResolvedValue({ success: true, historyRetained: true }),
    navigate: vi.fn(),
    callbackResult: undefined,
    ...overrides,
  };
  render(<AuthSessionProvider initialSession={session}><GithubConnectionPanel {...props} /></AuthSessionProvider>);
  return props;
}

describe("GitHub connection UX", () => {
  it("loads the disconnected state and navigates only to the backend GitHub URL", async () => {
    const props = renderPanel();
    expect(await screen.findByRole("heading", { name: "Connect GitHub" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(props.navigate).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/github\.com\//));
  });

  it("restores the connect action when browser Back returns from GitHub", async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    expect(screen.getByRole("button", { name: "Opening GitHub…" })).toBeDisabled();

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

    expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeEnabled();
  });

  it("separates the linked account, installation, and repository counts", async () => {
    renderPanel({ loadStatus: vi.fn().mockResolvedValue(connected) });
    expect(await screen.findByText("@alice-dev")).toBeInTheDocument();
    expect(screen.getByText("trace-example")).toBeInTheDocument();
    expect(screen.getByText("4 accessible")).toBeInTheDocument();
    expect(screen.getByText("2 tracked")).toBeInTheDocument();
  });

  it("lets an active installation reopen GitHub to add repository access", async () => {
    const props = renderPanel({ loadStatus: vi.fn().mockResolvedValue(connected) });
    await userEvent.click(await screen.findByRole("button", { name: "Manage repository access" }));
    expect(props.beginInstallation).toHaveBeenCalledOnce();
    expect(props.navigate).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/github\.com\/apps\//));
  });

  it("offers installation and suspended-installation recovery through the backend URL", async () => {
    const notInstalled = {
      ...connected,
      installationAuthorization: { status: "NOT_INSTALLED" as const, installation: null },
      accessibleRepositoryCount: 0,
      trackedRepositoryCount: 0,
    };
    const props = renderPanel({ loadStatus: vi.fn().mockResolvedValue(notInstalled) });
    await userEvent.click(await screen.findByRole("button", { name: "Install GitHub App" }));
    expect(props.beginInstallation).toHaveBeenCalledOnce();
    expect(props.navigate).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/github\.com\/apps\//));

    const suspended = {
      ...connected,
      installationAuthorization: { ...connected.installationAuthorization, status: "SUSPENDED" as const },
      accessibleRepositoryCount: 0,
    };
    const suspendedProps = renderPanel({ loadStatus: vi.fn().mockResolvedValue(suspended) });
    await userEvent.click(await screen.findByRole("button", { name: "Update GitHub App installation" }));
    expect(suspendedProps.beginInstallation).toHaveBeenCalledOnce();
  });

  it("confirms disconnect, sends in-memory CSRF, and keeps history messaging", async () => {
    const revokeConnection = vi.fn().mockResolvedValue({ success: true, historyRetained: true });
    const loadStatus = vi.fn().mockResolvedValueOnce(connected).mockResolvedValueOnce(reconnect);
    renderPanel({ loadStatus, revokeConnection });
    await screen.findByText("@alice-dev");
    await userEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Historical activity remains in Trace");
    await userEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
    await waitFor(() => expect(revokeConnection).toHaveBeenCalledWith("csrf-value"));
    expect(await screen.findByRole("status")).toHaveTextContent("disconnected");
    expect(await screen.findByRole("heading", { name: "Reconnect GitHub" })).toBeInTheDocument();
    expect(loadStatus).toHaveBeenCalledTimes(2);
  });

  it("moves focus into the disconnect dialog, closes on Escape, and restores the trigger", async () => {
    renderPanel({ loadStatus: vi.fn().mockResolvedValue(connected) });
    const trigger = await screen.findByRole("button", { name: "Disconnect GitHub" });

    await userEvent.click(trigger);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps a successful disconnect truthful when the status refresh is unavailable", async () => {
    const loadStatus = vi.fn().mockResolvedValueOnce(connected).mockRejectedValueOnce(new Error("offline"));
    renderPanel({ loadStatus });
    await screen.findByText("@alice-dev");
    await userEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));

    expect(await screen.findByRole("heading", { name: "Reconnect GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Historical activity remains");
  });

  it("renders reconnect, suspended installation, and closed callback feedback safely", async () => {
    renderPanel({ loadStatus: vi.fn().mockResolvedValue(reconnect), callbackResult: { result: "error", reason: "callback_failed" } });
    expect(await screen.findByRole("button", { name: "Reconnect GitHub" })).toBeInTheDocument();
    expect(screen.getByText("Installation suspended")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("GitHub could not complete the connection");
    expect(screen.queryByText(/state|oauth|provider/i)).not.toBeInTheDocument();
  });

  it("does not offer disconnect when GitHub is already disconnected and needs reconnection", async () => {
    renderPanel({ loadStatus: vi.fn().mockResolvedValue(reconnect) });
    expect(await screen.findByRole("button", { name: "Reconnect GitHub" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Disconnect GitHub" })).not.toBeInTheDocument();
  });
});
