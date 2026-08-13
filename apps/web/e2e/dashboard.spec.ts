import { expect, test } from "@playwright/test";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/v1/dashboard?*", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? "2026-08-12";
    const timezone = url.searchParams.get("timezone") ?? "UTC";
    const hasActivity = timezone === "Pacific/Honolulu" ? date === "2026-08-11" : date === "2026-08-12";
    const activity = { id: "activity_commit_1", repository: { id: "repo_1", fullName: "trace-fixture-org/trace", url: null }, contributor: { id: "contributor_1", username: "alice-dev", displayName: "Alice Developer", avatarUrl: null }, source: "github", type: "commit", occurredAt: "2026-08-12T09:30:00.000Z", facts: { sha: "0123456789abcdef0123456789abcdef01234567", message: "Add repository synchronization", branch: "main", filesChanged: 4, additions: 120, deletions: 18, url: null } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ date, timezone, state: hasActivity ? "READY" : "NO_ACTIVITY", metrics: hasActivity ? { activityCount: 2, repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 4, additions: 120, deletions: 18 } : { activityCount: 0, repositoryCount: 1, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 }, recentActivity: hasActivity ? [activity] : [] }) });
  });
});

test("dashboard presents factual metrics and stable filters on desktop and mobile", async ({ page }) => {
  await page.goto("/dashboard?context=review&timezone=UTC");
  await expect(page.getByRole("heading", { level: 1, name: "Development dashboard" })).toBeVisible();
  await expect(page.getByText("Live dashboard connection")).toBeVisible();
  await expect(page.getByLabel("Development activity metrics").getByRole("article")).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Add repository synchronization" })).toBeVisible();

  await page.getByLabel("Repository").selectOption("repo_1");
  await expect(page).toHaveURL(/repositoryId=repo_1/);
  await expect(page).toHaveURL(/context=review/);
  await page.reload();
  await expect(page.getByLabel("Repository")).toHaveValue("repo_1");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((node) => node.clientWidth));
});

test("dashboard history restores filters and invalid contract values fall back safely", async ({ page }) => {
  await page.goto("/dashboard?date=2026-08-11&repositoryId=repo_1");
  await page.goto("/dashboard?date=2026-08-12");
  await page.goBack();
  await expect(page.getByLabel("Date")).toHaveValue("2026-08-11");
  await expect(page.getByLabel("Repository")).toHaveValue("repo_1");
  await page.goForward();
  await expect(page.getByLabel("Date")).toHaveValue("2026-08-12");

  await page.getByLabel("Date").fill("2026-08-11");
  await expect(page.getByRole("heading", { name: "No development activity for this view" })).toBeVisible();

  await page.goto("/dashboard?date=2026-08-11&timezone=Pacific%2FHonolulu");
  await expect(page.getByLabel("Development activity metrics")).toBeVisible();
  await expect(page.getByText("August 11, 2026", { exact: true })).toBeVisible();
  await page.goto("/dashboard?date=2026-08-12&timezone=Pacific%2FHonolulu");
  await expect(page.getByRole("heading", { name: "No development activity for this view" })).toBeVisible();

  await page.goto("/dashboard?date=not-a-date&timezone=Not%2FAZone");
  await expect(page.getByRole("heading", { level: 1, name: "Development dashboard" })).toBeVisible();
  await expect(page.getByLabel("Date")).toHaveValue("2026-08-12");
  await expect(page.getByText("UTC", { exact: true })).toBeVisible();
});
