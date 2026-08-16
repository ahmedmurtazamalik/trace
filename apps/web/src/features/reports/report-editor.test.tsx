import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReportDetail, ReportRevisionUpdateRequest, ReportRevisionUpdateResponse } from "@trace/shared";
import { ReportEditor, type SaveReportRevision } from "./report-editor";

const report: ReportDetail = {
  id: "report-completed", reportDate: "2026-08-12", timezone: "UTC", status: "completed",
  createdAt: "2026-08-13T00:00:00.000Z", completedAt: "2026-08-13T00:02:00.000Z", errorMessage: null,
  revision: 1, revisionSource: "ai", downloadAvailable: true,
  facts: { repositoryCount: 1, contributorCount: 1, commitCount: 8, filesChanged: 21, additions: 342, deletions: 71 },
  content: {
    executiveSummary: "Initial executive summary.",
    repositories: [{
      repositoryId: "repo_1", summary: "Initial repository summary.",
      contributors: [{ contributorId: "contributor_1", summary: "Initial contributor summary.", accomplishments: ["Shipped report lifecycle."] }],
    }],
  },
  artifacts: [{ id: "pdf-1", revision: 1, kind: "pdf", fileName: "trace-report.pdf", contentType: "application/pdf", sizeBytes: 1000, checksum: "a".repeat(64) }],
};

function savedResponse(request: ReportRevisionUpdateRequest): ReportRevisionUpdateResponse {
  return { report: {
    ...report, revision: 2, revisionSource: "manual",
    content: { ...report.content!, executiveSummary: request.prosePatch.executiveSummary ?? report.content!.executiveSummary },
    artifacts: [{ ...report.artifacts[0]!, id: "pdf-2", revision: 2 }],
  } };
}

describe("Day 9 structured report editor", () => {
  it("edits only structured prose, exposes dirty state, cancels, and saves with optimistic revision protection", async () => {
    const save: SaveReportRevision = vi.fn(async (_id, request) => savedResponse(request));
    render(<ReportEditor report={report} saveRevision={save} />);

    expect(screen.getByText("Revision 1 · AI generated")).toBeInTheDocument();
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Initial executive summary.");
    expect(screen.getByLabelText("Repository repo_1 summary")).toHaveValue("Initial repository summary.");
    expect(screen.getByLabelText("Contributor name unavailable summary")).toHaveValue("Initial contributor summary.");
    expect(screen.getByLabelText("Contributor name unavailable accomplishments")).toHaveValue("Shipped report lifecycle.");
    expect(screen.queryByText(/contributor_1/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/commits/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Updated summary with <special> & characters." } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Initial executive summary.");

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Updated summary with <special> & characters." } });
    fireEvent.change(screen.getByLabelText("Repository repo_1 summary"), { target: { value: "Updated repository summary." } });
    fireEvent.change(screen.getByLabelText("Contributor name unavailable summary"), { target: { value: "Updated contributor summary." } });
    fireEvent.change(screen.getByLabelText("Contributor name unavailable accomplishments"), { target: { value: "First accomplishment.\nSecond <safe> accomplishment." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("report-completed", {
      expectedRevision: 1,
      prosePatch: {
        executiveSummary: "Updated summary with <special> & characters.",
        repositories: [{
          repositoryId: "repo_1",
          summary: "Updated repository summary.",
          contributors: [{
            contributorId: "contributor_1",
            summary: "Updated contributor summary.",
            accomplishments: ["First accomplishment.", "Second <safe> accomplishment."],
          }],
        }],
      },
    }, expect.any(AbortSignal)));
    expect(await screen.findByText("Revision 2 · Manually edited")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Revision 2 saved");
  });

  it("validates bounded prose and safely handles a revision conflict with reload guidance", async () => {
    const save = vi.fn().mockRejectedValue({ code: "REPORT_REVISION_CONFLICT" });
    render(<ReportEditor report={report} saveRevision={save} />);

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Executive summary is required");
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "A valid update." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A newer revision exists");
    expect(screen.getByRole("button", { name: "Reload latest revision" })).toBeInTheDocument();
  });

  it("preserves the draft and tells users to wait when revision saving is rate limited", async () => {
    const save = vi.fn().mockRejectedValue({ code: "RATE_LIMITED" });
    render(<ReportEditor report={report} saveRevision={save} />);
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Retained rate-limited draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait before trying again");
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Retained rate-limited draft.");
  });

  it("rebases a retained conflict draft onto the latest revision before retrying", async () => {
    const save = vi.fn().mockRejectedValueOnce({ code: "REPORT_REVISION_CONFLICT" }).mockImplementation(async (_id, request) => savedResponse(request));
    const reload = vi.fn();
    const view = render(<ReportEditor report={report} saveRevision={save} onReloadLatest={reload} />);

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "My retained draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A newer revision exists");
    fireEvent.click(screen.getByRole("button", { name: "Reload latest revision" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Executive summary")).toHaveValue("My retained draft.");

    const latest: ReportDetail = { ...report, revision: 2, revisionSource: "manual", content: { ...report.content!, executiveSummary: "Someone else's canonical revision." } };
    view.rerender(<ReportEditor report={latest} saveRevision={save} onReloadLatest={reload} />);
    await waitFor(() => expect(screen.getByText("Revision 2 · Manually edited")).toBeInTheDocument());
    expect(screen.getByLabelText("Executive summary")).toHaveValue("My retained draft.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("report-completed", {
      expectedRevision: 2,
      prosePatch: { executiveSummary: "My retained draft." },
    }, expect.any(AbortSignal)));
  });

  it("aborts and ignores an old save when a different report replaces the editor", async () => {
    let resolveOld: ((value: ReportRevisionUpdateResponse) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const save: SaveReportRevision = vi.fn((_reportId, _request, signal) => {
      oldSignal = signal;
      return new Promise<ReportRevisionUpdateResponse>((resolve) => { resolveOld = resolve; });
    });
    const view = render(<ReportEditor report={report} saveRevision={save} />);
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Old report draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(oldSignal).toBeDefined();

    const replacement: ReportDetail = { ...report, id: "report-new", revision: 4, revisionSource: "manual", content: { ...report.content!, executiveSummary: "New report content." } };
    view.rerender(<ReportEditor report={replacement} saveRevision={save} />);
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    expect(screen.getByText("Revision 4 · Manually edited")).toBeInTheDocument();
    expect(screen.getByLabelText("Executive summary")).toHaveValue("New report content.");

    resolveOld?.(savedResponse({ expectedRevision: 1, prosePatch: { executiveSummary: "Late old response." } }));
    await waitFor(() => expect(screen.getByLabelText("Executive summary")).toHaveValue("New report content."));
    expect(screen.queryByText("Revision 2 saved")).not.toBeInTheDocument();
  });

  it("aborts an in-flight save when a newer revision of the same report arrives and keeps the draft", async () => {
    let oldSignal: AbortSignal | undefined;
    const save: SaveReportRevision = vi.fn((_reportId, _request, signal) => {
      oldSignal = signal;
      return new Promise<ReportRevisionUpdateResponse>(() => undefined);
    });
    const view = render(<ReportEditor report={report} saveRevision={save} />);
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Draft during old revision." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    const latest: ReportDetail = { ...report, revision: 2, revisionSource: "manual", content: { ...report.content!, executiveSummary: "Canonical revision 2." } };
    view.rerender(<ReportEditor report={latest} saveRevision={save} />);
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    expect(screen.getByText("Revision 2 · Manually edited")).toBeInTheDocument();
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Draft during old revision.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("keeps edits made after save submission dirty when the canonical response arrives", async () => {
    let resolveSave: ((value: ReportRevisionUpdateResponse) => void) | undefined;
    const save: SaveReportRevision = vi.fn(() => new Promise<ReportRevisionUpdateResponse>((resolve) => { resolveSave = resolve; }));
    render(<ReportEditor report={report} saveRevision={save} />);

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Submitted summary." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Repository repo_1 summary"), { target: { value: "Typed while saving." } });

    resolveSave?.(savedResponse({ expectedRevision: 1, prosePatch: { executiveSummary: "Submitted summary." } }));
    expect(await screen.findByText("Revision 2 · Manually edited")).toBeInTheDocument();
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Submitted summary.");
    expect(screen.getByLabelText("Repository repo_1 summary")).toHaveValue("Typed while saving.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Revision 2 saved. Newer edits remain unsaved.");
  });

  it("explains when the report or revision endpoint is unavailable and retains the draft", async () => {
    const save = vi.fn().mockRejectedValue({ code: "NOT_FOUND" });
    render(<ReportEditor report={report} saveRevision={save} />);
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Keep this draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Revision saving is not available in the current backend");
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Keep this draft.");
  });

  it("retains prose for retry after a save failure and explains an expired session", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce({ code: "UNAUTHENTICATED" }).mockImplementation(async (_id, request) => savedResponse(request));
    render(<ReportEditor report={report} saveRevision={save} />);
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Retry-safe draft." } });

    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your changes remain here so you can retry");
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Retry-safe draft.");

    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session expired");
    expect(screen.getByLabelText("Executive summary")).toHaveValue("Retry-safe draft.");

    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByText("Revision 2 · Manually edited")).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("rejects overlong structured prose before calling the save adapter", () => {
    const save = vi.fn();
    render(<ReportEditor report={report} saveRevision={save} />);
    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "x".repeat(20001) } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(screen.getByRole("alert")).toHaveTextContent("within the allowed length");
    expect(save).not.toHaveBeenCalled();
  });

  it("warns before browser navigation only while prose is dirty", () => {
    render(<ReportEditor report={report} saveRevision={vi.fn()} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText("Executive summary"), { target: { value: "Changed" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
