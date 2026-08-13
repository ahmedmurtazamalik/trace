import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DashboardResponse } from "@trace/shared";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";
import { DashboardExperience } from "./dashboard-experience";

function renderDashboard(response: DashboardResponse = dashboardFixtures.ready) {
  const loadDashboard = vi.fn().mockResolvedValue(response);
  const onFiltersChange = vi.fn();
  render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" timezone="UTC" onFiltersChange={onFiltersChange} />);
  return { loadDashboard, onFiltersChange };
}

describe("Day 6 dashboard experience", () => {
  it("renders all seven deterministic metrics and canonical recent activity", async () => {
    renderDashboard();
    const metrics = await screen.findByLabelText("Development activity metrics");
    expect(within(metrics).getAllByRole("article")).toHaveLength(7);
    expect(within(metrics).getByText("2")).toBeInTheDocument();
    expect(within(metrics).getByText("120")).toBeInTheDocument();
    const recent = screen.getByRole("heading", { name: "Recent development activity" }).closest(".dashboard-recent");
    expect(recent).not.toBeNull();
    expect(within(recent as HTMLElement).getByRole("heading", { name: "Add repository synchronization" })).toBeInTheDocument();
    expect(within(recent as HTMLElement).getByText(/Alice Developer/)).toBeInTheDocument();
    expect(within(recent as HTMLElement).getByText(/trace-fixture-org\/trace/)).toBeInTheDocument();
  });

  it("loads through the frozen date, timezone, and repository query", async () => {
    const { loadDashboard, onFiltersChange } = renderDashboard();
    await screen.findByLabelText("Development activity metrics");
    expect(loadDashboard).toHaveBeenCalledWith({ date: "2026-08-12", timezone: "UTC" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await userEvent.selectOptions(screen.getByLabelText("Repository"), "repo_1");
    await waitFor(() => expect(loadDashboard).toHaveBeenLastCalledWith({ date: "2026-08-12", timezone: "UTC", repositoryId: "repo_1" }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ date: "2026-08-12", repositoryId: "repo_1" });
  });

  it("does not submit an empty date outside the frozen query contract", async () => {
    const { loadDashboard, onFiltersChange } = renderDashboard();
    await screen.findByLabelText("Development activity metrics");
    await userEvent.clear(screen.getByLabelText("Date"));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-12");
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it("restores URL-derived filters when parent props change", async () => {
    const loadDashboard = vi.fn().mockResolvedValue(dashboardFixtures.ready);
    const { rerender } = render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" timezone="UTC" />);
    await screen.findByLabelText("Development activity metrics");
    rerender(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-11" initialRepositoryId="repo_1" timezone="UTC" />);
    await waitFor(() => expect(screen.getByLabelText("Date")).toHaveValue("2026-08-11"));
    expect(screen.getByLabelText("Repository")).toHaveValue("repo_1");
    expect(loadDashboard).toHaveBeenLastCalledWith({ date: "2026-08-11", timezone: "UTC", repositoryId: "repo_1" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("ignores stale dashboard responses after filters change", async () => {
    let resolveOld!: (value: DashboardResponse) => void;
    const oldRequest = new Promise<DashboardResponse>((resolve) => { resolveOld = resolve; });
    const replacement = { ...dashboardFixtures.ready, date: "2026-08-10", metrics: { ...dashboardFixtures.ready.metrics, activityCount: 9999 } };
    const loadDashboard = vi.fn().mockResolvedValueOnce(dashboardFixtures.ready).mockReturnValueOnce(oldRequest).mockResolvedValue(replacement);
    const { rerender } = render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" timezone="UTC" />);
    await screen.findByLabelText("Development activity metrics");
    rerender(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-11" timezone="UTC" />);
    rerender(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-10" timezone="UTC" />);
    resolveOld(dashboardFixtures.ready);
    expect(await screen.findByText("9,999")).toBeInTheDocument();
  });

  it("formats zero and large metric values factually", async () => {
    const response = { ...dashboardFixtures.ready, metrics: { ...dashboardFixtures.ready.metrics, activityCount: 0, additions: 1234567 } };
    renderDashboard(response);
    const metrics = await screen.findByLabelText("Development activity metrics");
    expect(within(metrics).getByText("0")).toBeInTheDocument();
    expect(within(metrics).getByText("1,234,567")).toBeInTheDocument();
  });

  it.each([
    ["githubNotConnected", "Connect GitHub", "/github"],
    ["noTrackedRepositories", "Choose repositories", "/repositories"],
    ["noActivity", "Review Activity", "/activity"],
  ] as const)("renders an actionable %s state", async (fixture, action, href) => {
    renderDashboard(dashboardFixtures[fixture]);
    const link = await screen.findByRole("link", { name: action });
    expect(link).toHaveAttribute("href", href);
  });

  it("keeps partial facts visible with a truthful warning", async () => {
    renderDashboard(dashboardFixtures.partial);
    expect(await screen.findByText("Some activity is still being processed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Development activity metrics")).toBeInTheDocument();
  });

  it("offers a retry after a safe load error", async () => {
    const loadDashboard = vi.fn().mockRejectedValue(new Error("database password: super-secret"));
    render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Trace could not load the dashboard. Try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("super-secret");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(loadDashboard).toHaveBeenCalledTimes(2);
  });

  it("offers sign-in when the Dashboard API reports an expired session", async () => {
    const loadDashboard = vi.fn().mockRejectedValue({ code: "UNAUTHENTICATED", status: 401 });
    render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" />);
    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  });

  it("clears old facts and surfaces a safe error when a changed filter fails", async () => {
    const loadDashboard = vi.fn().mockResolvedValueOnce(dashboardFixtures.ready).mockRejectedValue(new Error("internal database detail"));
    const { rerender } = render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" />);
    expect(await screen.findByLabelText("Development activity metrics")).toBeInTheDocument();
    rerender(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-11" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Trace could not load the dashboard. Try again.");
    expect(screen.queryByLabelText("Development activity metrics")).not.toBeInTheDocument();
  });
});
