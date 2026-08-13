import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActivityListResponse, ActivitySummary } from "@trace/shared";
import { activityFixturePages } from "@/mocks/fixtures/activity";
import { ActivityExperience } from "./activity-experience";

function renderExperience(overrides: Partial<React.ComponentProps<typeof ActivityExperience>> = {}) {
  const loadActivity = vi.fn().mockResolvedValue(activityFixturePages.first);
  const props = { loadActivity, onFiltersChange: vi.fn(), ...overrides };
  render(<ActivityExperience {...props} />);
  return props;
}

describe("Day 5 activity experience", () => {
  it("renders generic commit and push facts without requiring a Trace account", async () => {
    renderExperience();
    expect(await screen.findByRole("heading", { name: "Refine activity timeline" })).toBeInTheDocument();
    const timeline = screen.getByLabelText("Development activity timeline");
    expect(within(timeline).getByText(/Maya Chen/)).toBeInTheDocument();
    expect(within(timeline).getByText(/8 files/)).toBeInTheDocument();
    expect(within(timeline).getByText(/\+248/)).toBeInTheDocument();
    expect(within(timeline).getByText(/−31/)).toBeInTheDocument();
    expect(within(timeline).getByText("@external-contributor")).toBeInTheDocument();
    expect(within(timeline).getByText("Push")).toBeInTheDocument();
  });

  it("filters through the frozen query contract and reports stable URL state", async () => {
    const props = renderExperience({
      loadRepositories: vi.fn().mockResolvedValue({
        items: [{ id: "live-repo", owner: "live", name: "repository", fullName: "live/repository", private: false, defaultBranch: "main", url: null, accessible: true, trackingEnabled: true, lastActivityAt: null, contributorCount: 0 }],
        pageInfo: { hasNextPage: false, nextCursor: null },
      }),
    });
    await screen.findByRole("heading", { name: "Refine activity timeline" });
    await userEvent.selectOptions(screen.getByLabelText("Repository"), "live-repo");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "github");
    await userEvent.selectOptions(screen.getByLabelText("Activity type"), "push");
    await waitFor(() => expect(props.loadActivity).toHaveBeenLastCalledWith(expect.objectContaining({ repositoryId: "live-repo", source: "github", type: "push", limit: 25, timezone: "UTC" }), expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(props.onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ repositoryId: "live-repo", source: "github", type: "push" }));
    await userEvent.selectOptions(screen.getByLabelText("Source"), "cli");
    expect(screen.getByLabelText("Activity type")).toHaveValue("");
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({ repositoryId: "live-repo", source: "cli" });
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({});
  });

  it("preserves every filter across same-render rapid changes", async () => {
    const onFiltersChange = vi.fn();
    renderExperience({
      onFiltersChange,
      loadRepositories: vi.fn().mockResolvedValue({
        items: [{ id: "rapid-repo", owner: "live", name: "rapid", fullName: "live/rapid", private: false, defaultBranch: "main", url: null, accessible: true, trackingEnabled: true, lastActivityAt: null, contributorCount: 0 }],
        pageInfo: { nextCursor: null, hasNextPage: false },
      }),
    });
    await waitFor(() => expect(screen.getByLabelText("Repository")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "rapid-repo" } });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "github" } });
    fireEvent.change(screen.getByLabelText("Activity type"), { target: { value: "push" } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ repositoryId: "rapid-repo", source: "github", type: "push" });
  });

  it("does not render fixture-only repository or contributor choices", async () => {
    renderExperience({
      loadRepositories: vi.fn().mockResolvedValue({ items: [], pageInfo: { hasNextPage: false, nextCursor: null } }),
    });
    await screen.findByRole("heading", { name: "Refine activity timeline" });
    expect(screen.queryByRole("option", { name: "trace-fixture-org/api" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contributor")).not.toBeInTheDocument();
  });

  it("appends cursor pages without duplicate activities", async () => {
    const loadActivity = vi.fn().mockResolvedValueOnce(activityFixturePages.first).mockResolvedValueOnce(activityFixturePages.second);
    renderExperience({ loadActivity });
    await screen.findByRole("heading", { name: "Refine activity timeline" });
    await userEvent.click(screen.getByRole("button", { name: "Load more activity" }));
    expect(loadActivity).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "activity-page-2" }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await screen.findByRole("heading", { name: "Draft activity filters" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Publish webhook acceptance" })).toHaveLength(1);
  });

  it("does not append an old cursor page after filters change", async () => {
    let resolveSecondPage!: (value: ActivityListResponse) => void;
    const secondPage = new Promise<ActivityListResponse>((resolve) => { resolveSecondPage = resolve; });
    const loadActivity = vi.fn()
      .mockResolvedValueOnce(activityFixturePages.first)
      .mockReturnValueOnce(secondPage)
      .mockResolvedValue(activityFixturePages.first);
    renderExperience({
      loadActivity,
      loadRepositories: vi.fn().mockResolvedValue({
        items: [{ id: "live-repo", owner: "live", name: "repository", fullName: "live/repository", private: false, defaultBranch: "main", url: null, accessible: true, trackingEnabled: true, lastActivityAt: null, contributorCount: 0 }],
        pageInfo: { hasNextPage: false, nextCursor: null },
      }),
    });
    await screen.findByRole("heading", { name: "Refine activity timeline" });
    await userEvent.click(screen.getByRole("button", { name: "Load more activity" }));
    await userEvent.selectOptions(screen.getByLabelText("Repository"), "live-repo");
    resolveSecondPage(activityFixturePages.second);
    await waitFor(() => expect(loadActivity).toHaveBeenLastCalledWith(expect.objectContaining({ repositoryId: "live-repo" }), expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(screen.queryByRole("heading", { name: "Draft activity filters" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more activity" })).toBeEnabled();
  });

  it("restores filters when URL-derived props change", async () => {
    const loadActivity = vi.fn().mockResolvedValue(activityFixturePages.first);
    const { rerender } = render(<ActivityExperience loadActivity={loadActivity} initialFilters={{ source: "github", type: "push" }} />);
    expect(await screen.findByLabelText("Activity type")).toHaveValue("push");
    rerender(<ActivityExperience loadActivity={loadActivity} initialFilters={{ source: "cli", type: "local_commit" }} />);
    await waitFor(() => expect(screen.getByLabelText("Source")).toHaveValue("cli"));
    expect(screen.getByLabelText("Activity type")).toHaveValue("local_commit");
    expect(loadActivity).toHaveBeenLastCalledWith(expect.objectContaining({ source: "cli", type: "local_commit" }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("groups timeline events by day with semantic list hierarchy", async () => {
    renderExperience({ loadActivity: vi.fn().mockResolvedValue({ items: activityFixturePages.first.items.concat(activityFixturePages.second.items[1]), pageInfo: { nextCursor: null, hasNextPage: false } }) });
    const timeline = await screen.findByRole("region", { name: "Development activity timeline" });
    expect(within(timeline).getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(within(timeline).getAllByRole("list")).toHaveLength(2);
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(3);
  });

  it("groups timeline events by their selected timezone day", async () => {
    const first = { ...activityFixturePages.first.items[0], id: "late", occurredAt: "2026-08-12T23:30:00.000Z" };
    const second = { ...activityFixturePages.first.items[1], id: "early", occurredAt: "2026-08-13T00:30:00.000Z" };
    renderExperience({ timezone: "America/Los_Angeles", loadActivity: vi.fn().mockResolvedValue({ items: [first, second], pageInfo: { nextCursor: null, hasNextPage: false } }) });
    const timeline = await screen.findByRole("region", { name: "Development activity timeline" });
    expect(within(timeline).getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(within(timeline).getByRole("heading", { level: 2 })).toHaveTextContent("August 12, 2026");
  });

  it("shows actionable empty and forbidden states", async () => {
    const empty: ActivityListResponse = { items: [], pageInfo: { nextCursor: null, hasNextPage: false } };
    const { rerender } = render(<ActivityExperience loadActivity={vi.fn().mockResolvedValue(empty)} />);
    expect(await screen.findByRole("heading", { name: "No development activity yet" })).toBeInTheDocument();
    rerender(<ActivityExperience loadActivity={vi.fn().mockRejectedValue(new Error("database password: super-secret"))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Trace could not load activity");
    expect(screen.getByRole("alert")).not.toHaveTextContent("super-secret");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("offers sign-in when the Activity API reports an expired session", async () => {
    renderExperience({ loadActivity: vi.fn().mockRejectedValue({ code: "UNAUTHENTICATED", status: 401 }) });
    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  });

  it("uses a safe fallback for future activity values", async () => {
    const future = { ...activityFixturePages.first.items[0], id: "future", type: "future_event" } as unknown as ActivitySummary;
    renderExperience({ loadActivity: vi.fn().mockResolvedValue({ items: [future], pageInfo: { nextCursor: null, hasNextPage: false } }) });
    expect(await screen.findByText("Activity")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refine activity timeline" })).toBeInTheDocument();
  });
});
