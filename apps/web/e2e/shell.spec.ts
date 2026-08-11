import { expect, test } from "@playwright/test";

const routes = {
  "/dashboard": "Good morning, developer.",
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
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
