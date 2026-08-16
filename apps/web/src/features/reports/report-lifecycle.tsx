"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card } from "@trace/ui";
import type { ReportCreateRequest, ReportCreateResponse, ReportListQuery, ReportListResponse, ReportStatus, ReportSummary } from "@trace/shared";

export type LoadReports = (query: ReportListQuery, signal?: AbortSignal) => Promise<ReportListResponse>;
export type CreateReport = (request: ReportCreateRequest, signal?: AbortSignal) => Promise<ReportCreateResponse>;

const statusLabels: Record<ReportStatus, string> = { pending: "Pending", processing: "Processing", completed: "Completed", failed: "Failed" };

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}
function createError(cause: unknown) {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
  if (code === "REPORT_ALREADY_EXISTS") return "A report already exists for this date. Open it from report history.";
  if (code === "RATE_LIMITED") return "Too many report requests. Wait before trying again.";
  if (code === "REPORT_GENERATION_UNAVAILABLE") return "Report generation is temporarily unavailable. Try again later.";
  if (code === "CSRF_INVALID") return "Your security session has expired. Refresh the page and sign in again if needed.";
  if (code === "UNAUTHENTICATED" || code === "UNAUTHORIZED") return "Your session has expired. Please sign in again.";
  return "Trace could not create this report. Try again.";
}

interface Props {
  loadReports: LoadReports;
  createReport: CreateReport;
  timezone: string;
  initialDate: string;
}

export function ReportLifecycle({ loadReports, createReport, timezone, initialDate }: Props) {
  const [date, setDate] = useState(initialDate);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createFailure, setCreateFailure] = useState<string>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(true);
  const historyGeneration = useRef(0);
  const historyController = useRef<AbortController>();
  const createController = useRef<AbortController>();

  const refreshHistory = useCallback(async () => {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    const generation = ++historyGeneration.current;
    setLoading(true); setLoadFailure(undefined);
    try {
      const response = await loadReports({ limit: 25 }, controller.signal);
      if (mounted.current && !controller.signal.aborted && historyGeneration.current === generation) setReports(response.items);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && !(cause instanceof DOMException && cause.name === "AbortError")) setLoadFailure("Trace could not load report history. Try again.");
    } finally {
      if (mounted.current && !controller.signal.aborted && historyGeneration.current === generation) setLoading(false);
    }
  }, [loadReports]);

  useEffect(() => {
    mounted.current = true;
    void refreshHistory();
    return () => { mounted.current = false; historyController.current?.abort(); createController.current?.abort(); };
  }, [refreshHistory]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreateFailure(undefined); setNotice(undefined);
    if (!date) { setCreateFailure("Choose a report date before creating a report."); return; }
    setCreating(true);
    createController.current?.abort();
    const controller = new AbortController();
    createController.current = controller;
    try {
      const response = await createReport({ reportDate: date, timezone }, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setReports((current) => [response.report, ...current.filter((report) => report.id !== response.report.id)]);
      setNotice(`Report requested for ${dateLabel(date)}.`);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && !(cause instanceof DOMException && cause.name === "AbortError")) setCreateFailure(createError(cause));
    } finally { if (mounted.current && !controller.signal.aborted) setCreating(false); }
  }

  return <div className="report-lifecycle">
    <Card className="report-disclosure" role="note"><strong>Live factual reports</strong><span>Requests use your authorized development activity and are stored by Trace. Completed reports can be opened to view and download checksum-verified PDF and LaTeX files.</span></Card>
    <Card className="report-create-card">
      <form onSubmit={submit} noValidate>
        <label>Report date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="report-timezone"><span>Timezone</span><strong>Pakistan time ({timezone})</strong></div>
        <Button type="submit" disabled={creating}>{creating ? "Requesting…" : "Create report"}</Button>
      </form>
      {notice && <p className="report-notice-success" role="status">{notice}</p>}
      {createFailure && <p className="report-notice-error" role="alert">{createFailure}</p>}
    </Card>
    <section aria-labelledby="report-history-heading">
      <div className="report-section-heading"><div><span>Development activity</span><h2 id="report-history-heading">Report history</h2></div><Badge>{reports.length} reports</Badge></div>
      {loadFailure ? <Card className="report-state-card report-state-error" role="alert"><p>{loadFailure}</p><Button className="trace-button-secondary" onClick={() => void refreshHistory()}>Retry report history</Button></Card>
        : loading ? <Card className="report-state-card" role="status">Loading report history…</Card>
        : reports.length === 0 ? <Card className="report-state-card"><h3>No reports yet</h3><p>Choose a date to request your first development activity report.</p></Card>
        : <ul className="report-history-list">{reports.map((report) => <li key={report.id}><Card className={`report-history-card report-status-${report.status}`}>
          <div><Badge>{statusLabels[report.status]}</Badge><h3>{dateLabel(report.reportDate)}</h3><p>{report.timezone} · Requested {new Date(report.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: report.timezone })}</p>{report.errorMessage && <p className="report-failure-message">{report.errorMessage}</p>}</div>
          <div className="report-history-actions">
            <Link
              className="trace-button trace-button-secondary"
              href={`/reports/${encodeURIComponent(report.id)}`}
              aria-label={`${report.downloadAvailable ? "View and download" : "Open"} report for ${dateLabel(report.reportDate)}`}
            >
              {report.downloadAvailable ? "View & download" : "Open report"}
            </Link>
          </div>
        </Card></li>)}</ul>}
    </section>
  </div>;
}
