import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryListResponse } from "@trace/shared";
import { RepositoryApiError } from "@/api/repositories";
import { RepositoryManagementPanel } from "./repository-management-panel";

const repositories: RepositoryListResponse = {
  items: [
    { id: "repo_01", owner: "trace-fixture-org", name: "trace", fullName: "trace-fixture-org/trace", private: true, defaultBranch: "main", url: "https://github.com/trace-fixture-org/trace", accessible: true, trackingEnabled: false, removed: false, lastActivityAt: "2026-08-12T09:30:00.000Z", contributorCount: 3 },
    { id: "repo_02", owner: "archive-fixture-org", name: "legacy-api", fullName: "archive-fixture-org/legacy-api", private: false, defaultBranch: "trunk", url: null, accessible: false, trackingEnabled: true, removed: false, lastActivityAt: null, contributorCount: 0 },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof RepositoryManagementPanel>> = {}) {
  const removedRepository = { ...repositories.items[0], trackingEnabled: false, removed: true };
  const loadRepositories = vi.fn().mockImplementation(async (query: { search?: string; visibility?: string }) => ({
    ...repositories,
    items: query.visibility === "removed"
      ? [removedRepository]
      : query.search ? repositories.items.filter((item) => item.fullName.includes(query.search!)) : repositories.items,
  }));
  const props = {
    initialSearch: "",
    csrfToken: "csrf-live",
    loadRepositories,
    updateTracking: vi.fn().mockImplementation(async (repositoryId: string, trackingEnabled: boolean) => ({ repositoryId, trackingEnabled })),
    updateMembership: vi.fn().mockImplementation(async (repositoryId: string, removed: boolean) => ({ repositoryId, trackingEnabled: false, removed })),
    synchronize: vi.fn().mockResolvedValue({ accessibleRepositoryCount: 2 }),
    onSearchChange: vi.fn(),
    ...overrides,
  };
  render(<RepositoryManagementPanel {...props} />);
  return props;
}

describe("repository management", () => {
  it("separates access from tracking, links detail, and permits historical untracking", async () => {
    renderPanel();
    expect(await screen.findByRole("link", { name: "trace-fixture-org/trace" })).toHaveAttribute("href", "/repositories/repo_01");
    expect(screen.getByText("GitHub access active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Track trace-fixture-org/trace" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "archive-fixture-org/legacy-api" })).toHaveAttribute("href", "/repositories/repo_02");
    expect(screen.getByText("Historical access only")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open on GitHub/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" })).toBeEnabled();
  });

  it("explains that GitHub must be reconnected before historical tracking can resume", async () => {
    renderPanel();
    await screen.findByRole("link", { name: "archive-fixture-org/legacy-api" });
    await userEvent.click(screen.getByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm stop tracking" }));

    expect(screen.getByRole("button", { name: "Reconnect GitHub to track archive-fixture-org/legacy-api" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", "/github");
  });

  it("debounces server search, resets the list, and reports URL query changes", async () => {
    const props = renderPanel();
    const search = await screen.findByRole("searchbox", { name: "Search repositories" });
    await userEvent.type(search, "legacy");
    expect(props.onSearchChange).toHaveBeenLastCalledWith("legacy");
    await waitFor(() => expect(props.loadRepositories).toHaveBeenLastCalledWith(expect.objectContaining({ search: "legacy" }), expect.any(Object)));
    expect(await screen.findByRole("link", { name: "archive-fixture-org/legacy-api" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "trace-fixture-org/trace" })).not.toBeInTheDocument();
  });

  it("sends the in-memory CSRF token for tracking and rolls back safely on failure", async () => {
    const updateTracking = vi.fn().mockRejectedValue(new RepositoryApiError("SERVICE_UNAVAILABLE", "Tracking is temporarily unavailable.", 503));
    renderPanel({ updateTracking });
    const button = await screen.findByRole("button", { name: "Track trace-fixture-org/trace" });
    await userEvent.click(button);
    expect(updateTracking).toHaveBeenCalledWith("repo_01", true, "csrf-live");
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("button", { name: "Track trace-fixture-org/trace" })).toBeEnabled();
  });

  it("confirms saved tracking settings and allows another change while access remains active", async () => {
    renderPanel();
    const enable = await screen.findByRole("button", { name: "Track trace-fixture-org/trace" });
    await userEvent.click(enable);

    expect(await screen.findByRole("status")).toHaveTextContent("Tracking enabled for trace-fixture-org/trace");
    const disable = screen.getByRole("button", { name: "Stop tracking trace-fixture-org/trace" });
    expect(disable).toBeEnabled();
    await userEvent.click(disable);
    await userEvent.click(screen.getByRole("button", { name: "Confirm stop tracking" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Tracking stopped for trace-fixture-org/trace");
    expect(screen.getByRole("button", { name: "Track trace-fixture-org/trace" })).toBeEnabled();
  });

  it("requires confirmation before stopping tracking", async () => {
    const updateTracking = vi.fn().mockImplementation(async (repositoryId: string, trackingEnabled: boolean) => ({ repositoryId, trackingEnabled }));
    renderPanel({ updateTracking });
    const stop = await screen.findByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" });

    await userEvent.click(stop);

    expect(updateTracking).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Stop tracking repository?" })).toHaveTextContent("archive-fixture-org/legacy-api");
    await userEvent.click(screen.getByRole("button", { name: "Confirm stop tracking" }));
    expect(updateTracking).toHaveBeenCalledWith("repo_02", false, "csrf-live");
  });

  it("removes a repository only after confirmation and restores it from the removed view", async () => {
    const updateMembership = vi.fn().mockImplementation(async (repositoryId: string, removed: boolean) => ({ repositoryId, trackingEnabled: false, removed }));
    renderPanel({ updateMembership });
    const remove = await screen.findByRole("button", { name: "Remove trace-fixture-org/trace" });

    await userEvent.click(remove);
    expect(updateMembership).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Remove repository?" })).toHaveTextContent("automatically stop tracking");
    await userEvent.click(screen.getByRole("button", { name: "Confirm remove repository" }));

    expect(updateMembership).toHaveBeenCalledWith("repo_01", true, "csrf-live");
    expect(await screen.findByRole("status")).toHaveTextContent("Removed trace-fixture-org/trace");
    expect(screen.queryByRole("link", { name: "trace-fixture-org/trace" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "View removed repositories" }));
    expect(await screen.findByText("Removed repositories")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore trace-fixture-org/trace" }));
    expect(updateMembership).toHaveBeenLastCalledWith("repo_01", false, "csrf-live");
    expect(await screen.findByRole("status")).toHaveTextContent("Restored trace-fixture-org/trace");
  });

  it.each([
    [401, "UNAUTHENTICATED", "Your session has expired. Please sign in again."],
    [403, "UNEXPECTED_ERROR", "Trace could not complete the repository request. Please try again."],
  ] as const)("clears stale protected repository data after a %i refresh", async (status, code, safeMessage) => {
    const loadRepositories = vi.fn()
      .mockResolvedValueOnce(repositories)
      .mockRejectedValueOnce(new RepositoryApiError(code, safeMessage, status));
    renderPanel({ loadRepositories });
    expect(await screen.findByRole("link", { name: "trace-fixture-org/trace" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "View removed repositories" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(safeMessage);
    expect(screen.queryByRole("link", { name: "trace-fixture-org/trace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "archive-fixture-org/legacy-api" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Track|Remove|Restore/ })).not.toBeInTheDocument();
  });

  it("ignores an older pagination response after an authorization failure clears protected data", async () => {
    let resolveOlderPage!: (response: RepositoryListResponse) => void;
    const loadRepositories = vi.fn()
      .mockResolvedValueOnce({ ...repositories, items: [repositories.items[0]], pageInfo: { nextCursor: "cursor-2", hasNextPage: true } })
      .mockImplementationOnce(() => new Promise<RepositoryListResponse>((resolve) => {
        resolveOlderPage = resolve;
      }));
    const updateTracking = vi.fn().mockRejectedValue(
      new RepositoryApiError("UNAUTHENTICATED", "Your session has expired. Please sign in again.", 401),
    );
    renderPanel({ loadRepositories, updateTracking });
    await screen.findByRole("link", { name: "trace-fixture-org/trace" });

    await userEvent.click(screen.getByRole("button", { name: "Load more repositories" }));
    await waitFor(() => expect(loadRepositories).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Track trace-fixture-org/trace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired");

    await act(async () => {
      resolveOlderPage({ ...repositories, items: [repositories.items[1]], pageInfo: { nextCursor: null, hasNextPage: false } });
    });

    expect(screen.queryByRole("link", { name: "archive-fixture-org/legacy-api" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "trace-fixture-org/trace" })).not.toBeInTheDocument();
  });

  it("does not expose unexpected internal repository errors", async () => {
    renderPanel({ loadRepositories: vi.fn().mockRejectedValue(new Error("postgres host=internal-db password=secret")) });

    expect(await screen.findByRole("alert")).toHaveTextContent("Trace could not load repositories. Please try again.");
    expect(screen.queryByText(/internal-db|password=secret/)).not.toBeInTheDocument();
  });

  it("synchronizes with CSRF and reloads the authoritative list", async () => {
    const props = renderPanel();
    await screen.findByRole("link", { name: "trace-fixture-org/trace" });
    expect(screen.getByRole("link", { name: "Manage GitHub access" })).toHaveAttribute("href", "/github");
    await userEvent.click(screen.getByRole("button", { name: "Add or refresh repositories" }));
    expect(props.synchronize).toHaveBeenCalledWith("csrf-live");
    expect(await screen.findByRole("status")).toHaveTextContent("2 accessible repositories synchronized");
    await waitFor(() => expect(props.loadRepositories).toHaveBeenCalledTimes(2));
  });

  it("appends and deduplicates cursor pages", async () => {
    const loadRepositories = vi.fn()
      .mockResolvedValueOnce({ ...repositories, items: [repositories.items[0]], pageInfo: { nextCursor: "cursor-2", hasNextPage: true } })
      .mockResolvedValueOnce({ ...repositories, items: repositories.items, pageInfo: { nextCursor: null, hasNextPage: false } });
    renderPanel({ loadRepositories });
    await screen.findByRole("link", { name: "trace-fixture-org/trace" });
    await userEvent.click(screen.getByRole("button", { name: "Load more repositories" }));
    expect(loadRepositories).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-2" }));
    expect(await screen.findByRole("link", { name: "archive-fixture-org/legacy-api" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "trace-fixture-org/trace" })).toHaveLength(1);
  });
});
