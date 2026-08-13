import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "@/auth/session-provider";
import { ReportsRoute } from "./reports-route";

const adapters = vi.hoisted(() => ({ listReports: vi.fn(), createReport: vi.fn() }));
vi.mock("@/api/reports", () => adapters);

const session = {
  user: { id: "usr_live", username: "live.user", displayName: "Live User", email: "live@example.test", createdAt: "2026-08-13T00:00:00.000Z" },
  csrfToken: "csrf_live_token",
};
const empty = { items: [], nextCursor: null };
const created = { report: {
  id: "report-live", reportDate: "2026-08-13", timezone: "UTC", status: "pending" as const,
  createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z", completedAt: null,
  facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  errorMessage: null, revision: null, downloadAvailable: false,
} };

describe("production Reports route", () => {
  beforeEach(() => {
    adapters.listReports.mockReset().mockResolvedValue(empty);
    adapters.createReport.mockReset().mockResolvedValue(created);
  });

  it("loads live report history and creates with the in-memory CSRF token", async () => {
    render(<AuthSessionProvider initialSession={session}><ReportsRoute /></AuthSessionProvider>);
    await waitFor(() => expect(adapters.listReports).toHaveBeenCalledWith({ limit: 25 }, expect.any(AbortSignal)));
    const date = screen.getByLabelText("Report date");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-08-13");
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    await waitFor(() => expect(adapters.createReport).toHaveBeenCalledWith(
      { reportDate: "2026-08-13", timezone: expect.any(String) },
      "csrf_live_token",
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText("Report requested for August 13, 2026.")).toBeInTheDocument();
  });
});
