import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReportCreateResponse, ReportListResponse } from "@trace/shared";
import { ReportLifecycle } from "./report-lifecycle";

const reports: ReportListResponse = {
  items: [
    { id: "completed", reportDate: "2026-08-12", timezone: "Asia/Karachi", status: "completed", createdAt: "2026-08-13T00:00:00.000Z", completedAt: "2026-08-13T00:01:00.000Z", errorMessage: null, revision: 2, downloadAvailable: true },
    { id: "processing", reportDate: "2026-08-11", timezone: "UTC", status: "processing", createdAt: "2026-08-12T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
    { id: "pending", reportDate: "2026-08-10", timezone: "UTC", status: "pending", createdAt: "2026-08-11T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
    { id: "failed", reportDate: "2026-08-09", timezone: "UTC", status: "failed", createdAt: "2026-08-10T00:00:00.000Z", completedAt: null, errorMessage: "Generation could not be completed.", revision: null, downloadAvailable: false },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
};

function setup(overrides: Partial<React.ComponentProps<typeof ReportLifecycle>> = {}) {
  const loadReports = vi.fn().mockResolvedValue(reports);
  const createReport = vi.fn().mockResolvedValue({ report: reports.items[2] } satisfies ReportCreateResponse);
  render(<ReportLifecycle loadReports={loadReports} createReport={createReport} timezone="UTC" initialDate="2026-08-13" {...overrides} />);
  return { loadReports, createReport };
}

describe("Day 8 report lifecycle", () => {
  it("requests a date-aware report and presents every frozen lifecycle state", async () => {
    const { createReport } = setup();

    expect(await screen.findByRole("heading", { name: "Report history" })).toBeInTheDocument();
    expect(screen.getByText(/PDF downloads remain unavailable until frontend download delivery is implemented\./)).toBeInTheDocument();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    for (const status of ["Processing", "Pending", "Failed"]) expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getByText("Generation could not be completed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open report for August 12, 2026" })).toHaveAttribute("href", "/reports/completed");
    expect(screen.getByRole("button", { name: "Download report for August 12, 2026 — download delivery is not available yet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download report for August 11, 2026 — download delivery is not available yet" })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Report date"));
    await userEvent.type(screen.getByLabelText("Report date"), "2026-08-13");
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));

    await waitFor(() => expect(createReport).toHaveBeenCalledWith({ reportDate: "2026-08-13", timezone: "UTC" }, expect.any(AbortSignal)));
    expect(screen.getByRole("status")).toHaveTextContent("Report requested for August 13, 2026");
  });

  it("encodes opaque report IDs in detail links", async () => {
    setup({
      loadReports: vi.fn().mockResolvedValue({
        items: [{ ...reports.items[0], id: "report/with reserved?characters" }],
        pageInfo: { nextCursor: null, hasNextPage: false },
      }),
    });

    expect(await screen.findByRole("link", { name: "Open report for August 12, 2026" })).toHaveAttribute(
      "href",
      "/reports/report%2Fwith%20reserved%3Fcharacters",
    );
  });

  it("prevents an empty date before submission", async () => {
    const { createReport } = setup();
    await screen.findByRole("heading", { name: "Report history" });
    await userEvent.clear(screen.getByLabelText("Report date"));
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a report date");
    expect(createReport).not.toHaveBeenCalled();
  });

  it("explains duplicate reports without exposing raw errors", async () => {
    const createReport = vi.fn().mockRejectedValue({ code: "REPORT_ALREADY_EXISTS", message: "postgres secret" });
    setup({ createReport });
    await screen.findByRole("heading", { name: "Report history" });
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A report already exists for this date");
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  });

  it.each([
    ["REPORT_GENERATION_UNAVAILABLE", "Report generation is temporarily unavailable"],
    ["UNAUTHENTICATED", "Your session has expired"],
  ])("maps %s to safe actionable copy", async (code, expected) => {
    setup({ createReport: vi.fn().mockRejectedValue({ code, message: "unsafe internal queue detail" }) });
    await screen.findByRole("heading", { name: "Report history" });
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("alert")).not.toHaveTextContent("internal");
  });

  it("shows zero-report guidance", async () => {
    setup({ loadReports: vi.fn().mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }) });
    expect(await screen.findByRole("heading", { name: "No reports yet" })).toBeInTheDocument();
    expect(screen.getByText(/request your first development activity report/i)).toBeInTheDocument();
  });

  it("retries report history after a safe load failure", async () => {
    const loadReports = vi.fn().mockRejectedValueOnce(new Error("database secret")).mockResolvedValueOnce(reports);
    setup({ loadReports });
    expect(await screen.findByRole("alert")).toHaveTextContent("Trace could not load report history");
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
    await userEvent.click(screen.getByRole("button", { name: "Retry report history" }));
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(loadReports).toHaveBeenCalledTimes(2);
  });
});
