import { expect, test } from "@playwright/test";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
});

test("report lifecycle is understandable and routes to report details", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Development activity reports" })).toBeVisible();
  await expect(page.getByText("Contract preview")).toBeVisible();
  for (const status of ["Completed", "Processing", "Pending", "Failed"]) await expect(page.getByText(status, { exact: true })).toBeVisible();
  await expect(page.getByText("No development activity was found for this date.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download report for August 11, 2026" })).toBeDisabled();

  await page.getByLabel("Report date").fill("2026-08-13");
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(page.getByRole("status")).toContainText("Report requested for August 13, 2026");

  await page.getByRole("link", { name: "Open report for August 12, 2026" }).click();
  await expect(page).toHaveURL(/\/reports\/report-completed$/);
  await expect(page.getByRole("heading", { level: 1, name: "Development activity report" })).toBeVisible();
  await expect(page.getByLabel("Deterministic report facts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();

  await page.goto("/reports/not-a-real-report");
  await expect(page.getByText("Trace could not load this report. Try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("report history stays usable without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Report history" })).toBeVisible();
  const dimensions = await page.locator("body").evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  await expect(page.getByRole("button", { name: "Create report" })).toBeVisible();
});
