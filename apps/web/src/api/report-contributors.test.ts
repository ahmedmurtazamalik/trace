import { describe, expect, it, vi } from "vitest";
import type { ActivityListResponse, ReportDetail } from "@trace/shared";
import { resolveReportContributorLabels } from "./report-contributors";

const report = {
  id: "report-1",
  reportDate: "2026-08-14",
  timezone: "Asia/Karachi",
  content: {
    executiveSummary: "Summary",
    repositories: [{
      repositoryId: "repo-1",
      summary: "Repository summary",
      contributors: [
        { contributorId: "internal-ali-id", summary: "Ali summary", accomplishments: ["Shipped UI"] },
        { contributorId: "internal-sam-id", summary: "Sam summary", accomplishments: ["Reviewed API"] },
      ],
    }],
  },
} as ReportDetail;

function activity(id: string, username: string | null, displayName: string | null): ActivityListResponse {
  return {
    items: [{
      id: `activity-${id}`,
      repository: { id: "repo-1", fullName: "team/trace", url: "https://github.com/team/trace" },
      contributor: { id, username, displayName, avatarUrl: null },
      source: "github",
      type: "commit",
      occurredAt: "2026-08-14T08:00:00.000Z",
      facts: { sha: "abcdef1".padEnd(40, "0"), message: "Ship", branch: "main", filesChanged: 1, additions: 2, deletions: 0, url: null },
    }],
    pageInfo: { nextCursor: null, hasNextPage: false },
  };
}

describe("report contributor labels", () => {
  it("resolves real display names and GitHub usernames without exposing internal IDs", async () => {
    const loadActivity = vi.fn()
      .mockResolvedValueOnce(activity("internal-ali-id", "alimajidneo", "Ali Majid"))
      .mockResolvedValueOnce(activity("internal-sam-id", "sam-dev", null));

    await expect(resolveReportContributorLabels(report, undefined, loadActivity)).resolves.toEqual({
      "internal-ali-id": "Ali Majid (@alimajidneo)",
      "internal-sam-id": "@sam-dev",
    });
    expect(loadActivity).toHaveBeenNthCalledWith(1, { date: "2026-08-14", timezone: "Asia/Karachi", contributorId: "internal-ali-id", limit: 1 }, { signal: undefined });
  });

  it("uses a privacy-safe fallback when authorized activity has no human-readable identity", async () => {
    const loadActivity = vi.fn().mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } });
    await expect(resolveReportContributorLabels(report, undefined, loadActivity)).resolves.toEqual({
      "internal-ali-id": "Unknown contributor",
      "internal-sam-id": "Unknown contributor",
    });
  });
});
