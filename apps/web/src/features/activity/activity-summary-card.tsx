import { GitCommitHorizontal, GitPullRequest, Upload } from "lucide-react";
import { Badge, Card } from "@trace/ui";
import type { ActivitySummary } from "@trace/shared";

const labels: Record<string, string> = { commit: "Commit", push: "Push", pull_request: "Pull request", working_tree_snapshot: "Working tree snapshot", staged_change: "Staged change", untracked_file: "Untracked file", local_commit: "Local commit" };

function contributorName(item: ActivitySummary) { return item.contributor?.displayName ?? item.contributor?.username ?? "Unknown contributor"; }
function icon(type: string) { if (type === "push") return <Upload aria-hidden="true" size={18} />; if (type === "pull_request") return <GitPullRequest aria-hidden="true" size={18} />; return <GitCommitHorizontal aria-hidden="true" size={18} />; }

interface Props { item: ActivitySummary; timezone?: string; headingLevel?: 2 | 3; index?: number }

export function ActivitySummaryCard({ item, timezone = "UTC", headingLevel = 2, index }: Props) {
  const Heading = `h${headingLevel}` as const;
  return <Card className="activity-event-card" style={index === undefined ? undefined : { "--row-index": index } as React.CSSProperties}>
    <span className="activity-event-icon">{icon(item.type)}</span>
    <div className="activity-event-body">
      <div className="activity-event-heading"><Badge>{labels[item.type] ?? "Activity"}</Badge><span>{item.source.toUpperCase()}</span></div>
      <Heading>{item.facts.message ?? labels[item.type] ?? "Development activity"}</Heading>
      <p>{contributorName(item)} <span aria-hidden="true">·</span> {item.repository.fullName}</p>
      <div className="activity-facts">{item.facts.branch !== null && <span>Branch {item.facts.branch}</span>}{item.facts.filesChanged !== null && <span>{item.facts.filesChanged} files</span>}{item.facts.additions !== null && <span className="activity-additions">+{item.facts.additions}</span>}{item.facts.deletions !== null && <span className="activity-deletions">−{item.facts.deletions}</span>}</div>
    </div>
    <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone })}</time>
  </Card>;
}
