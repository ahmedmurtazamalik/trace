import { expect, test } from "@playwright/test";

const session = {
  user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_opaque_value",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
});

const routes = {
  "/dashboard": "Development dashboard",
  "/repositories": "Repositories",
  "/activity": "Activity",
  "/reports": "Reports",
  "/github": "GitHub",
  "/settings": "Settings",
  "/login": "Welcome back.",
  "/register": "Create your workspace.",
  "/forgot-password": "Reset access.",
  "/reset-password": "Choose a new password.",
} as const;

for (const [route, heading] of Object.entries(routes)) {
  test(`${route} renders its page shell`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
}

test("keyboard users can skip to content", async ({ page }) => {
  await page.goto("/dashboard");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
