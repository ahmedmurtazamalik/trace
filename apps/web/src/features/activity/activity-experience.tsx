"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@trace/ui";
import type { ActivityListQuery, ActivityListResponse, ActivitySummary, ActivitySource, ActivityType } from "@trace/shared";
import { ActivitySummaryCard } from "./activity-summary-card";

export type ActivityFilters = Pick<ActivityListQuery, "date" | "repositoryId" | "contributorId" | "source" | "type">;
export type LoadActivity = (query: Partial<ActivityListQuery>) => Promise<ActivityListResponse>;
interface ActivityExperienceProps { loadActivity: LoadActivity; initialFilters?: ActivityFilters; timezone?: string; onFiltersChange?: (filters: ActivityFilters) => void }

const labels: Record<string, string> = { commit: "Commit", push: "Push", pull_request: "Pull request", working_tree_snapshot: "Working tree snapshot", staged_change: "Staged change", untracked_file: "Untracked file", local_commit: "Local commit" };
const typeOptions: Array<{ value: ActivityType; label: string }> = Object.entries(labels).map(([value, label]) => ({ value: value as ActivityType, label }));
const repositoryOptions = [{ id: "repo-01", label: "trace-fixture-org/trace" }, { id: "repo-02", label: "trace-fixture-org/api" }];
const contributorOptions = [{ id: "contributor-01", label: "Maya Chen" }, { id: "external-01", label: "external-contributor" }];
const validTypesBySource: Record<ActivitySource, Set<ActivityType>> = {
  github: new Set(["commit", "push", "pull_request"]),
  cli: new Set(["working_tree_snapshot", "staged_change", "untracked_file", "local_commit"]),
};

function filtered(filters: ActivityFilters) { return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")) as ActivityFilters; }

export function ActivityExperience({ loadActivity, initialFilters = {}, timezone = "UTC", onFiltersChange }: ActivityExperienceProps) {
  const [filters, setFilters] = useState<ActivityFilters>(filtered(initialFilters));
  const [items, setItems] = useState<ActivitySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const requestGeneration = useRef(0);
  const query = useMemo(() => ({ ...filters, limit: 25, timezone }), [filters, timezone]);
  const availableTypes = useMemo(() => filters.source === undefined ? typeOptions : typeOptions.filter((option) => validTypesBySource[filters.source!].has(option.value)), [filters.source]);

  const reload = useCallback(() => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError(undefined); setPageError(undefined); setItems([]); setNextCursor(null);
    return loadActivity(query).then((response) => {
      if (generation !== requestGeneration.current) return;
      setItems(response.items); setNextCursor(response.pageInfo.nextCursor);
    }).catch((cause: unknown) => {
      if (generation !== requestGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Trace could not load activity.");
    }).finally(() => {
      if (generation === requestGeneration.current) setLoading(false);
    });
  }, [loadActivity, query]);
  useEffect(() => { void reload(); return () => { requestGeneration.current += 1; }; }, [reload]);

  function change<K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K] | "") {
    requestGeneration.current += 1;
    let next = filtered({ ...filters, [key]: value || undefined });
    if (next.source && next.type && !validTypesBySource[next.source].has(next.type)) {
      next = filtered({ ...next, type: undefined });
    }
    setFilters(next); onFiltersChange?.(next);
  }
  function clear() { requestGeneration.current += 1; setFilters({}); onFiltersChange?.({}); }
  async function loadMore() {
    if (nextCursor === null) return;
    const generation = requestGeneration.current;
    setLoadingMore(true); setPageError(undefined);
    try {
      const response = await loadActivity({ ...query, cursor: nextCursor });
      if (generation !== requestGeneration.current) return;
      setItems((current) => { const byId = new Map(current.map((item) => [item.id, item])); response.items.forEach((item) => byId.set(item.id, item)); return [...byId.values()]; });
      setNextCursor(response.pageInfo.nextCursor);
    } catch (cause) { if (generation === requestGeneration.current) setPageError(cause instanceof Error ? cause.message : "Trace could not load more activity."); }
    finally { if (generation === requestGeneration.current) setLoadingMore(false); }
  }

  return <div className="activity-experience">
    <Card className="activity-disclosure" role="note"><strong>Illustrative activity</strong><span>Deterministic examples exercise the frozen activity contract; no live webhook data is shown yet.</span></Card>
    <Card className="activity-filter-card">
      <div className="activity-filter-grid">
        <label>Date<input type="date" value={filters.date ?? ""} onChange={(event) => change("date", event.target.value)} /></label>
        <label>Repository<select value={filters.repositoryId ?? ""} onChange={(event) => change("repositoryId", event.target.value)}><option value="">All repositories</option>{repositoryOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Contributor<select value={filters.contributorId ?? ""} onChange={(event) => change("contributorId", event.target.value)}><option value="">All contributors</option>{contributorOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Source<select value={filters.source ?? ""} onChange={(event) => change("source", event.target.value as ActivitySource | "")}><option value="">All sources</option><option value="github">GitHub</option><option value="cli">CLI</option></select></label>
        <label>Activity type<select value={filters.type ?? ""} onChange={(event) => change("type", event.target.value as ActivityType | "")}><option value="">All types</option>{availableTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <Button className="trace-button-secondary" onClick={clear} disabled={Object.keys(filters).length === 0}>Clear filters</Button>
    </Card>

    {loading && items.length === 0 ? <Card className="activity-state-card" role="status">Loading development activity…</Card>
      : error !== undefined && items.length === 0 ? <Card className="activity-state-card activity-state-error" role="alert"><p>{error}</p><Button className="trace-button-secondary" onClick={() => void reload()}>Retry</Button></Card>
      : items.length === 0 ? <Card className="activity-state-card"><h2>{Object.keys(filters).length ? "No activity matches these filters" : "No development activity yet"}</h2><p>{Object.keys(filters).length ? "Clear filters or choose a broader combination." : "Activity appears after a tracked repository sends development events."}</p>{Object.keys(filters).length > 0 && <Button className="trace-button-secondary" onClick={clear}>Clear filters</Button>}</Card>
      : <div className="activity-timeline" aria-label="Development activity timeline">{items.map((item) => <ActivitySummaryCard item={item} key={item.id} />)}</div>}
    {nextCursor !== null && <div className="activity-pagination"><Button className="trace-button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more activity"}</Button></div>}
    {pageError !== undefined && <div className="activity-notice-error" role="alert">{pageError} <Button className="trace-button-secondary" onClick={() => void loadMore()}>Retry</Button></div>}
  </div>;
}
