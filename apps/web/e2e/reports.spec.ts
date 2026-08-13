import { expect, test, type Page } from "@playwright/test";
import type { ReportSummary } from "@trace/shared";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };
const summaries: ReportSummary[] = [
  { id: "report-completed", reportDate: "2026-08-12", timezone: "UTC", status: "completed", createdAt: "2026-08-13T00:00:00.000Z", completedAt: "2026-08-13T00:02:00.000Z", errorMessage: null, revision: 1, downloadAvailable: true },
  { id: "report-processing", reportDate: "2026-08-11", timezone: "UTC", status: "processing", createdAt: "2026-08-12T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
  { id: "report-pending", reportDate: "2026-08-10", timezone: "UTC", status: "pending", createdAt: "2026-08-11T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
  { id: "report-failed", reportDate: "2026-08-09", timezone: "UTC", status: "failed", createdAt: "2026-08-10T00:00:00.000Z", completedAt: null, errorMessage: "No development activity was found for this date.", revision: null, downloadAvailable: false },
];


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
  const listRequest = page.waitForRequest((request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/reports");
  await page.goto("/reports");
  await listRequest;
  await expect(page.getByRole("heading", { level: 1, name: "Development activity reports" })).toBeVisible();
  await expect(page.getByText("Live factual reports")).toBeVisible();
  for (const status of ["Completed", "Processing", "Pending", "Failed"]) await expect(page.getByText(status, { exact: true })).toBeVisible();
  await expect(page.getByText("No development activity was found for this date.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download report for August 12, 2026 — download delivery is not available yet" })).toBeDisabled();

  await page.getByLabel("Report date").fill("2026-08-13");
  const createRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/reports");
  await page.getByRole("button", { name: "Create report" }).click();
  const created = await createRequest;
  expect(created.headers()["x-csrf-token"]).toBe(session.csrfToken);
  await expect(page.getByRole("status")).toContainText("Report requested for August 13, 2026");

  await expect(page.getByRole("link", { name: "Open report for August 12, 2026" })).toHaveAttribute("href", "/reports/report-completed");
});

test("live report history stays usable without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Report history" })).toBeVisible();
  const dimensions = await page.locator("body").evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  await expect(page.getByRole("button", { name: "Create report" })).toBeVisible();
});
