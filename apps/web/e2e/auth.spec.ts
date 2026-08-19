import { expect, test, type Page } from "@playwright/test";

const session = {
  user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_opaque_value",
};

async function anonymous(page: Page) {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "UNAUTHENTICATED", message: "Authentication is required.", requestId: "e2e-me" }) }));
}

test("anonymous protected navigation returns to the requested local page after login", async ({ page }) => {
  await anonymous(page);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.goto("/reports?range=week");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel("Username").fill("alice.dev");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/reports\?range=week$/);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
});

test("login renders safe invalid-credential feedback and remains usable", async ({ page }) => {
  await anonymous(page);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "INVALID_CREDENTIALS", message: "unsafe internal detail", requestId: "e2e-login" }) }));
  await page.goto("/login");
  await page.getByLabel("Username").fill("alice.dev");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".auth-alert[role='alert']")).toHaveText("The username or password is incorrect.");
  await expect(page.getByText("unsafe internal detail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("login renders safe disabled-account feedback without exposing backend details", async ({ page }) => {
  await anonymous(page);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "ACCOUNT_DISABLED", message: "unsafe suspension reason", requestId: "e2e-disabled" }) }));
  await page.goto("/login");
  await page.getByLabel("Username").fill("alice.dev");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".auth-alert[role='alert']")).toHaveText("This account is disabled. Contact support for help.");
  await expect(page.getByText("unsafe suspension reason")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("public registration stays closed until GitHub signup replaces it", async ({ page }) => {
  await anonymous(page);
  await page.goto("/register");
  await expect(page.getByRole("heading", { level: 1, name: "Account creation is closed." })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Public username registration is disabled. GitHub signup will replace it.");
  await expect(page.getByRole("link", { name: "Sign in with an existing account" })).toHaveAttribute("href", "/login");
});

test("password recovery preserves account privacy", async ({ page }) => {
  await anonymous(page);
  await page.route("**/api/v1/auth/password/forgot", (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ message: "If the account exists, password reset instructions have been sent." }) }));
  await page.goto("/forgot-password");
  await page.getByLabel("Username or email").fill("unknown@example.com");
  await page.getByRole("button", { name: "Request reset" }).click();
  await expect(page.getByRole("status")).toHaveText("If the account exists, password reset instructions have been sent.");
});

test("password reset requires a token and completes with a valid one", async ({ page }) => {
  await anonymous(page);
  await page.goto("/reset-password");
  await expect(page.locator(".auth-alert[role='alert']")).toHaveText("This reset link is invalid or has expired.");
  await page.route("**/api/v1/auth/password/reset", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) }));
  await page.goto("/reset-password?token=opaque-token");
  await page.getByLabel("New password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toHaveText("Password updated. You can now sign in.");
});

test("logout sends canonical CSRF and returns to login", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  let csrfHeader: string | undefined;
  let requestBody: string | null = "not-observed";
  await page.route("**/api/v1/auth/logout", async (route) => {
    csrfHeader = route.request().headers()["x-csrf-token"];
    requestBody = route.request().postData();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(csrfHeader).toBe("csrf_opaque_value");
  expect(requestBody).toBeNull();
});
