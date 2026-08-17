import { expect, test, type Page } from "@playwright/test";

const session = {
  user: { id: "usr_auth_matrix", username: "auth.matrix", displayName: "Authorization Matrix", email: "auth-matrix@example.test", createdAt: "2026-08-18T00:00:00.000Z" },
  csrfToken: "csrf_auth_matrix",
};

const domains = [
  { route: "/dashboard", heading: "Development dashboard", hidden: ".dashboard-metrics" },
  { route: "/repositories", heading: "Repositories", hidden: ".repository-grid" },
  { route: "/activity", heading: "Activity", hidden: ".activity-timeline" },
  { route: "/reports", heading: "Reports", hidden: ".report-history-list" },
  { route: "/github", heading: "GitHub", hidden: ".github-status-grid" },
] as const;

async function authorizationFailure(page: Page, status: 401 | 403) {
  await page.route("**/api/v1/**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204 });
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
        message: "unsafe backend authorization detail cross-user-secret",
        requestId: `e2e-authz-${status}`,
      }),
    });
  });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
}

for (const status of [401, 403] as const) {
  for (const domain of domains) {
    test(`${domain.route} fails closed on ${status} without rendering protected data`, async ({ page }) => {
      await authorizationFailure(page, status);
      await page.goto(domain.route);

      await expect(page.getByRole("heading", { level: 1, name: domain.heading })).toBeVisible();
      await expect(page.getByRole("alert").first()).toBeVisible();
      await expect(page.getByText(/unsafe backend|cross-user-secret/i)).toHaveCount(0);
      await expect(page.locator(domain.hidden)).toHaveCount(0);
    });
  }
}
