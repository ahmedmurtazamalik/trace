"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCommitHorizontal, GitPullRequest, Upload } from "lucide-react";
import { Badge, Button, Card } from "@trace/ui";
import type { ActivityListQuery, ActivityListResponse, ActivitySummary, ActivitySource, ActivityType } from "@trace/shared";

export type ActivityFilters = Pick<ActivityListQuery, "date" | "repositoryId" | "contributorId" | "source" | "type">;
export type LoadActivity = (query: Partial<ActivityListQuery>) => Promise<ActivityListResponse>;
interface ActivityExperienceProps { loadActivity: LoadActivity; initialFilters?: ActivityFilters; onFiltersChange?: (filters: ActivityFilters) => void }

const labels: Record<string, string> = { commit: "Commit", push: "Push", pull_request: "Pull request", working_tree_snapshot: "Working tree snapshot", staged_change: "Staged change", untracked_file: "Untracked file", local_commit: "Local commit" };
const typeOptions: Array<{ value: ActivityType; label: string }> = Object.entries(labels).map(([value, label]) => ({ value: value as ActivityType, label }));
const repositoryOptions = [{ id: "repo-01", label: "trace-fixture-org/trace" }, { id: "repo-02", label: "trace-fixture-org/api" }];
const contributorOptions = [{ id: "contributor-01", label: "Maya Chen" }, { id: "external-01", label: "external-contributor" }];

function contributorName(item: ActivitySummary) { return item.contributor?.displayName ?? item.contributor?.username ?? "Unknown contributor"; }
function icon(type: string) { if (type === "push") return <Upload aria-hidden="true" size={18} />; if (type === "pull_request") return <GitPullRequest aria-hidden="true" size={18} />; return <GitCommitHorizontal aria-hidden="true" size={18} />; }
function filtered(filters: ActivityFilters) { return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")) as ActivityFilters; }

export function ActivityExperience({ loadActivity, initialFilters = {}, onFiltersChange }: ActivityExperienceProps) {
  const [filters, setFilters] = useState<ActivityFilters>(filtered(initialFilters));
  const [items, setItems] = useState<ActivitySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const query = useMemo(() => ({ ...filters, limit: 25, timezone: "UTC" }), [filters]);

  const reload = useCallback(() => {
    setLoading(true); setError(undefined);
    return loadActivity(query).then((response) => { setItems(response.items); setNextCursor(response.pageInfo.nextCursor); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Trace could not load activity."))
      .finally(() => setLoading(false));
  }, [loadActivity, query]);
  useEffect(() => { void reload(); }, [reload]);

  function change<K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K] | "") {
    const next = filtered({ ...filters, [key]: value || undefined }); setFilters(next); onFiltersChange?.(next);
  }
  function clear() { setFilters({}); onFiltersChange?.({}); }
  async function loadMore() {
    if (nextCursor === null) return; setLoadingMore(true); setPageError(undefined);
    try {
      const response = await loadActivity({ ...query, cursor: nextCursor });
      setItems((current) => { const byId = new Map(current.map((item) => [item.id, item])); response.items.forEach((item) => byId.set(item.id, item)); return [...byId.values()]; });
      setNextCursor(response.pageInfo.nextCursor);
    } catch (cause) { setPageError(cause instanceof Error ? cause.message : "Trace could not load more activity."); }
    finally { setLoadingMore(false); }
  }

  return <div className="activity-experience">
    <Card className="activity-disclosure" role="note"><strong>Illustrative activity</strong><span>Deterministic examples exercise the frozen activity contract; no live webhook data is shown yet.</span></Card>
    <Card className="activity-filter-card">
      <div className="activity-filter-grid">
        <label>Date<input type="date" value={filters.date ?? ""} onChange={(event) => change("date", event.target.value)} /></label>
        <label>Repository<select value={filters.repositoryId ?? ""} onChange={(event) => change("repositoryId", event.target.value)}><option value="">All repositories</option>{repositoryOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Contributor<select value={filters.contributorId ?? ""} onChange={(event) => change("contributorId", event.target.value)}><option value="">All contributors</option>{contributorOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Source<select value={filters.source ?? ""} onChange={(event) => change("source", event.target.value as ActivitySource | "")}><option value="">All sources</option><option value="github">GitHub</option><option value="cli">CLI</option></select></label>
        <label>Activity type<select value={filters.type ?? ""} onChange={(event) => change("type", event.target.value as ActivityType | "")}><option value="">All types</option>{typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <Button className="trace-button-secondary" onClick={clear} disabled={Object.keys(filters).length === 0}>Clear filters</Button>
    </Card>

    {loading && items.length === 0 ? <Card className="activity-state-card" role="status">Loading development activity…</Card>
      : error !== undefined && items.length === 0 ? <Card className="activity-state-card activity-state-error" role="alert"><p>{error}</p><Button className="trace-button-secondary" onClick={() => void reload()}>Retry</Button></Card>
      : items.length === 0 ? <Card className="activity-state-card"><h2>{Object.keys(filters).length ? "No activity matches these filters" : "No development activity yet"}</h2><p>{Object.keys(filters).length ? "Clear filters or choose a broader combination." : "Activity appears after a tracked repository sends development events."}</p>{Object.keys(filters).length > 0 && <Button className="trace-button-secondary" onClick={clear}>Clear filters</Button>}</Card>
      : <div className="activity-timeline" aria-label="Development activity timeline">{items.map((item) => <Card className="activity-event-card" key={item.id}>
        <span className="activity-event-icon">{icon(item.type)}</span><div className="activity-event-body"><div className="activity-event-heading"><Badge>{labels[item.type] ?? "Activity"}</Badge><span>{item.source.toUpperCase()}</span></div><h2>{item.facts.message ?? labels[item.type] ?? "Development activity"}</h2><p>{contributorName(item)} <span aria-hidden="true">·</span> {item.repository.fullName}</p><div className="activity-facts">{item.facts.branch !== null && <span>Branch {item.facts.branch}</span>}{item.facts.filesChanged !== null && <span>{item.facts.filesChanged} files</span>}{item.facts.additions !== null && <span className="activity-additions">+{item.facts.additions}</span>}{item.facts.deletions !== null && <span className="activity-deletions">−{item.facts.deletions}</span>}</div></div><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })}</time>
      </Card>)}</div>}
    {nextCursor !== null && <div className="activity-pagination"><Button className="trace-button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more activity"}</Button></div>}
    {pageError !== undefined && <div className="activity-notice-error" role="alert">{pageError} <Button className="trace-button-secondary" onClick={() => void loadMore()}>Retry</Button></div>}
  </div>;
}
