import { expect, test } from "@playwright/test";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
});

test("activity filters restore through the URL and the timeline remains responsive", async ({ page }) => {
  await page.goto("/activity?context=review&cursor=stale-cursor");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect(page.getByText("Illustrative activity")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Refine activity timeline" })).toBeVisible();

  await page.getByLabel("Repository").selectOption("repo-02");
  await page.getByLabel("Source").selectOption("github");
  await page.getByLabel("Activity type").selectOption("push");
  await expect(page).toHaveURL(/repositoryId=repo-02/);
  await expect(page).toHaveURL(/source=github/);
  await expect(page).toHaveURL(/type=push/);
  await expect(page).toHaveURL(/context=review/);
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.getByRole("heading", { name: "Publish webhook acceptance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Refine activity timeline" })).not.toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Repository")).toHaveValue("repo-02");
  await expect(page.getByLabel("Activity type")).toHaveValue("push");
  await expect(page.getByRole("heading", { name: "Publish webhook acceptance" })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((node) => node.clientWidth));

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/activity\?context=review$/);
  await expect(page.getByRole("heading", { name: "Refine activity timeline" })).toBeVisible();
});

test("browser history restores URL-derived activity filters", async ({ page }) => {
  await page.goto("/activity?repositoryId=repo-01");
  await page.goto("/activity?repositoryId=repo-02&source=github&type=push");
  await page.goBack();
  await expect(page.getByLabel("Repository")).toHaveValue("repo-01");
  await page.goForward();
  await expect(page.getByLabel("Activity type")).toHaveValue("push");
});

test("invalid activity query values fall back without crashing", async ({ page }) => {
  await page.goto("/activity?source=bogus&type=future_event&date=not-a-date&timezone=Not%2FAZone");
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await expect(page.getByLabel("Source")).toHaveValue("");
  await expect(page.getByLabel("Activity type")).toHaveValue("");
  await expect(page.getByLabel("Development activity timeline")).toBeVisible();
});

test("activity date filtering follows the selected timezone", async ({ page }) => {
  await page.goto("/activity?date=2026-08-11&timezone=Pacific%2FHonolulu");
  await expect(page.getByRole("heading", { name: "Refine activity timeline" })).toBeVisible();
  await page.goto("/activity?date=2026-08-12&timezone=Pacific%2FHonolulu");
  await expect(page.getByRole("heading", { name: "No activity matches these filters" })).toBeVisible();
});
