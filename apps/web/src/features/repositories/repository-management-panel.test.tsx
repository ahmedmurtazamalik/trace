import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryListResponse } from "@trace/shared";
import { RepositoryManagementPanel } from "./repository-management-panel";

const repositories: RepositoryListResponse = {
  items: [
    { id: "repo_01", owner: "trace-fixture-org", name: "trace", fullName: "trace-fixture-org/trace", private: true, defaultBranch: "main", url: "https://github.com/trace-fixture-org/trace", accessible: true, trackingEnabled: false, lastActivityAt: "2026-08-12T09:30:00.000Z", contributorCount: 3 },
    { id: "repo_02", owner: "archive-fixture-org", name: "legacy-api", fullName: "archive-fixture-org/legacy-api", private: false, defaultBranch: "trunk", url: null, accessible: false, trackingEnabled: true, lastActivityAt: null, contributorCount: 0 },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof RepositoryManagementPanel>> = {}) {
  const loadRepositories = vi.fn().mockImplementation(async (query: { search?: string }) => ({
    ...repositories,
    items: query.search ? repositories.items.filter((item) => item.fullName.includes(query.search!)) : repositories.items,
  }));
  const props = {
    initialSearch: "",
    csrfToken: "csrf-live",
    loadRepositories,
    updateTracking: vi.fn().mockImplementation(async (repositoryId: string, trackingEnabled: boolean) => ({ repositoryId, trackingEnabled })),
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
    const updateTracking = vi.fn().mockRejectedValue(new Error("Tracking is temporarily unavailable."));
    renderPanel({ updateTracking });
    const button = await screen.findByRole("button", { name: "Track trace-fixture-org/trace" });
    await userEvent.click(button);
    expect(updateTracking).toHaveBeenCalledWith("repo_01", true, "csrf-live");
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("button", { name: "Track trace-fixture-org/trace" })).toBeEnabled();
  });

  it("synchronizes with CSRF and reloads the authoritative list", async () => {
    const props = renderPanel();
    await screen.findByRole("link", { name: "trace-fixture-org/trace" });
    await userEvent.click(screen.getByRole("button", { name: "Synchronize GitHub" }));
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
