"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw, Search, ShieldCheck, ShieldX } from "lucide-react";
import { Badge, Button, Card, Input } from "@trace/ui";
import type { RepositoryListQuery, RepositoryListResponse, RepositorySummary, RepositorySynchronizationResponse, RepositoryTrackingResponse } from "@trace/shared";
import { useOptionalAuthSession } from "@/auth/session-provider";
import { listRepositories, RepositoryApiError, setRepositoryTracking, synchronizeRepositories } from "@/api/repositories";
import { AccessibleConfirmDialog } from "@/components/accessible-confirm-dialog";

type LoadRepositories = (query: Partial<RepositoryListQuery>, options?: { signal?: AbortSignal }) => Promise<RepositoryListResponse>;
type UpdateTracking = (repositoryId: string, trackingEnabled: boolean, csrfToken: string) => Promise<RepositoryTrackingResponse>;
type Synchronize = (csrfToken: string) => Promise<RepositorySynchronizationResponse>;

interface RepositoryManagementPanelProps {
  initialSearch?: string;
  loadRepositories?: LoadRepositories;
  updateTracking?: UpdateTracking;
  synchronize?: Synchronize;
  csrfToken?: string;
  onSearchChange?: (search: string) => void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof RepositoryApiError ? error.message : fallback;
}

export function RepositoryManagementPanel({
  initialSearch = "",
  loadRepositories = listRepositories,
  updateTracking = setRepositoryTracking,
  synchronize = synchronizeRepositories,
  csrfToken: injectedCsrfToken,
  onSearchChange,
}: RepositoryManagementPanelProps) {
  const auth = useOptionalAuthSession();
  const csrfToken = injectedCsrfToken ?? auth?.csrfToken;
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch.trim());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [updateError, setUpdateError] = useState<string>();
  const [pendingRepositoryId, setPendingRepositoryId] = useState<string>();
  const [syncing, setSyncing] = useState(false);
  const [stopTrackingTarget, setStopTrackingTarget] = useState<RepositorySummary>();
  const [stopTrackingTrigger, setStopTrackingTrigger] = useState<HTMLButtonElement>();

  useEffect(() => setSearch(initialSearch), [initialSearch]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const reload = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(undefined);
    return loadRepositories({ search: debouncedSearch || undefined, limit: 25 }, { signal })
      .then((response) => {
        setRepositories(response.items);
        setNextCursor(response.pageInfo.nextCursor);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(message(error, "Trace could not load repositories. Please try again."));
        }
      })
      .finally(() => setLoading(false));
  }, [debouncedSearch, loadRepositories]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  function changeSearch(value: string) {
    setSearch(value);
    onSearchChange?.(value.trim());
  }

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setPageError(undefined);
    try {
      const response = await loadRepositories({ search: debouncedSearch || undefined, cursor: nextCursor, limit: 25 });
      setRepositories((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        response.items.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      });
      setNextCursor(response.pageInfo.nextCursor);
    } catch (error) {
      setPageError(message(error, "Trace could not load more repositories. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  }

  async function sync() {
    if (csrfToken === undefined) return;
    setSyncing(true);
    setNotice(undefined);
    setLoadError(undefined);
    try {
      const result = await synchronize(csrfToken);
      setNotice(`${result.accessibleRepositoryCount} accessible ${result.accessibleRepositoryCount === 1 ? "repository" : "repositories"} synchronized.`);
      await reload();
    } catch (error) {
      setLoadError(message(error, "Trace could not synchronize repositories. Please try again."));
    } finally {
      setSyncing(false);
    }
  }

  async function toggleTracking(repository: RepositorySummary) {
    if (csrfToken === undefined) return;
    const nextTracking = !repository.trackingEnabled;
    setPendingRepositoryId(repository.id);
    setNotice(undefined);
    setUpdateError(undefined);
    try {
      const result = await updateTracking(repository.id, nextTracking, csrfToken);
      setRepositories((current) => current.map((item) => item.id === result.repositoryId ? { ...item, trackingEnabled: result.trackingEnabled } : item));
      setNotice(`Tracking ${result.trackingEnabled ? "enabled" : "stopped"} for ${repository.fullName}.`);
    } catch (error) {
      setUpdateError(message(error, `Trace could not update tracking for ${repository.fullName}. Please try again.`));
    } finally {
      setPendingRepositoryId(undefined);
    }
  }

  if (loading && repositories.length === 0) return <Card className="repository-state-card" role="status">Loading repository access…</Card>;
  if (loadError !== undefined && repositories.length === 0) return <Card className="repository-state-card repository-state-error" role="alert">
    <p>{loadError}</p><Button className="trace-button-secondary" onClick={() => void reload()}>Retry</Button>
  </Card>;

  return <div className="repository-stack">
    <Card className="repository-disclosure" role="note">
      <strong>Add repositories through GitHub</strong>
      <span>Choose repository access in the Trace GitHub App, then add or refresh the authorized list here. Tracking remains a separate choice. <Link className="repository-link" href="/github">Manage GitHub access</Link></span>
    </Card>

    <Card className="repository-toolbar-card">
      <label className="repository-search">
        <span className="sr-only">Search repositories</span><Search aria-hidden="true" size={18} />
        <Input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} aria-label="Search repositories" placeholder="Search owner or repository" />
      </label>
      <div className="repository-summary" aria-live="polite"><strong>{repositories.length}</strong><span>{repositories.length === 1 ? "repository loaded" : "repositories loaded"}</span></div>
      <Button className="trace-button-secondary" disabled={syncing || csrfToken === undefined} onClick={() => void sync()}>
        <RefreshCw aria-hidden="true" size={16} /> {syncing ? "Adding repositories…" : "Add or refresh repositories"}
      </Button>
    </Card>

    {notice !== undefined && <div className="repository-notice-success" role="status">{notice}</div>}
    {loadError !== undefined && <div className="repository-notice-error" role="alert">{loadError}</div>}
    {updateError !== undefined && <div className="repository-notice-error" role="alert">{updateError}</div>}

    {repositories.length === 0 ? <Card className="repository-state-card">
      <h2>{debouncedSearch ? "No repositories match" : "No repositories synchronized"}</h2>
      <p>{debouncedSearch ? "Try a different owner or repository name." : "Synchronize GitHub after connecting and installing the Trace GitHub App."}</p>
      {debouncedSearch && <Button className="trace-button-secondary" onClick={() => changeSearch("")}>Clear search</Button>}
    </Card> : <div className="repository-grid">
      {repositories.map((repository) => {
        const pending = pendingRepositoryId === repository.id;
        const cannotEnable = !repository.accessible && !repository.trackingEnabled;
        return <Card className={`repository-card${repository.accessible ? "" : " repository-card-historical"}`} key={repository.id}>
          <div className="repository-card-heading"><span className="repository-icon"><BookOpen aria-hidden="true" size={20} /></span><div><span className="eyebrow">{repository.owner}</span><h2><Link href={`/repositories/${repository.id}`}>{repository.fullName}</Link></h2></div><Badge>{repository.private ? "Private" : "Public"}</Badge></div>
          <div className="repository-label-grid"><div>{repository.accessible ? <ShieldCheck aria-hidden="true" size={18} /> : <ShieldX aria-hidden="true" size={18} />}<span><strong>{repository.accessible ? "GitHub access active" : "Historical access only"}</strong><small>{repository.accessible ? "Authorized by the GitHub App" : "No current provider access"}</small></span></div><div><span className={`repository-tracking-dot${repository.trackingEnabled ? " is-active" : ""}`} aria-hidden="true" /><span><strong>{repository.trackingEnabled ? "Tracked by Trace" : "Not tracked by Trace"}</strong><small>Tracking is your separate Trace choice</small></span></div></div>
          <dl className="repository-metadata"><div><dt>Default branch</dt><dd>{repository.defaultBranch}</dd></div><div><dt>Contributors</dt><dd>{repository.contributorCount}</dd></div><div><dt>Last activity</dt><dd>{repository.lastActivityAt === null ? "None retained" : new Date(repository.lastActivityAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd></div></dl>
          <div className="repository-actions">
            {repository.url !== null && <a className="repository-link" href={repository.url} target="_blank" rel="noreferrer">Open on GitHub <ExternalLink aria-hidden="true" size={15} /></a>}
            <Button
              className={repository.trackingEnabled ? "trace-button-secondary" : undefined}
              disabled={pending || cannotEnable || csrfToken === undefined}
              onClick={(event) => {
                if (repository.trackingEnabled) {
                  setStopTrackingTrigger(event.currentTarget);
                  setStopTrackingTarget(repository);
                } else {
                  void toggleTracking(repository);
                }
              }}
              aria-label={cannotEnable ? `Reconnect GitHub to track ${repository.fullName}` : `${repository.trackingEnabled ? "Stop tracking" : "Track"} ${repository.fullName}`}
            >{pending ? "Updating…" : cannotEnable ? "Reconnect GitHub to track" : repository.trackingEnabled ? "Stop tracking" : "Track repository"}</Button>
            {cannotEnable && <Link className="repository-link" href="/github">Reconnect GitHub</Link>}
          </div>
        </Card>;
      })}
    </div>}
    {nextCursor !== null && <div className="repository-pagination"><Button className="trace-button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more repositories"}</Button></div>}
    {pageError !== undefined && <div className="repository-notice-error" role="alert">{pageError} <Button className="trace-button-secondary" onClick={() => void loadMore()}>Retry</Button></div>}
    {stopTrackingTarget !== undefined && <AccessibleConfirmDialog
      title="Stop tracking repository?"
      description={<p>Trace will stop collecting new activity for <strong>{stopTrackingTarget.fullName}</strong>. Previously retained activity will remain available.</p>}
      confirmLabel={pendingRepositoryId === stopTrackingTarget.id ? "Stopping tracking…" : "Confirm stop tracking"}
      pending={pendingRepositoryId === stopTrackingTarget.id}
      returnFocus={stopTrackingTrigger ?? null}
      onCancel={() => setStopTrackingTarget(undefined)}
      onConfirm={() => { const target = stopTrackingTarget; setStopTrackingTarget(undefined); void toggleTracking(target); }}
    />}
  </div>;
}
