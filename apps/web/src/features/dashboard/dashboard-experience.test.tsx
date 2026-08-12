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
    expect(loadDashboard).toHaveBeenCalledWith({ date: "2026-08-12", timezone: "UTC" });
    await userEvent.selectOptions(screen.getByLabelText("Repository"), "repo_1");
    await waitFor(() => expect(loadDashboard).toHaveBeenLastCalledWith({ date: "2026-08-12", timezone: "UTC", repositoryId: "repo_1" }));
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
    const loadDashboard = vi.fn().mockRejectedValue(new Error("Dashboard is temporarily unavailable."));
    render(<DashboardExperience loadDashboard={loadDashboard} initialDate="2026-08-12" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(loadDashboard).toHaveBeenCalledTimes(2);
  });
});
