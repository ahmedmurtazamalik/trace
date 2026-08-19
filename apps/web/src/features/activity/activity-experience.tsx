"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@trace/ui";
import type { ActivityListQuery, ActivityListResponse, ActivitySummary, ActivitySource, ActivityType, RepositoryListResponse } from "@trace/shared";
import { ActivitySummaryCard } from "./activity-summary-card";

export type ActivityFilters = Pick<ActivityListQuery, "date" | "repositoryId" | "contributorId" | "source" | "type">;
export type LoadActivity = (query: Partial<ActivityListQuery>, options?: { signal?: AbortSignal }) => Promise<ActivityListResponse>;
export type LoadActivityRepositories = (query?: { limit?: number }, options?: { signal?: AbortSignal }) => Promise<RepositoryListResponse>;
interface ActivityExperienceProps { loadActivity: LoadActivity; loadRepositories?: LoadActivityRepositories; initialFilters?: ActivityFilters; fixedFilters?: ActivityFilters; timezone?: string; onFiltersChange?: (filters: ActivityFilters) => void }

const labels: Record<string, string> = { commit: "Commit", push: "Push", pull_request: "Pull request", working_tree_snapshot: "Working tree snapshot", staged_change: "Staged change", untracked_file: "Untracked file", local_commit: "Local commit" };
const typeOptions: Array<{ value: ActivityType; label: string }> = Object.entries(labels).map(([value, label]) => ({ value: value as ActivityType, label }));
const validTypesBySource: Record<ActivitySource, Set<ActivityType>> = {
  github: new Set(["commit", "push", "pull_request"]),
  cli: new Set(["working_tree_snapshot", "staged_change", "untracked_file", "local_commit"]),
};

function filtered(filters: ActivityFilters) { return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")) as ActivityFilters; }
function filterKey(filters: ActivityFilters) { return JSON.stringify(filtered(filters)); }
function localDateKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function groupByDay(items: ActivitySummary[], timezone: string) {
  return items.reduce<Record<string, ActivitySummary[]>>((groups, item) => {
    const date = localDateKey(item.occurredAt, timezone);
    (groups[date] ??= []).push(item);
    return groups;
  }, {});
}
function safeError(cause: unknown, pagination = false) {
  if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "UNAUTHENTICATED") return "Your session has expired. Please sign in again.";
  if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 403) return "You do not have permission to view this activity.";
  return pagination ? "Trace could not load more activity. Try again." : "Trace could not load activity. Try again.";
}

export function ActivityExperience({ loadActivity, loadRepositories, initialFilters = {}, fixedFilters = {}, timezone = "UTC", onFiltersChange }: ActivityExperienceProps) {
  const [filters, setFilters] = useState<ActivityFilters>(filtered(initialFilters));
  const filtersRef = useRef(filters);
  const [items, setItems] = useState<ActivitySummary[]>([]);
  const [repositories, setRepositories] = useState<RepositoryListResponse["items"]>([]);
  const [repositoryError, setRepositoryError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController>();
  const activePageRequest = useRef<AbortController>();
  const initialFilterKey = filterKey(initialFilters);
  const fixedFilterKey = filterKey(fixedFilters);
  const fixedQueryFilters = useMemo(() => JSON.parse(fixedFilterKey) as ActivityFilters, [fixedFilterKey]);
  const query = useMemo(() => ({ ...filters, ...fixedQueryFilters, limit: 25, timezone }), [filters, fixedQueryFilters, timezone]);
  const availableTypes = useMemo(() => filters.source === undefined ? typeOptions : typeOptions.filter((option) => validTypesBySource[filters.source!].has(option.value)), [filters.source]);

  const reload = useCallback(() => {
    activeRequest.current?.abort();
    activePageRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setLoading(true); setError(undefined); setPageError(undefined); setItems([]); setNextCursor(null);
    return loadActivity(query, { signal: controller.signal }).then((response) => {
      if (generation !== requestGeneration.current) return;
      setItems(response.items); setNextCursor(response.pageInfo.nextCursor);
    }).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (generation !== requestGeneration.current) return;
      setError(safeError(cause));
    }).finally(() => {
      if (generation === requestGeneration.current) setLoading(false);
    });
  }, [loadActivity, query]);
  useEffect(() => { void reload(); return () => { activeRequest.current?.abort(); activePageRequest.current?.abort(); requestGeneration.current += 1; }; }, [reload]);
  useEffect(() => {
    if (loadRepositories === undefined) return;
    const controller = new AbortController();
    setRepositoryError(false);
    void loadRepositories({ limit: 100 }, { signal: controller.signal })
      .then((response) => setRepositories(response.items.filter((repository) => repository.accessible)))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setRepositoryError(true);
      });
    return () => controller.abort();
  }, [loadRepositories]);
  useEffect(() => {
    const next = JSON.parse(initialFilterKey) as ActivityFilters;
    if (filterKey(filtersRef.current) !== initialFilterKey) {
      filtersRef.current = next;
      setFilters(next);
    }
  }, [initialFilterKey]);

  function change<K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K] | "") {
    requestGeneration.current += 1;
    setLoadingMore(false);
    let next = filtered({ ...filtersRef.current, [key]: value || undefined });
    if (next.source && next.type && !validTypesBySource[next.source].has(next.type)) {
      next = filtered({ ...next, type: undefined });
    }
    filtersRef.current = next;
    setFilters(next); onFiltersChange?.(next);
  }
  function clear() { requestGeneration.current += 1; setLoadingMore(false); filtersRef.current = {}; setFilters({}); onFiltersChange?.({}); }
  async function loadMore() {
    if (nextCursor === null) return;
    activePageRequest.current?.abort();
    const controller = new AbortController();
    activePageRequest.current = controller;
    const generation = requestGeneration.current;
    setLoadingMore(true); setPageError(undefined);
    try {
      const response = await loadActivity({ ...query, cursor: nextCursor }, { signal: controller.signal });
      if (generation !== requestGeneration.current) return;
      setItems((current) => { const byId = new Map(current.map((item) => [item.id, item])); response.items.forEach((item) => byId.set(item.id, item)); return [...byId.values()]; });
      setNextCursor(response.pageInfo.nextCursor);
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError") && generation === requestGeneration.current) setPageError(safeError(cause, true)); }
    finally { if (generation === requestGeneration.current) setLoadingMore(false); }
  }

  return <div className="activity-experience">
    <Card className="activity-disclosure" role="note"><strong>Live activity connection</strong><span>Trace requests authorized development activity from the production API. Test environments use contract fixtures.</span></Card>
    <Card className="activity-filter-card">
      <div className="activity-filter-grid">
        <label>Date<input type="date" value={filters.date ?? ""} onChange={(event) => change("date", event.target.value)} /></label>
        <label>Repository<select value={filters.repositoryId ?? ""} onChange={(event) => change("repositoryId", event.target.value)}><option value="">All repositories</option>{filters.repositoryId && !repositories.some((repository) => repository.id === filters.repositoryId) && <option value={filters.repositoryId}>Selected repository</option>}{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></label>
        <label>Source<select value={filters.source ?? ""} onChange={(event) => change("source", event.target.value as ActivitySource | "")}><option value="">All sources</option><option value="github">GitHub</option><option value="cli">CLI</option></select></label>
        <label>Activity type<select value={filters.type ?? ""} onChange={(event) => change("type", event.target.value as ActivityType | "")}><option value="">All types</option>{availableTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      {repositoryError && <p className="activity-notice-error" role="status">Repository choices are temporarily unavailable. Existing activity filters still work.</p>}
      {(Object.keys(fixedQueryFilters).length === 0 || Object.keys(filters).length > 0) && <Button className="trace-button-secondary" onClick={clear} disabled={Object.keys(filters).length === 0}>Clear filters</Button>}
    </Card>

    {loading && items.length === 0 ? <Card className="activity-state-card" role="status">Loading development activity…</Card>
      : error !== undefined && items.length === 0 ? <Card className="activity-state-card activity-state-error" role="alert"><p>{error}</p>{error.startsWith("Your session has expired") ? <Link className="trace-button trace-button-primary" href="/login">Sign in again</Link> : <Button className="trace-button-secondary" onClick={() => void reload()}>Retry</Button>}</Card>
      : items.length === 0 ? <Card className="activity-state-card"><h2>{Object.keys(filters).length ? "No activity matches these filters" : "No development activity yet"}</h2><p>{Object.keys(filters).length ? "Clear filters or choose a broader combination." : "Enable tracking for a repository, then push a new commit. Trace records new events after tracking starts and does not backfill older commits."}</p>{Object.keys(filters).length > 0 ? <Button className="trace-button-secondary" onClick={clear}>Clear filters</Button> : <Link className="trace-button trace-button-primary" href="/repositories">Choose repositories to track</Link>}</Card>
      : <section className="activity-timeline" aria-label="Development activity timeline">{Object.entries(groupByDay(items, timezone)).map(([date, group]) => <section className="activity-day-group" key={date}><h2>{new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })}</h2><ul>{group?.map((item) => <li key={item.id}><ActivitySummaryCard headingLevel={3} item={item} timezone={timezone} /></li>)}</ul></section>)}</section>}
    {nextCursor !== null && <div className="activity-pagination"><Button className="trace-button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more activity"}</Button></div>}
    {pageError !== undefined && <div className="activity-notice-error" role="alert">{pageError} <Button className="trace-button-secondary" onClick={() => void loadMore()}>Retry</Button></div>}
  </div>;
}
