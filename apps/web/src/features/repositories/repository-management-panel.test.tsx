import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryListResponse } from "@trace/shared";
import { RepositoryManagementPanel } from "./repository-management-panel";

const repositories: RepositoryListResponse = {
  items: [
    {
      id: "repo_01",
      owner: "trace-fixture-org",
      name: "trace",
      fullName: "trace-fixture-org/trace",
      private: true,
      defaultBranch: "main",
      url: "https://github.com/trace-fixture-org/trace",
      accessible: true,
      trackingEnabled: false,
      lastActivityAt: "2026-08-12T09:30:00.000Z",
      contributorCount: 3,
    },
    {
      id: "repo_02",
      owner: "archive-fixture-org",
      name: "legacy-api",
      fullName: "archive-fixture-org/legacy-api",
      private: false,
      defaultBranch: "trunk",
      url: null,
      accessible: false,
      trackingEnabled: true,
      lastActivityAt: null,
      contributorCount: 0,
    },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof RepositoryManagementPanel>> = {}) {
  const props = {
    initialSearch: "",
    loadRepositories: vi.fn().mockResolvedValue(repositories),
    updateTracking: vi.fn().mockImplementation(async (repositoryId: string, trackingEnabled: boolean) => ({ repositoryId, trackingEnabled })),
    onSearchChange: vi.fn(),
    ...overrides,
  };
  render(<RepositoryManagementPanel {...props} />);
  return props;
}

describe("repository management", () => {
  it("keeps GitHub access separate from Trace tracking and supports nullable URLs", async () => {
    renderPanel();

    expect(await screen.findByRole("heading", { name: "trace-fixture-org/trace" })).toBeInTheDocument();
    expect(screen.getByText("GitHub access active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Track trace-fixture-org/trace" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "archive-fixture-org/legacy-api" })).toBeInTheDocument();
    expect(screen.getByText("Historical access only")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /legacy-api/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" })).toBeDisabled();
  });

  it("filters by a trimmed search term and reports URL query changes", async () => {
    const props = renderPanel();
    const search = await screen.findByRole("searchbox", { name: "Search repositories" });

    await userEvent.type(search, "  legacy  ");
    expect(screen.queryByRole("heading", { name: "trace-fixture-org/trace" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "archive-fixture-org/legacy-api" })).toBeInTheDocument();
    expect(props.onSearchChange).toHaveBeenLastCalledWith("legacy");

    await userEvent.clear(search);
    expect(await screen.findByRole("heading", { name: "trace-fixture-org/trace" })).toBeInTheDocument();
  });

  it("completes tracking explicitly and rolls back safely when the update fails", async () => {
    let rejectUpdate: ((reason?: unknown) => void) | undefined;
    const updateTracking = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectUpdate = reject; }));
    renderPanel({ updateTracking });
    const button = await screen.findByRole("button", { name: "Track trace-fixture-org/trace" });

    void userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    rejectUpdate?.(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not update tracking");
    await waitFor(() => expect(screen.getByRole("button", { name: "Track trace-fixture-org/trace" })).toBeEnabled());
  });
});
