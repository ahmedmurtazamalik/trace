import type { ActivityListQuery, ActivityListResponse, ReportDetail } from "@trace/shared";
import { listActivity } from "./activity";

type ActivityLoader = (input: Partial<ActivityListQuery>, options?: { signal?: AbortSignal }) => Promise<ActivityListResponse>;
export type ContributorLabels = Record<string, string>;

function humanLabel(response: ActivityListResponse): string {
  const contributor = response.items.find((item) => item.contributor !== null)?.contributor;
  if (!contributor) return "Unknown contributor";
  if (contributor.displayName && contributor.username) return `${contributor.displayName} (@${contributor.username})`;
  if (contributor.displayName) return contributor.displayName;
  if (contributor.username) return `@${contributor.username}`;
  return "Unknown contributor";
}

export async function resolveReportContributorLabels(
  report: ReportDetail,
  signal?: AbortSignal,
  loadActivity: ActivityLoader = listActivity,
): Promise<ContributorLabels> {
  const ids = [...new Set(report.content?.repositories.flatMap((repository) => repository.contributors.map((contributor) => contributor.contributorId)) ?? [])];
  const entries = await Promise.all(ids.map(async (contributorId) => {
    try {
      const response = await loadActivity(
        { date: report.reportDate, timezone: report.timezone, contributorId, limit: 1 },
        { signal },
      );
      return [contributorId, humanLabel(response)] as const;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      if (typeof cause === "object" && cause !== null && "code" in cause
        && (cause.code === "UNAUTHENTICATED" || cause.code === "FORBIDDEN")) throw cause;
      return [contributorId, "Unknown contributor"] as const;
    }
  }));
  return Object.fromEntries(entries);
}
