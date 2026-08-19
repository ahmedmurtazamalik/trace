import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { workspaceReportDetailResponseSchema } from "@trace/shared";

const session = {
  user: { id: "usr_developer", username: "ali.dev", displayName: "Ali Developer", email: null, createdAt: "2026-08-18T00:00:00.000Z" },
  csrfToken: "csrf_workspace_report",
};

const workspace = {
  workspace: {
    id: "workspace_1", name: "Product Delivery", slug: "product-delivery", role: "DEVELOPER",
    memberCount: 2, repositoryCount: 1, archivedAt: null,
    createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z",
  },
  members: [], repositories: [],
};

const report = {
  report: {
    id: "report_1", reportDate: "2026-08-18", timezone: "UTC", status: "completed",
    createdAt: "2026-08-18T00:00:00.000Z", completedAt: "2026-08-18T01:00:00.000Z", errorMessage: null,
    revision: 1, downloadAvailable: true, revisionSource: "ai",
    content: { executiveSummary: "No code activity was recorded in this immutable window.", repositories: [] },
    facts: { repositoryCount: 1, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
    artifacts: [{ id: "artifact_1", revision: 1, kind: "pdf", fileName: "workspace-report.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "a".repeat(64) }],
  },
  workspaceEvidence: {
    workspaceId: "workspace_1", workspaceName: "Product Delivery", trigger: "MANUAL",
    scheduleVersion: null, scheduledFor: null, intendedLocalDateTime: null,
    windowStart: "2026-08-17T00:00:00.000Z", windowEnd: "2026-08-18T00:00:00.000Z", dataCutoffAt: "2026-08-18T00:00:00.000Z",
    recoveredAt: null, noActivity: true,
    repositories: [{
      repositoryId: "repository_1", fullName: "trace/product-delivery", accessState: "ACTIVE", baselineOnly: true, activityCount: 0,
      coverage: { totalFiles: 0, eligibleFiles: 0, analyzedFiles: 0, excludedFiles: 0, totalBytes: 0, analyzedBytes: 0, truncatedFiles: 0 },
    }],
  },
};

workspaceReportDetailResponseSchema.parse(report);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/v1/workspaces/workspace_1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/v1/workspaces/workspace_1/reports/report_1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) }));
});

test("Developer consumes a completed Workspace report without Manager controls or responsive accessibility defects", async ({ page }) => {
  await page.goto("/workspaces/workspace_1/reports/report_1");

  await expect(page.getByRole("heading", { level: 1, name: "Workspace report" })).toBeVisible();
  await expect(page.getByText("Developer access")).toBeVisible();
  await expect(page.getByText("No activity recorded")).toBeVisible();
  await expect(page.getByText("No code activity was recorded in this immutable window.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Regenerate report" })).toHaveCount(0);
  await expect(page.getByLabel("Structured report editor")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Report schedule" })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  if (test.info().project.name === "mobile") {
    const navGeometry = await page.locator(".mobile-nav").evaluate((nav) => {
      const links = [...nav.querySelectorAll<HTMLElement>(".nav-link")];
      const labelsFit = links.every((link) => {
        const label = link.querySelector<HTMLElement>("span:last-child");
        return label !== null && label.scrollWidth <= label.clientWidth;
      });
      const rects = links.map((link) => link.getBoundingClientRect());
      const intersections = rects.flatMap((left, index) => rects.slice(index + 1).filter((right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top));
      const bounds = nav.getBoundingClientRect();
      return { labelsFit, intersections: intersections.length, left: bounds.left, right: bounds.right, height: bounds.height, viewportWidth: innerWidth };
    });
    expect(navGeometry).toEqual({ labelsFit: true, intersections: 0, left: 0, right: navGeometry.viewportWidth, height: navGeometry.height, viewportWidth: navGeometry.viewportWidth });
    expect(navGeometry.height).toBeGreaterThan(100);
  }
  await page.addStyleTag({ content: "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }" });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (process.env.TRACE_CAPTURE_WORKSPACE_REPORT_QA === "1") {
    await page.screenshot({ path: `/tmp/trace-workspace-report-${test.info().project.name}.png`, fullPage: true });
  }
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
});
