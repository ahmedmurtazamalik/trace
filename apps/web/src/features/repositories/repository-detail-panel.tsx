"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, ShieldCheck, ShieldX } from "lucide-react";
import { Badge, Button, Card } from "@trace/ui";
import type { RepositoryDetailResponse } from "@trace/shared";
import { getRepository, RepositoryApiError } from "@/api/repositories";

type LoadRepository = (id: string, options?: { signal?: AbortSignal }) => Promise<RepositoryDetailResponse>;

export function RepositoryDetailPanel({ repositoryId, loadRepository = getRepository }: { repositoryId: string; loadRepository?: LoadRepository }) {
  const [detail, setDetail] = useState<RepositoryDetailResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true); setError(undefined);
    return loadRepository(repositoryId, { signal }).then(setDetail).catch((reason) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof RepositoryApiError ? reason.message : "Trace could not load this repository. Please try again.");
    }).finally(() => setLoading(false));
  }, [loadRepository, repositoryId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  if (loading) return <Card className="repository-state-card" role="status">Loading repository details…</Card>;
  if (error !== undefined) return <Card className="repository-state-card repository-state-error" role="alert"><p>{error}</p><Button className="trace-button-secondary" onClick={() => void load()}>Retry</Button></Card>;
  if (detail === undefined) return null;
  const repository = detail.repository;
  return <div className="repository-stack">
    <Link className="repository-link" href="/repositories">← Back to repositories</Link>
    <Card className={`repository-card repository-detail-card${repository.accessible ? "" : " repository-card-historical"}`}>
      <div className="repository-card-heading"><div><span className="eyebrow">{repository.owner}</span><h2>{repository.fullName}</h2></div><Badge>{repository.private ? "Private" : "Public"}</Badge></div>
      <div className="repository-label-grid"><div>{repository.accessible ? <ShieldCheck aria-hidden="true" size={18} /> : <ShieldX aria-hidden="true" size={18} />}<span><strong>{repository.accessible ? "GitHub access active" : "Historical access only"}</strong><small>{repository.accessible ? "Authorized by the GitHub App" : "Previously synchronized activity remains in Trace"}</small></span></div><div><span className={`repository-tracking-dot${repository.trackingEnabled ? " is-active" : ""}`} aria-hidden="true" /><span><strong>{repository.trackingEnabled ? "Tracked by Trace" : "Not tracked by Trace"}</strong><small>Tracking is independent from GitHub authorization</small></span></div></div>
      <dl className="repository-metadata"><div><dt>Default branch</dt><dd>{repository.defaultBranch}</dd></div><div><dt>Contributors</dt><dd>{repository.contributorCount}</dd></div><div><dt>Last retained activity</dt><dd>{repository.lastActivityAt === null ? "None retained" : new Date(repository.lastActivityAt).toLocaleString()}</dd></div></dl>
      {repository.url !== null && <a className="repository-link" href={repository.url} target="_blank" rel="noreferrer">Open on GitHub <ExternalLink aria-hidden="true" size={15} /></a>}
    </Card>
  </div>;
}
