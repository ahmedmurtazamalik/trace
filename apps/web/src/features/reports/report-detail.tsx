"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@trace/ui";
import type { ReportDetail, ReportDetailResponse } from "@trace/shared";

import { ReportEditor, type SaveReportRevision } from "./report-editor";

export type LoadReport = (reportId: string, signal?: AbortSignal) => Promise<ReportDetailResponse>;
export type ResolveContributorLabels = (report: ReportDetail, signal?: AbortSignal) => Promise<Record<string, string>>;
const labels = { pending: "Pending", processing: "Processing", completed: "Completed", failed: "Failed" } as const;

interface Props { reportId: string; loadReport: LoadReport; saveRevision?: SaveReportRevision; resolveContributorLabels?: ResolveContributorLabels; pollIntervalMs?: number }

export function ReportDetailView({ reportId, loadReport, saveRevision, resolveContributorLabels, pollIntervalMs = 5000 }: Props) {
  const [report, setReport] = useState<ReportDetail>();
  const [contributorLabels, setContributorLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const pollingGeneration = useRef(0);
  const controller = useRef<AbortController>();
  const timer = useRef<number>();

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

    const poll = async () => {
      try {
        const response = await loadReport(reportId, nextController.signal);
        if (pollingGeneration.current !== generation || nextController.signal.aborted) return;
        setReport(response.report);
        setLoading(false);
        if (response.report.status === "pending" || response.report.status === "processing") {
          timer.current = window.setTimeout(() => void poll(), pollIntervalMs);
        }
      } catch (cause) {
        if (pollingGeneration.current !== generation || nextController.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("Trace could not load this report. Try again.");
        setLoading(false);
      }
    };
    void poll();
  }, [cancelPolling, loadReport, pollIntervalMs, reportId]);

  useEffect(() => {
    setReport(undefined);
    setContributorLabels({});
    setLoading(true);
    startPolling();
    return cancelPolling;
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

  if (loading && report === undefined) return <Card className="report-state-card" role="status">Loading report…</Card>;
  if (error && report === undefined) return <Card className="report-state-card report-state-error" role="alert"><p>{error}</p><Button className="trace-button-secondary" onClick={startPolling}>Retry</Button></Card>;
  if (report === undefined) return null;
  return <div className="report-detail-stack">
    <Card className="report-detail-hero">
      <div><span className={`report-status report-status-${report.status}`}>{labels[report.status]}</span><h2>Development activity report</h2><p>{new Date(`${report.reportDate}T12:00:00.000Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })} · {report.timezone}</p></div>
      <Button disabled aria-label="Download PDF — download delivery is not available yet" title="PDF download delivery is not available yet.">Download PDF</Button>
    </Card>
    {report.status === "pending" || report.status === "processing" ? <Card className="report-progress-card" role="status"><strong>{report.status === "pending" ? "Waiting to begin" : "Building your report"}</strong><span>This page refreshes automatically while generation is active.</span></Card> : null}
    {report.status === "failed" && <Card className="report-state-card report-state-error" role="alert"><h3>Report generation failed</h3><p>{report.errorMessage}</p></Card>}
    <section className="report-facts" aria-label="Deterministic report facts">
      {[["Repositories", report.facts.repositoryCount], ["Contributors", report.facts.contributorCount], ["Commits", report.facts.commitCount], ["Files changed", report.facts.filesChanged], ["Additions", report.facts.additions], ["Deletions", report.facts.deletions]].map(([label, value]) => <Card key={label}><span>{label}</span><strong>{value}</strong>{label === "Commits" && <small>{value} {value === 1 ? "commit" : "commits"}</small>}</Card>)}
    </section>
    {report.content && saveRevision ? <ReportEditor report={report} saveRevision={saveRevision} contributorLabels={contributorLabels} onReloadLatest={startPolling} /> : report.content ? <Card className="report-content-preview"><span>Structured preview</span><h3>Executive summary</h3><p>{report.content.executiveSummary}</p></Card> : null}
  </div>;
}
