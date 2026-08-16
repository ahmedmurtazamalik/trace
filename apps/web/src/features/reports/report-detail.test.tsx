import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("surfaces transient refresh failure and keeps polling until completion", async () => {
    vi.useFakeTimers();
    const loadReport = vi.fn()
      .mockResolvedValueOnce(processing)
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(completed);
    render(<ReportDetailView reportId="report-processing" loadReport={loadReport} pollIntervalMs={100} />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Building your report")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole("alert")).toHaveTextContent("Trace could not refresh this report. It will retry automatically.");
    expect(screen.getByRole("button", { name: "Retry now" })).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("renders resolved contributor names without exposing database identifiers", async () => {
    const named = {
      ...completed,
      report: {
        ...completed.report,
        content: {
          executiveSummary: "Development activity was summarized.",
          repositories: [{ repositoryId: "repo-1", summary: "Repository summary", contributors: [{ contributorId: "cms-internal-id", summary: "Contributor summary", accomplishments: ["Shipped UI"] }] }],
        },
      },
    };
    const resolveContributorLabels = vi.fn().mockResolvedValue({ "cms-internal-id": "Ali Majid (@alimajidneo)" });
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(named)} saveRevision={vi.fn()} resolveContributorLabels={resolveContributorLabels} />);
    expect(await screen.findByRole("heading", { name: "Ali Majid (@alimajidneo)" })).toBeInTheDocument();
    expect(screen.queryByText(/cms-internal-id/)).not.toBeInTheDocument();
  });

  it("regenerates from the current revision and resumes processing", async () => {
    const regenerating: ReportDetailResponse = { report: { ...completed.report, status: "processing", completedAt: null, downloadAvailable: false, artifacts: [] } };
    const regenerateReport = vi.fn().mockResolvedValue(regenerating);
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(completed)} saveRevision={vi.fn()} regenerateReport={regenerateReport} />);

    fireEvent.click(await screen.findByRole("button", { name: "Regenerate report" }));
    await waitFor(() => expect(regenerateReport).toHaveBeenCalledWith("report-completed", { expectedRevision: 1 }, expect.any(AbortSignal)));
    expect(screen.getByText("Building your report")).toBeInTheDocument();
  });

  it("clears a stale regeneration conflict when refresh recovery starts", async () => {
    const refreshed: ReportDetailResponse = { report: { ...completed.report, revision: 2 } };
    const loadReport = vi.fn().mockResolvedValueOnce(completed).mockResolvedValueOnce(refreshed);
    const regenerateReport = vi.fn().mockRejectedValue({ code: "REPORT_REVISION_CONFLICT" });
    render(<ReportDetailView reportId="report-completed" loadReport={loadReport} regenerateReport={regenerateReport} />);

    fireEvent.click(await screen.findByRole("button", { name: "Regenerate report" }));
    const refresh = await screen.findByRole("button", { name: "Refresh report" });
    expect(screen.getByRole("alert")).toHaveTextContent("A newer revision exists");
    fireEvent.click(refresh);

    await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/A newer revision exists/)).not.toBeInTheDocument();
  });

  it("adopts a saved processing revision, resumes polling, and regenerates from the new revision", async () => {
    vi.useFakeTimers();
    const completedRevision2: ReportDetailResponse = { report: {
      ...completed.report,
      revision: 2,
      revisionSource: "manual",
      content: { ...completed.report.content!, executiveSummary: "Saved revision two." },
      artifacts: [{ ...completed.report.artifacts[0], id: "pdf-2", revision: 2 }],
    } };
    const savedProcessing: ReportDetailResponse = { report: { ...completedRevision2.report, status: "processing", completedAt: null, downloadAvailable: false, artifacts: [] } };
    const loadReport = vi.fn().mockResolvedValueOnce(completed).mockResolvedValue(completedRevision2);
    const saveRevision = vi.fn().mockResolvedValue(savedProcessing);
    const regenerateReport = vi.fn().mockResolvedValue({ report: { ...completedRevision2.report, status: "processing", completedAt: null, downloadAvailable: false, artifacts: [] } });
    render(<ReportDetailView reportId="report-completed" loadReport={loadReport} saveRevision={saveRevision} regenerateReport={regenerateReport} pollIntervalMs={100} />);

    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Saved revision two." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Building your report")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText("Revision 2 · Manually edited")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate report" }));
    await act(async () => { await Promise.resolve(); });
    expect(regenerateReport).toHaveBeenCalledWith("report-completed", { expectedRevision: 2 }, expect.any(AbortSignal));
  });

  it("does not regenerate while narrative edits are unsaved", async () => {
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(completed)} saveRevision={vi.fn()} regenerateReport={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Executive summary"), { target: { value: "Unsaved narrative" } });
    expect(screen.getByRole("button", { name: "Regenerate report" })).toBeDisabled();
    expect(screen.getByText("Save or cancel your narrative changes before regenerating.")).toBeInTheDocument();
  });

  it("allows regeneration from a failed report that still has a current revision", async () => {
    const failedWithRevision: ReportDetailResponse = { report: { ...completed.report, status: "failed", artifacts: [], downloadAvailable: false, errorMessage: "Generation failed safely." } };
    const regenerateReport = vi.fn().mockResolvedValue({ report: { ...failedWithRevision.report, status: "processing", errorMessage: null } });
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(failedWithRevision)} regenerateReport={regenerateReport} pollIntervalMs={10000} />);

    const action = await screen.findByRole("button", { name: "Regenerate report" });
    expect(action).toBeEnabled();
    fireEvent.click(action);
    await waitFor(() => expect(regenerateReport).toHaveBeenCalledWith("report-completed", { expectedRevision: 1 }, expect.any(AbortSignal)));
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("downloads the current PDF through the verified adapter and shows safe artifact metadata", async () => {
    const downloadArtifact = vi.fn().mockResolvedValue({ blob: new Blob(["pdf"], { type: "application/pdf" }), fileName: "trace-report.pdf" });
    const deliverDownload = vi.fn();
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(completed)} saveRevision={vi.fn()} downloadArtifact={downloadArtifact} deliverDownload={deliverDownload} />);

    expect(await screen.findByText("trace-report.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF · Revision 1 · 1000 B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(downloadArtifact).toHaveBeenCalledWith("report-completed", completed.report.artifacts[0], expect.any(AbortSignal)));
    expect(deliverDownload).toHaveBeenCalledWith(expect.objectContaining({ fileName: "trace-report.pdf" }));
  });

  it("shows and downloads only artifacts for the current revision", async () => {
    const currentArtifact = { ...completed.report.artifacts[0], id: "pdf-current", revision: 2 };
    const reportWithStaleArtifact: ReportDetailResponse = {
      report: { ...completed.report, revision: 2, artifacts: [
        currentArtifact,
        { ...completed.report.artifacts[0], id: "pdf-stale", fileName: "stale-report.pdf" },
      ] },
    };
    const downloadArtifact = vi.fn().mockResolvedValue({ blob: new Blob(["pdf"], { type: "application/pdf" }), fileName: "trace-report.pdf" });
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(reportWithStaleArtifact)} downloadArtifact={downloadArtifact} deliverDownload={vi.fn()} />);

    expect(await screen.findByText("trace-report.pdf")).toBeInTheDocument();
    expect(screen.queryByText("stale-report.pdf")).not.toBeInTheDocument();
  });

  it("keeps artifact metadata visible when a download has expired", async () => {
    const downloadArtifact = vi.fn().mockRejectedValue({ code: "REPORT_ARTIFACT_NOT_FOUND" });
    render(<ReportDetailView reportId="report-completed" loadReport={vi.fn().mockResolvedValue(completed)} downloadArtifact={downloadArtifact} deliverDownload={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable or expired");
    expect(screen.getByText("trace-report.pdf")).toBeInTheDocument();
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
