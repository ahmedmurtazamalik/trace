import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportDetailResponse } from "@trace/shared";
import { ReportDetailView } from "./report-detail";

const processing: ReportDetailResponse = { report: {
  id: "report-processing", reportDate: "2026-08-13", timezone: "UTC", status: "processing",
  createdAt: "2026-08-13T08:00:00.000Z", completedAt: null, errorMessage: null, revision: null,
  downloadAvailable: false, revisionSource: null, content: null,
  facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 5, additions: 40, deletions: 8 }, artifacts: [],
} };
const completed: ReportDetailResponse = { report: {
  ...processing.report, status: "completed", completedAt: "2026-08-13T08:02:00.000Z", revision: 1,
  downloadAvailable: true, revisionSource: "ai",
  content: { executiveSummary: "Development activity was summarized.", repositories: [] },
  artifacts: [{ id: "pdf-1", revision: 1, kind: "pdf", fileName: "trace-report.pdf", contentType: "application/pdf", sizeBytes: 1000, checksum: "a".repeat(64) }],
} };

afterEach(() => vi.useRealTimers());

describe("Day 8 report detail", () => {
  it("polls processing reports and stops after completion", async () => {
    vi.useFakeTimers();
    const loadReport = vi.fn().mockResolvedValueOnce(processing).mockResolvedValueOnce(processing).mockResolvedValueOnce(completed);
    render(<ReportDetailView reportId="report-processing" loadReport={loadReport} pollIntervalMs={1000} />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF — download delivery is not available yet" })).toBeDisabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF — download delivery is not available yet" })).toBeDisabled();
    expect(screen.getByText("2 commits")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(loadReport).toHaveBeenCalledTimes(3);
  });

  it("aborts and ignores an older report response after the route id changes", async () => {
    let resolveOld!: (value: ReportDetailResponse) => void;
    let oldSignal: AbortSignal | undefined;
    const oldRequest = new Promise<ReportDetailResponse>((resolve) => { resolveOld = resolve; });
    const newer = { ...completed, report: { ...completed.report, id: "report-new", reportDate: "2026-08-14" } };
    const loadReport = vi.fn((id: string, signal?: AbortSignal) => {
      if (id === "report-old") { oldSignal = signal; return oldRequest; }
      return Promise.resolve(newer);
    });
    const view = render(<ReportDetailView reportId="report-old" loadReport={loadReport} />);
    view.rerender(<ReportDetailView reportId="report-new" loadReport={loadReport} />);
    expect(await screen.findByText(/August 14, 2026/)).toBeInTheDocument();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { resolveOld(completed); await Promise.resolve(); });
    expect(screen.getByText(/August 14, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/August 13, 2026/)).not.toBeInTheDocument();
  });

  it("offers a safe retry without exposing raw failures and resumes polling", async () => {
    vi.useFakeTimers();
    const loadReport = vi.fn()
      .mockRejectedValueOnce(new Error("database password secret"))
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(completed);
    render(<ReportDetailView reportId="report-processing" loadReport={loadReport} pollIntervalMs={1000} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("Trace could not load this report");
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(loadReport).toHaveBeenCalledTimes(3);
  });
});
