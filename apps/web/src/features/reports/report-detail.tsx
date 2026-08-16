"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@trace/ui";
import type { ReportArtifact, ReportDetail, ReportDetailResponse, ReportRegenerationRequest, ReportRegenerationResponse } from "@trace/shared";

import { ReportEditor, type SaveReportRevision } from "./report-editor";

export type LoadReport = (reportId: string, signal?: AbortSignal) => Promise<ReportDetailResponse>;
export type RegenerateReport = (reportId: string, request: ReportRegenerationRequest, signal?: AbortSignal) => Promise<ReportRegenerationResponse>;
export interface DownloadedArtifact { blob: Blob; fileName: string }
export type DownloadArtifact = (reportId: string, artifact: ReportArtifact, signal?: AbortSignal) => Promise<DownloadedArtifact>;
export type DeliverDownload = (artifact: DownloadedArtifact) => void;
export type ResolveContributorLabels = (report: ReportDetail, signal?: AbortSignal) => Promise<Record<string, string>>;
const labels = { pending: "Pending", processing: "Processing", completed: "Completed", failed: "Failed" } as const;

export function deliverBrowserDownload(artifact: DownloadedArtifact) {
  const url = URL.createObjectURL(artifact.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props { reportId: string; loadReport: LoadReport; saveRevision?: SaveReportRevision; regenerateReport?: RegenerateReport; downloadArtifact?: DownloadArtifact; deliverDownload?: DeliverDownload; resolveContributorLabels?: ResolveContributorLabels; pollIntervalMs?: number }

export function ReportDetailView({ reportId, loadReport, saveRevision, regenerateReport, downloadArtifact, deliverDownload = deliverBrowserDownload, resolveContributorLabels, pollIntervalMs = 5000 }: Props) {
  const [report, setReport] = useState<ReportDetail>();
  const [contributorLabels, setContributorLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editorDirty, setEditorDirty] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const pollingGeneration = useRef(0);
  const controller = useRef<AbortController>();
  const downloadController = useRef<AbortController>();
  const timer = useRef<number>();
  const hasLoadedReport = useRef(false);

  const cancelPolling = useCallback(() => {
    pollingGeneration.current += 1;
    controller.current?.abort();
    controller.current = undefined;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const startPolling = useCallback(() => {
    cancelPolling();
    const generation = pollingGeneration.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setError(undefined);
    setActionError(undefined);

    const poll = async () => {
      setError(undefined);
      try {
        const response = await loadReport(reportId, nextController.signal);
        if (pollingGeneration.current !== generation || nextController.signal.aborted) return;
        hasLoadedReport.current = true;
        setReport(response.report);
        setLoading(false);
        if (response.report.status === "pending" || response.report.status === "processing") {
          timer.current = window.setTimeout(() => void poll(), pollIntervalMs);
        }
      } catch (cause) {
        if (pollingGeneration.current !== generation || nextController.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(hasLoadedReport.current ? "Trace could not refresh this report. It will retry automatically." : "Trace could not load this report. Try again.");
        setLoading(false);
        timer.current = window.setTimeout(() => void poll(), pollIntervalMs);
      }
    };
    void poll();
  }, [cancelPolling, loadReport, pollIntervalMs, reportId]);

  useEffect(() => {
    setReport(undefined);
    hasLoadedReport.current = false;
    setContributorLabels({});
    setLoading(true);
    setEditorDirty(false);
    setRegenerating(false);
    setDownloadingId(undefined);
    setActionError(undefined);
    downloadController.current?.abort();
    downloadController.current = undefined;
    startPolling();
    return () => {
      cancelPolling();
      downloadController.current?.abort();
      downloadController.current = undefined;
    };
  }, [cancelPolling, reportId, startPolling]);

  useEffect(() => {
    if (!report?.content || !resolveContributorLabels) return;
    const labelController = new AbortController();
    setContributorLabels({});
    void resolveContributorLabels(report, labelController.signal)
      .then((resolved) => { if (!labelController.signal.aborted) setContributorLabels(resolved); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setContributorLabels({}); });
    return () => labelController.abort();
  }, [report, resolveContributorLabels]);

  const acceptSavedRevision = useCallback((savedReport: ReportDetail) => {
    cancelPolling();
    hasLoadedReport.current = true;
    setReport(savedReport);
    setLoading(false);
    setActionError(undefined);
    if (savedReport.status === "pending" || savedReport.status === "processing") {
      timer.current = window.setTimeout(startPolling, pollIntervalMs);
    }
  }, [cancelPolling, pollIntervalMs, startPolling]);

  async function regenerate() {
    if (!regenerateReport || !report?.revision || !["completed", "failed"].includes(report.status) || editorDirty || regenerating) return;
    cancelPolling();
    const generation = pollingGeneration.current;
    const actionController = new AbortController();
    controller.current = actionController;
    setRegenerating(true);
    setActionError(undefined);
    try {
      const response = await regenerateReport(reportId, { expectedRevision: report.revision }, actionController.signal);
      if (actionController.signal.aborted || pollingGeneration.current !== generation) return;
      setReport(response.report);
      if (response.report.status === "pending" || response.report.status === "processing") {
        timer.current = window.setTimeout(startPolling, pollIntervalMs);
      }
    } catch (cause) {
      if (actionController.signal.aborted || pollingGeneration.current !== generation) return;
      const code = typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
      setActionError(code === "REPORT_REVISION_CONFLICT" ? "A newer revision exists. Reload the latest report before regenerating." : code === "RATE_LIMITED" ? "Too many regeneration requests. Wait before trying again; your current revision is unchanged." : code === "CSRF_INVALID" ? "Your security session expired. Refresh the page before regenerating." : code === "UNAUTHENTICATED" ? "Your session expired. Sign in again before regenerating." : code === "REPORT_NOT_EDITABLE" ? "This report can no longer be regenerated in its current state." : code === "REPORT_GENERATION_UNAVAILABLE" ? "Report regeneration is temporarily unavailable. Try again later." : code === "REPORT_NOT_FOUND" ? "This report is no longer available." : "Trace could not regenerate this report. Your current revision is unchanged.");
    } finally {
      if (!actionController.signal.aborted && pollingGeneration.current === generation) setRegenerating(false);
    }
  }

  async function download(artifact: ReportArtifact) {
    if (!downloadArtifact || downloadingId) return;
    downloadController.current?.abort();
    const actionController = new AbortController();
    downloadController.current = actionController;
    setDownloadingId(artifact.id);
    setActionError(undefined);
    try {
      const downloaded = await downloadArtifact(reportId, artifact, actionController.signal);
      if (actionController.signal.aborted || downloadController.current !== actionController) return;
      deliverDownload(downloaded);
    } catch (cause) {
      if (actionController.signal.aborted || downloadController.current !== actionController) return;
      const code = typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
      setActionError(code === "REPORT_ARTIFACT_NOT_FOUND" ? "This report file is unavailable or expired. Refresh the report and try again." : code === "UNAUTHENTICATED" ? "Your session expired. Sign in again before downloading." : code === "INVALID_RESPONSE" ? "Trace rejected an invalid or corrupted report file. Refresh and try again." : code === "REPORT_NOT_FOUND" ? "This report is no longer available." : "Trace could not download this report file. Try again.");
    } finally {
      if (downloadController.current === actionController) {
        downloadController.current = undefined;
        setDownloadingId(undefined);
      }
    }
  }

  if (loading && report === undefined) return <Card className="report-state-card" role="status">Loading report…</Card>;
  if (error && report === undefined) return <Card className="report-state-card report-state-error" role="alert"><p>{error}</p><Button className="trace-button-secondary" onClick={startPolling}>Retry</Button></Card>;
  if (report === undefined) return null;
  const currentArtifacts = report.revision === null ? [] : report.artifacts.filter((artifact) => artifact.revision === report.revision);
  const currentPdf = currentArtifacts.find((artifact) => artifact.kind === "pdf");
  return <div className="report-detail-stack">
    <Card className="report-detail-hero">
      <div><span className={`report-status report-status-${report.status}`}>{labels[report.status]}</span><h2>Development activity report</h2><p>{new Date(`${report.reportDate}T12:00:00.000Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })} · {report.timezone}</p></div>
      <div className="report-detail-actions">
        {regenerateReport && report.revision ? <Button className="trace-button-secondary" disabled={!["completed", "failed"].includes(report.status) || editorDirty || regenerating} onClick={() => void regenerate()}>{regenerating ? "Regenerating…" : "Regenerate report"}</Button> : null}
        {currentPdf && downloadArtifact ? <Button disabled={downloadingId !== undefined} onClick={() => void download(currentPdf)}>{downloadingId === currentPdf.id ? "Downloading…" : "Download PDF"}</Button> : <Button disabled aria-label="Download PDF — download delivery is not available yet" title="PDF download delivery is not available yet.">Download PDF</Button>}
      </div>
    </Card>
    {editorDirty && regenerateReport ? <p className="report-action-hint">Save or cancel your narrative changes before regenerating.</p> : null}
    {actionError ? <div className="report-notice-error" role="alert"><span>{actionError}</span>{actionError.startsWith("A newer revision") || actionError.includes("Refresh") ? <Button className="trace-button-secondary" onClick={startPolling}>Refresh report</Button> : null}</div> : null}
    {error ? <div className="report-notice-error" role="alert"><span>{error}</span><Button className="trace-button-secondary" onClick={startPolling}>Retry now</Button></div> : null}
    {report.status === "pending" || report.status === "processing" ? <Card className="report-progress-card" role="status"><strong>{report.status === "pending" ? "Waiting to begin" : "Building your report"}</strong><span>This page refreshes automatically while generation is active.</span></Card> : null}
    {report.status === "failed" && <Card className="report-state-card report-state-error" role="alert"><h3>Report generation failed</h3><p>{report.errorMessage}</p></Card>}
    <section className="report-facts" aria-label="Deterministic report facts">
      {[["Repositories", report.facts.repositoryCount], ["Contributors", report.facts.contributorCount], ["Commits", report.facts.commitCount], ["Files changed", report.facts.filesChanged], ["Additions", report.facts.additions], ["Deletions", report.facts.deletions]].map(([label, value]) => <Card key={label}><span>{label}</span><strong>{value}</strong>{label === "Commits" && <small>{value} {value === 1 ? "commit" : "commits"}</small>}</Card>)}
    </section>
    {currentArtifacts.length ? <Card className="report-artifacts" aria-label="Report files">
      <header><div><span>Verified output</span><h3>Report files</h3></div><small>Files are checked against their recorded type, size, and SHA-256 checksum before download.</small></header>
      <ul>{currentArtifacts.map((artifact) => { const kind = artifact.kind === "pdf" ? "PDF" : "TEX"; return <li key={artifact.id}><div><strong>{artifact.fileName}</strong><small>{kind} · Revision {artifact.revision} · {formatBytes(artifact.sizeBytes)}</small></div>{downloadArtifact ? <Button className="trace-button-secondary" disabled={downloadingId !== undefined} onClick={() => void download(artifact)}>{downloadingId === artifact.id ? "Downloading…" : artifact.kind === "pdf" ? `Download ${artifact.fileName}` : `Download source ${artifact.fileName}`}</Button> : null}</li>; })}</ul>
    </Card> : null}
    {report.content && saveRevision ? <ReportEditor report={report} saveRevision={saveRevision} contributorLabels={contributorLabels} onReloadLatest={startPolling} onDirtyChange={setEditorDirty} onSaved={acceptSavedRevision} /> : report.content ? <Card className="report-content-preview"><span>Structured preview</span><h3>Executive summary</h3><p>{report.content.executiveSummary}</p></Card> : null}
  </div>;
}
