import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  "/workspaces": "Workspaces",
  "/github": "GitHub",
  "/settings": "Settings",
  "/login": "Welcome back.",
  "/register": "Create your workspace.",
  "/forgot-password": "Reset access.",
  "/reset-password": "Choose a new password.",
} as const;

async function automatedAccessibilityAudit(page: Page) {
  const findings = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const unnamedControls = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")]
      .filter(visible)
      .filter((element) => {
        const labelledBy = element.getAttribute("aria-labelledby");
        const hasReferencedLabel = labelledBy?.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim());
        const explicitLabel = element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim();
        const wrappedLabel = element.closest("label")?.textContent?.trim();
        return !element.getAttribute("aria-label")?.trim() && !hasReferencedLabel && !explicitLabel && !wrappedLabel && !element.textContent?.trim() && !element.getAttribute("title")?.trim();
      })
      .map((element) => element.outerHTML.slice(0, 120));
    const imagesWithoutAlt = [...document.querySelectorAll("img:not([alt])")].map((element) => element.outerHTML.slice(0, 120));
    return { duplicateIds, unnamedControls, imagesWithoutAlt, mainCount: document.querySelectorAll("main").length, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(findings).toEqual({ duplicateIds: [], unnamedControls: [], imagesWithoutAlt: [], mainCount: 1, horizontalOverflow: false });
}

for (const [route, heading] of Object.entries(routes)) {
  test(`${route} renders its page shell`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await automatedAccessibilityAudit(page);
    await page.addStyleTag({ content: "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }" });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const axeResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axeResults.violations, JSON.stringify(axeResults.violations, null, 2)).toEqual([]);
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

test("session and CSRF material never enters browser storage", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Development dashboard" })).toBeVisible();
  const browserState = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
    readableCookies: document.cookie,
  }));
  expect(JSON.stringify(browserState)).not.toContain(session.csrfToken);
  expect(JSON.stringify(browserState)).not.toContain(session.user.id);
  expect(browserState.local).toEqual({});
  expect(browserState.session).toEqual({});
});

test("reduced-motion preference suppresses decorative motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Development dashboard" })).toBeVisible();
  const durations = await page.locator("[data-testid='ambient-grid'] > span").evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).animationDuration)));
  expect(durations).toHaveLength(3);
  expect(durations.every((duration) => duration <= 0.00001)).toBe(true);
});
