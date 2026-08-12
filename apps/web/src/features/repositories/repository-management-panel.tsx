"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, Search, ShieldCheck, ShieldX } from "lucide-react";
import { Badge, Button, Card, Input } from "@trace/ui";
import type { RepositoryListResponse, RepositorySummary, RepositoryTrackingResponse } from "@trace/shared";
import { listFixtureRepositories, updateFixtureRepositoryTracking } from "./repository-fixture-adapter";

type LoadRepositories = () => Promise<RepositoryListResponse>;
type UpdateTracking = (repositoryId: string, trackingEnabled: boolean) => Promise<RepositoryTrackingResponse>;

interface RepositoryManagementPanelProps {
  initialSearch?: string;
  loadRepositories?: LoadRepositories;
  updateTracking?: UpdateTracking;
  onSearchChange?: (search: string) => void;
}

function matchesSearch(repository: RepositorySummary, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return query.length === 0 || repository.fullName.toLocaleLowerCase().includes(query) || repository.defaultBranch.toLocaleLowerCase().includes(query);
}

export function RepositoryManagementPanel({
  initialSearch = "",
  loadRepositories = listFixtureRepositories,
  updateTracking = updateFixtureRepositoryTracking,
  onSearchChange,
}: RepositoryManagementPanelProps) {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [updateError, setUpdateError] = useState<string>();
  const [pendingRepositoryId, setPendingRepositoryId] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRepositories()
      .then((response) => {
        if (!active) return;
        setRepositories(response.items);
        setLoadError(undefined);
      })
      .catch(() => {
        if (active) setLoadError("Trace could not load repositories. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadRepositories]);

  const visibleRepositories = useMemo(
    () => repositories.filter((repository) => matchesSearch(repository, search)),
    [repositories, search],
  );

  function changeSearch(value: string) {
    setSearch(value);
    onSearchChange?.(value.trim());
  }

  async function toggleTracking(repository: RepositorySummary) {
    const nextTracking = !repository.trackingEnabled;
    setPendingRepositoryId(repository.id);
    setUpdateError(undefined);
    try {
      const result = await updateTracking(repository.id, nextTracking);
      setRepositories((current) => current.map((item) => item.id === result.repositoryId ? { ...item, trackingEnabled: result.trackingEnabled } : item));
    } catch {
      setUpdateError(`Trace could not update tracking for ${repository.fullName}. Please try again.`);
    } finally {
      setPendingRepositoryId(undefined);
    }
  }

  if (loading) return <Card className="repository-state-card" role="status">Loading repository access…</Card>;
  if (loadError !== undefined) return <Card className="repository-state-card repository-state-error" role="alert">{loadError}</Card>;

  return <div className="repository-stack">
    <Card className="repository-disclosure" role="note">
      <strong>Contract fixture preview</strong>
      <span>These deterministic repositories exercise the frozen Day 4 data format. Live GitHub repository endpoints are not connected yet.</span>
    </Card>

    <Card className="repository-toolbar-card">
      <label className="repository-search">
        <span className="sr-only">Search repositories</span>
        <Search aria-hidden="true" size={18} />
        <Input
          type="search"
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          aria-label="Search repositories"
          placeholder="Search owner, repository, or branch"
        />
      </label>
      <div className="repository-summary" aria-live="polite">
        <strong>{visibleRepositories.length}</strong>
        <span>{visibleRepositories.length === 1 ? "repository shown" : "repositories shown"}</span>
      </div>
    </Card>

    {updateError !== undefined && <div className="repository-notice-error" role="alert">{updateError}</div>}

    {visibleRepositories.length === 0 ? <Card className="repository-state-card">
      <h2>No repositories match</h2>
      <p>Try a different owner, repository, or branch name.</p>
      <Button className="trace-button-secondary" onClick={() => changeSearch("")}>Clear search</Button>
    </Card> : <div className="repository-grid">
      {visibleRepositories.map((repository) => {
        const pending = pendingRepositoryId === repository.id;
        return <Card className={`repository-card${repository.accessible ? "" : " repository-card-historical"}`} key={repository.id}>
          <div className="repository-card-heading">
            <span className="repository-icon"><BookOpen aria-hidden="true" size={20} /></span>
            <div>
              <span className="eyebrow">{repository.owner}</span>
              <h2>{repository.fullName}</h2>
            </div>
            <Badge>{repository.private ? "Private" : "Public"}</Badge>
          </div>

          <div className="repository-label-grid">
            <div>
              {repository.accessible ? <ShieldCheck aria-hidden="true" size={18} /> : <ShieldX aria-hidden="true" size={18} />}
              <span><strong>{repository.accessible ? "GitHub access active" : "Historical access only"}</strong><small>{repository.accessible ? "Authorized by the GitHub App" : "No current provider access"}</small></span>
            </div>
            <div>
              <span className={`repository-tracking-dot${repository.trackingEnabled ? " is-active" : ""}`} aria-hidden="true" />
              <span><strong>{repository.trackingEnabled ? "Tracked by Trace" : "Not tracked by Trace"}</strong><small>Tracking is your separate Trace choice</small></span>
            </div>
          </div>

          <dl className="repository-metadata">
            <div><dt>Default branch</dt><dd>{repository.defaultBranch}</dd></div>
            <div><dt>Contributors</dt><dd>{repository.contributorCount}</dd></div>
            <div><dt>Last activity</dt><dd>{repository.lastActivityAt === null ? "None retained" : new Date(repository.lastActivityAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd></div>
          </dl>

          <div className="repository-actions">
            {repository.url !== null && <a className="repository-link" href={repository.url} target="_blank" rel="noreferrer">
              Open on GitHub <ExternalLink aria-hidden="true" size={15} />
            </a>}
            <Button
              className={repository.trackingEnabled ? "trace-button-secondary" : undefined}
              disabled={pending || !repository.accessible}
              onClick={() => void toggleTracking(repository)}
              aria-label={`${repository.trackingEnabled ? "Stop tracking" : "Track"} ${repository.fullName}`}
            >
              {pending ? "Updating…" : repository.trackingEnabled ? "Stop tracking" : "Track repository"}
            </Button>
          </div>
        </Card>;
      })}
    </div>}
  </div>;
}
