import { expect, test } from "@playwright/test";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
});

test("dashboard presents factual metrics and stable filters on desktop and mobile", async ({ page }) => {
  await page.goto("/dashboard?context=review&timezone=UTC");
  await expect(page.getByRole("heading", { level: 1, name: "Development dashboard" })).toBeVisible();
  await expect(page.getByText("Illustrative dashboard")).toBeVisible();
  await expect(page.getByLabel("Development activity metrics").getByRole("article")).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Add repository synchronization" })).toBeVisible();

  await page.getByLabel("Repository").selectOption("repo_1");
  await expect(page).toHaveURL(/repositoryId=repo_1/);
  await expect(page).toHaveURL(/context=review/);
  await page.reload();
  await expect(page.getByLabel("Repository")).toHaveValue("repo_1");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((node) => node.clientWidth));
});
