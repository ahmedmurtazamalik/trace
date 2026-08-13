import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActivitySummary } from "@trace/shared";
import { ActivitySummaryCard } from "./activity-summary-card";

const activity: ActivitySummary = {
  id: "activity-rich-details",
  repository: { id: "repo-01", fullName: "alimajid266/coachconnect", url: "https://github.com/alimajid266/coachconnect" },
  contributor: {
    id: "contributor-01",
    username: "alimajid266",
    displayName: "Ali Majid",
    avatarUrl: "https://avatars.githubusercontent.com/u/185772005?v=4",
  },
  source: "github",
  type: "commit",
  occurredAt: "2026-08-13T07:52:45.000Z",
  facts: {
    sha: "dc69147c",
    message: "copy: refresh homepage hero message",
    branch: "main",
    filesChanged: 1,
    additions: 2,
    deletions: 2,
    url: "https://github.com/alimajid266/coachconnect/commit/dc69147c",
  },
};

describe("ActivitySummaryCard", () => {
  it("shows contributor identity, exact local time, branch, and changed-file count", () => {
    render(<ActivitySummaryCard item={activity} timezone="UTC" />);

    expect(screen.getByRole("img", { name: "Ali Majid's avatar" })).toHaveAttribute("src", activity.contributor?.avatarUrl);
    expect(screen.getByText("Ali Majid")).toBeInTheDocument();
    expect(screen.getByText("@alimajid266")).toBeInTheDocument();
    expect(screen.getByText("Branch main")).toBeInTheDocument();
    expect(screen.getByText("1 file changed")).toBeInTheDocument();
    expect(screen.getByText("Aug 13, 2026 at 7:52:45 AM UTC")).toBeInTheDocument();
    expect(screen.getByText("Aug 13, 2026 at 7:52:45 AM UTC").closest("time")).toHaveAttribute("datetime", activity.occurredAt);
  });
});
