import { expect, test, type Page } from "@playwright/test";

const session = {
  user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_opaque_value",
};

async function authenticated(page: Page) {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
}

test("repository access and Trace tracking remain distinct on desktop and mobile", async ({ page }) => {
  await authenticated(page);
  await page.goto("/repositories");

  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  await expect(page.getByText("Contract fixture preview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "trace-fixture-org/trace" })).toBeVisible();
  await expect(page.getByText("GitHub access active").first()).toBeVisible();
  await expect(page.getByText("Not tracked by Trace")).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search repositories" });
  await search.fill("legacy");
  await expect(page).toHaveURL(/search=legacy/);
  await expect(page.getByRole("heading", { name: "archive-fixture-org/legacy-api" })).toBeVisible();
  await expect(page.getByText("Historical access only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" })).toBeDisabled();
  await expect(page.getByRole("link", { name: /legacy-api/i })).toHaveCount(0);

  await search.fill("");
  await expect(page).not.toHaveURL(/search=/);
  await page.getByRole("button", { name: "Track trace-fixture-org/trace" }).click();
  await expect(page.getByRole("button", { name: "Stop tracking trace-fixture-org/trace" })).toBeVisible();
});
