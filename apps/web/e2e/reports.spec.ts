import { expect, test, type Page } from "@playwright/test";
import type { ReportDetail, ReportSummary } from "@trace/shared";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };
const summaries: ReportSummary[] = [
  { id: "report-completed", reportDate: "2026-08-12", timezone: "UTC", status: "completed", createdAt: "2026-08-13T00:00:00.000Z", completedAt: "2026-08-13T00:02:00.000Z", errorMessage: null, revision: 1, downloadAvailable: true },
  { id: "report-processing", reportDate: "2026-08-11", timezone: "UTC", status: "processing", createdAt: "2026-08-12T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
  { id: "report-pending", reportDate: "2026-08-10", timezone: "UTC", status: "pending", createdAt: "2026-08-11T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
  { id: "report-failed", reportDate: "2026-08-09", timezone: "UTC", status: "failed", createdAt: "2026-08-10T00:00:00.000Z", completedAt: null, errorMessage: "No development activity was found for this date.", revision: null, downloadAvailable: false },
];
const editableReport: ReportDetail = {
  id: "report-completed", reportDate: "2026-08-12", timezone: "UTC", status: "completed", createdAt: "2026-08-13T00:00:00.000Z", completedAt: "2026-08-13T00:02:00.000Z", errorMessage: null,
  revision: 1, revisionSource: "ai", downloadAvailable: true,
  facts: { repositoryCount: 1, contributorCount: 1, commitCount: 8, filesChanged: 21, additions: 342, deletions: 71 },
  content: { executiveSummary: "Initial executive summary.", repositories: [{ repositoryId: "repo_1", summary: "Initial repository summary.", contributors: [{ contributorId: "contributor_1", summary: "Initial contributor summary.", accomplishments: ["Shipped report lifecycle."] }] }] },
  artifacts: [{ id: "pdf-1", revision: 1, kind: "pdf", fileName: "trace-report.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "315d429b7714cedb6ad04ac31240145257692630457f3c88253c5beceac76027" }],
};

async function interceptEditableReport(page: Page) {
  const savedReport: ReportDetail = { ...editableReport, revision: 2, revisionSource: "manual", content: { ...editableReport.content!, executiveSummary: "Updated in the browser with <special> & safe text." }, artifacts: [{ ...editableReport.artifacts[0]!, id: "pdf-2", revision: 2 }] };
  const savedProcessing: ReportDetail = { ...savedReport, status: "processing", completedAt: null, downloadAvailable: false, artifacts: [] };
  const regeneratingReport: ReportDetail = { ...savedProcessing };
  let currentReport = editableReport;
  const saveBodies: unknown[] = [];
  const regenerationBodies: unknown[] = [];
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/v1/activity**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "evt-contributor", source: "github", type: "commit", repository: { id: "repo_1", fullName: "trace/web", url: "https://github.com/trace/web" }, contributor: { id: "contributor_1", username: "alice.dev", displayName: "Alice Developer", avatarUrl: null }, occurredAt: "2026-08-12T08:00:00.000Z", facts: { sha: "abcdef1".padEnd(40, "0"), message: "Ship report lifecycle", branch: "main", filesChanged: 1, additions: 2, deletions: 0, url: null } }], pageInfo: { nextCursor: null, hasNextPage: false } }) }));
  await page.route("**/api/v1/reports/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "GET" && path === "/api/v1/reports/report-completed") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ report: currentReport }) });
    if (request.method() === "GET" && path === "/api/v1/reports/report-completed/download" && url.searchParams.get("artifactId") === "pdf-1") return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF" });
    if (request.method() === "PUT" && path === "/api/v1/reports/report-completed/revision") {
      expect(request.headers()["x-csrf-token"]).toBe(session.csrfToken);
      saveBodies.push(request.postDataJSON());
      currentReport = savedReport;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ report: savedProcessing }) });
    }
    if (request.method() === "POST" && path === "/api/v1/reports/report-completed/regenerate") {
      expect(request.headers()["x-csrf-token"]).toBe(session.csrfToken);
      regenerationBodies.push(request.postDataJSON());
      currentReport = regeneratingReport;
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ report: regeneratingReport }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "REPORT_NOT_FOUND", message: "Report not found.", requestId: "req_missing" }) });
  });
  return { saveBodies, regenerationBodies };
}


async function interceptReportsApi(page: Page) {
  const items = [...summaries];
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/v1/reports**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/reports") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, pageInfo: { nextCursor: null, hasNextPage: false } }) });
    }
    if (request.method() === "POST" && url.pathname === "/api/v1/reports") {
      expect(request.headers()["x-csrf-token"]).toBe(session.csrfToken);
      const input = request.postDataJSON() as { reportDate: string; timezone: string };
      const report = { id: `report-${input.reportDate}`, reportDate: input.reportDate, timezone: input.timezone, status: "pending", createdAt: "2026-08-13T09:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false };
      items.unshift(report as ReportSummary);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ report }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "REPORT_NOT_FOUND", message: "Report not found.", requestId: "req_report_missing" }) });
  });
}

test.beforeEach(async ({ page }) => { await interceptReportsApi(page); });

test("live report HTTP lifecycle is understandable and routes to report details", async ({ page }) => {
  await page.route("**/api/v1/reports/report-completed", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ report: editableReport }) }));
  const listRequest = page.waitForRequest((request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/reports");
  await page.goto("/reports");
  await listRequest;
  await expect(page.getByRole("heading", { level: 1, name: "Development activity reports" })).toBeVisible();
  await expect(page.getByText("Live factual reports")).toBeVisible();
  for (const status of ["Completed", "Processing", "Pending", "Failed"]) await expect(page.getByText(status, { exact: true })).toBeVisible();
  await expect(page.getByText("No development activity was found for this date.")).toBeVisible();
  await expect(page.getByText(/Completed reports can be opened to view and download checksum-verified PDF and LaTeX files\./)).toBeVisible();
  await expect(page.getByText(/PDF downloads remain unavailable/)).toHaveCount(0);

  await page.getByLabel("Report date").fill("2026-08-13");
  const createRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/reports");
  await page.getByRole("button", { name: "Create report" }).click();
  const created = await createRequest;
  expect(created.headers()["x-csrf-token"]).toBe(session.csrfToken);
  await expect(page.getByRole("status")).toContainText("Report requested for August 13, 2026");

  const openReport = page.getByRole("link", { name: "View and download report for August 12, 2026" });
  await expect(openReport).toHaveAttribute("href", "/reports/report-completed");
  const detailResponsePromise = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/reports/report-completed");
  await openReport.click();
  const detailResponse = await detailResponsePromise;
  expect(detailResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByRole("heading", { name: "Structured report editor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trace could not load this view." })).toHaveCount(0);
});

test("Day 9 editor exposes only narrative fields and supports cancel", async ({ page }) => {
  await page.unrouteAll();
  await interceptEditableReport(page);
  await page.goto("/reports/report-completed");
  await expect(page.getByRole("heading", { name: "Structured report editor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alice Developer (@alice.dev)" })).toBeVisible();
  await expect(page.getByLabel("Alice Developer (@alice.dev) summary")).toHaveValue("Initial contributor summary.");
  await expect(page.getByText("contributor_1")).toHaveCount(0);
  await expect(page.getByText("Revision 1 · AI generated")).toBeVisible();
  await expect(page.getByText("Commits", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Executive summary")).toHaveValue("Initial executive summary.");

  await page.getByLabel("Executive summary").fill("Unsaved browser edit.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Cancel changes" }).click();
  await expect(page.getByLabel("Executive summary")).toHaveValue("Initial executive summary.");
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("Day 10 verifies downloads and regenerates only a saved current revision", async ({ page }) => {
  await page.unrouteAll();
  const { saveBodies, regenerationBodies } = await interceptEditableReport(page);
  await page.goto("/reports/report-completed");

  await expect(page.getByRole("heading", { name: "Report files" })).toBeVisible();
  await expect(page.getByText("trace-report.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("PDF · Revision 1 · 4 B", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("trace-report.pdf");

  const regenerate = page.getByRole("button", { name: "Regenerate report" });
  await page.getByLabel("Executive summary").fill("Unsaved before regeneration.");
  await expect(regenerate).toBeDisabled();
  await expect(page.getByText("Save or cancel your narrative changes before regenerating.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel changes" }).click();

  await page.getByLabel("Executive summary").fill("Updated in the browser with <special> & safe text.");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect.poll(() => saveBodies).toEqual([{ expectedRevision: 1, prosePatch: { executiveSummary: "Updated in the browser with <special> & safe text." } }]);
  await expect(page.getByText("Building your report")).toBeVisible();
  await expect(page.getByText("Revision 2 · Manually edited")).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 7_000 });

  await expect(regenerate).toBeEnabled();
  await regenerate.click();
  await expect.poll(() => regenerationBodies).toEqual([{ expectedRevision: 2 }]);
  await expect(page.getByText("Building your report")).toBeVisible();
});

test("Day 9 structured editor stays usable without horizontal overflow on mobile", async ({ page }) => {
  await page.unrouteAll();
  await interceptEditableReport(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/reports/report-completed");
  await expect(page.getByLabel("Executive summary")).toBeVisible();
  const dimensions = await page.locator("body").evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  await page.getByLabel("Executive summary").fill("Mobile edit.");
  await expect(page.getByRole("button", { name: "Save revision" })).toBeVisible();
});

test("unsaved report edits guard browser Back until discarding is accepted", async ({ page }) => {
  await page.unrouteAll();
  await interceptReportsApi(page);
  await interceptEditableReport(page);
  await page.goto("/reports");
  await page.getByRole("link", { name: "View and download report for August 12, 2026" }).click();
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await page.getByLabel("Executive summary").fill("Keep this browser-history edit.");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByLabel("Executive summary")).toHaveValue("Keep this browser-history edit.");

  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/reports$/);
});

test("unsaved report edits guard browser Forward until discarding is accepted", async ({ page }) => {
  await page.unrouteAll();
  await interceptEditableReport(page);
  await page.goto("/reports/report-completed");
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await page.getByLabel("Executive summary").fill("Decline forward data loss.");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByLabel("Executive summary")).toHaveValue("Decline forward data loss.");

  page.once("dialog", (dialog) => dialog.accept());
  await page.goForward({ waitUntil: "commit" });
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("fallback history guard restores marked jumps and unmarked auth history", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
  });
  await page.unrouteAll();
  await interceptReportsApi(page);
  await interceptEditableReport(page);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.goto("/login");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill("alice.dev");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Reports" }).first().click();
  await page.getByRole("link", { name: "View and download report for August 12, 2026" }).click();
  await page.getByLabel("Executive summary").fill("Preserve fallback history prose.");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.go(-2));
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByLabel("Executive summary")).toHaveValue("Preserve fallback history prose.");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.go(-3));
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByLabel("Executive summary")).toHaveValue("Preserve fallback history prose.");
});

test("unsaved report edits guard sign-out before the session is revoked", async ({ page }) => {
  await page.unrouteAll();
  await interceptReportsApi(page);
  await interceptEditableReport(page);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  let logoutRequests = 0;
  await page.route("**/api/v1/auth/logout", (route) => {
    logoutRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  await page.goto("/reports/report-completed");
  await page.getByLabel("Executive summary").fill("Do not discard this by signing out.");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Sign out" }).click();
  expect(logoutRequests).toBe(0);
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByLabel("Executive summary")).toHaveValue("Do not discard this by signing out.");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => logoutRequests).toBe(1);
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Username").fill("alice.dev");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Reports" }).first().click();
  await page.getByRole("link", { name: "View and download report for August 12, 2026" }).click();
  await page.getByLabel("Executive summary").fill("Guard a new edit after signing in again.");

  let postLoginNavigationPrompts = 0;
  page.on("dialog", async (dialog) => {
    postLoginNavigationPrompts += 1;
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect.poll(() => postLoginNavigationPrompts).toBe(1);
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByLabel("Executive summary")).toHaveValue("Guard a new edit after signing in again.");
});
