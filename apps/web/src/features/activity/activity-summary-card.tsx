import Image from "next/image";
import Link from "next/link";
import { GitCommitHorizontal, GitPullRequest, Upload } from "lucide-react";
import { Badge, Card } from "@trace/ui";
import type { ActivitySummary } from "@trace/shared";

const labels: Record<string, string> = { commit: "Commit", push: "Push", pull_request: "Pull request", working_tree_snapshot: "Working tree snapshot", staged_change: "Staged change", untracked_file: "Untracked file", local_commit: "Local commit" };

function contributorName(item: ActivitySummary) { return item.contributor?.displayName ?? item.contributor?.username ?? "Unknown contributor"; }
function contributorInitials(item: ActivitySummary) { return contributorName(item).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function icon(type: string) { if (type === "push") return <Upload aria-hidden="true" size={18} />; if (type === "pull_request") return <GitPullRequest aria-hidden="true" size={18} />; return <GitCommitHorizontal aria-hidden="true" size={18} />; }
function timestamp(value: string, timezone: string) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short", timeZone: timezone,
  }).format(new Date(value));
  return formatted.replace(/, (?=\d{1,2}:\d{2}:\d{2})/, " at ");
}
function changedFiles(count: number) { return `${count} ${count === 1 ? "file" : "files"} changed`; }

interface Props { item: ActivitySummary; timezone?: string; headingLevel?: 2 | 3; index?: number }

export function ActivitySummaryCard({ item, timezone = "UTC", headingLevel = 2, index }: Props) {
  const Heading = `h${headingLevel}` as const;
  const name = contributorName(item);
  return <Card className="activity-event-card" style={index === undefined ? undefined : { "--row-index": index } as React.CSSProperties}>
    <span className="activity-event-icon">{icon(item.type)}</span>
    <div className="activity-event-body">
      <div className="activity-event-heading"><Badge>{labels[item.type] ?? "Activity"}</Badge><span>{item.source.toUpperCase()}</span></div>
      <Heading>{item.facts.message ?? labels[item.type] ?? "Development activity"}</Heading>
      <div className="activity-contributor">
        {item.contributor?.avatarUrl !== null && item.contributor?.avatarUrl !== undefined
          ? <Image unoptimized className="activity-contributor-avatar" src={item.contributor.avatarUrl} width={32} height={32} alt={`${name}'s avatar`} />
          : <span className="activity-contributor-avatar activity-contributor-fallback" aria-hidden="true">{contributorInitials(item)}</span>}
        {item.contributor === null
          ? <span className="activity-contributor-identity"><strong>{name}</strong></span>
          : <Link className="activity-contributor-link" aria-label={`View activity for ${name}`} href={`/contributors/${encodeURIComponent(item.contributor.id)}`}><span className="activity-contributor-identity"><strong>{name}</strong>{item.contributor.username !== null && <small>@{item.contributor.username}</small>}</span></Link>}
        <span aria-hidden="true">·</span>
        <span>{item.repository.fullName}</span>
      </div>
      <div className="activity-facts">{item.facts.branch !== null && <span>Branch {item.facts.branch}</span>}{item.facts.filesChanged !== null && <span>{changedFiles(item.facts.filesChanged)}</span>}{item.facts.additions !== null && <span className="activity-additions">+{item.facts.additions}</span>}{item.facts.deletions !== null && <span className="activity-deletions">−{item.facts.deletions}</span>}</div>
    </div>
    <time dateTime={item.occurredAt}>{timestamp(item.occurredAt, timezone)}</time>
  </Card>;
}
