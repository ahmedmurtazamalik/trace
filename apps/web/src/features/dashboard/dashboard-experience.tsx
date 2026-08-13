"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, FileDiff, Files, GitCommitHorizontal, GitFork, Plus, Minus, Users } from "lucide-react";
import { Badge, Button, Card } from "@trace/ui";
import type { DashboardQuery, DashboardResponse, DashboardState } from "@trace/shared";
import { ActivitySummaryCard } from "@/features/activity/activity-summary-card";

export type DashboardFilters = Pick<DashboardQuery, "date" | "repositoryId">;
export type LoadDashboard = (query: DashboardQuery, options?: { signal?: AbortSignal }) => Promise<DashboardResponse>;
interface Props { loadDashboard: LoadDashboard; initialDate: string; initialRepositoryId?: string; timezone?: string; onFiltersChange?: (filters: DashboardFilters) => void }

const metrics = [
  { key: "activityCount", label: "Activity", note: "Observed events", icon: Activity, accent: "signal" },
  { key: "repositoryCount", label: "Repositories", note: "With activity", icon: GitFork, accent: "violet" },
  { key: "contributorCount", label: "Contributors", note: "Distinct identities", icon: Users, accent: "emerald" },
  { key: "commitCount", label: "Commits", note: "Canonical commits", icon: GitCommitHorizontal, accent: "amber" },
  { key: "filesChanged", label: "Files changed", note: "Deterministic total", icon: Files, accent: "signal" },
  { key: "additions", label: "Additions", note: "Lines added", icon: Plus, accent: "emerald" },
  { key: "deletions", label: "Deletions", note: "Lines removed", icon: Minus, accent: "amber" },
] as const;

const stateActions: Partial<Record<DashboardState, { title: string; body: string; action: string; href: string }>> = {
  GITHUB_NOT_CONNECTED: { title: "Connect GitHub to begin", body: "Attach GitHub to discover repositories and receive development activity.", action: "Connect GitHub", href: "/github" },
  NO_TRACKED_REPOSITORIES: { title: "Choose repositories to track", body: "GitHub is connected, but Trace is not tracking a repository yet.", action: "Choose repositories", href: "/repositories" },
  NO_ACTIVITY: { title: "No development activity for this view", body: "Try another date or review the complete Activity timeline.", action: "Review Activity", href: "/activity" },
};

export function DashboardExperience({ loadDashboard, initialDate, initialRepositoryId, timezone = "UTC", onFiltersChange }: Props) {
  const [filters, setFilters] = useState<DashboardFilters>({ date: initialDate, repositoryId: initialRepositoryId });
  const [data, setData] = useState<DashboardResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController>();
  const initialFilterKey = JSON.stringify({ date: initialDate, ...(initialRepositoryId ? { repositoryId: initialRepositoryId } : {}) });
  const query = useMemo<DashboardQuery>(() => ({ date: filters.date, timezone, ...(filters.repositoryId ? { repositoryId: filters.repositoryId } : {}) }), [filters, timezone]);

  const reload = useCallback(() => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const request = ++generation.current;
    setLoading(true); setError(undefined); setData(undefined);
    return loadDashboard(query, { signal: controller.signal }).then((response) => { if (request === generation.current) setData(response); })
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError") && request === generation.current) setError(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "UNAUTHENTICATED" ? "Your session has expired. Please sign in again." : "Trace could not load the dashboard. Try again."); })
      .finally(() => { if (request === generation.current) setLoading(false); });
  }, [loadDashboard, query]);
  useEffect(() => { void reload(); return () => { activeRequest.current?.abort(); generation.current += 1; }; }, [reload]);
  useEffect(() => {
    const next = JSON.parse(initialFilterKey) as DashboardFilters;
    setFilters((current) => JSON.stringify(current) === initialFilterKey ? current : next);
  }, [initialFilterKey]);

  function change(next: DashboardFilters) { generation.current += 1; setFilters(next); onFiltersChange?.(next); }

  if (loading && data === undefined) return <Card className="dashboard-state" role="status">Loading dashboard…</Card>;
  if (error !== undefined && data === undefined) return <Card className="dashboard-state dashboard-state-error" role="alert"><p>{error}</p>{error.startsWith("Your session has expired") ? <Link className="trace-button trace-button-primary" href="/login">Sign in again</Link> : <Button className="trace-button-secondary" onClick={() => void reload()}>Retry</Button>}</Card>;
  if (data === undefined) return null;
  const action = stateActions[data.state];
  const selectedDate = new Date(`${data.date}T12:00:00.000Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });

  return <div className="dashboard-experience">
    <Card className="dashboard-disclosure" role="note"><strong>Live dashboard connection</strong><span>Trace requests authorized metrics from the production API. Test environments use contract fixtures.</span></Card>
    <Card className="dashboard-toolbar">
      <label>Date<input type="date" value={filters.date} onChange={(event) => { if (event.target.value) change({ ...filters, date: event.target.value }); }} /></label>
      <label>Repository<select value={filters.repositoryId ?? ""} onChange={(event) => change({ date: filters.date, repositoryId: event.target.value || undefined })}><option value="">All repositories</option><option value="repo_1">trace-fixture-org/trace</option></select></label>
      <span>{data.timezone}</span>
    </Card>
    {data.state === "PARTIAL" && <Card className="dashboard-warning" role="status"><strong>Some activity is still being processed.</strong><span>Available facts remain visible and may increase after processing finishes.</span></Card>}
    {action !== undefined ? <Card className="dashboard-state"><FileDiff aria-hidden="true" /><h2>{action.title}</h2><p>{action.body}</p><Link className="trace-button trace-button-primary" href={action.href}>{action.action}</Link></Card> : <>
      <section className="dashboard-metrics" aria-label="Development activity metrics">
        {metrics.map(({ key, label, note, icon: Icon, accent }, index) => <Card role="article" className="metric-card" data-accent={accent} key={key} style={{ "--card-index": index } as React.CSSProperties}><div className="metric-topline"><span>{label}</span><span className="metric-icon"><Icon aria-hidden="true" size={17} /></span></div><strong>{data.metrics[key].toLocaleString("en-US")}</strong><div className="metric-footer"><small>{note}</small></div></Card>)}
      </section>
      <Card className="dashboard-recent">
        <header className="section-heading"><div><span className="eyebrow">{selectedDate}</span><h2>Recent development activity</h2></div><Badge>{data.recentActivity.length} shown</Badge></header>
        <div className="activity-timeline">{data.recentActivity.map((item, index) => <ActivitySummaryCard headingLevel={3} index={index} item={item} key={item.id} timezone={data.timezone} />)}</div>
      </Card>
    </>}
  </div>;
}
