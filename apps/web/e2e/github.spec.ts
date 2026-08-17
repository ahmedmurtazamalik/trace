import { expect, test, type Page } from "@playwright/test";

const session = {
  user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" },
  csrfToken: "csrf_opaque_value",
};
const connected = {
  accountConnection: { status: "CONNECTED", account: { id: "github-1", username: "alice-dev", displayName: "Alice Developer", avatarUrl: null } },
  installationAuthorization: { status: "ACTIVE", installation: { id: "installation-1", accountType: "ORGANIZATION", accountLogin: "trace-example" } },
  accessibleRepositoryCount: 4,
  trackedRepositoryCount: 2,
  historyRetained: true,
};
const reconnectRequired = {
  accountConnection: { status: "RECONNECT_REQUIRED", account: connected.accountConnection.account },
  installationAuthorization: { status: "NOT_INSTALLED", installation: null },
  accessibleRepositoryCount: 0,
  trackedRepositoryCount: 0,
  historyRetained: true,
};

async function authenticated(page: Page) {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
}

async function interceptGithubDestination(page: Page) {
  await page.route(/^https:\/\/github\.com\//, (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Mock GitHub destination</title>",
  }));
}

test("connected GitHub status stays separate from installation and disconnect retains history", async ({ page }) => {
  await authenticated(page);
  let disconnected = false;
  await page.route("**/api/v1/github/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(disconnected ? reconnectRequired : connected),
  }));
  let csrf: string | undefined;
  await page.route("**/api/v1/github/connection", async (route) => {
    csrf = route.request().headers()["x-csrf-token"];
    disconnected = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, historyRetained: true }) });
  });

  await page.goto("/github");
  await expect(page.getByText("@alice-dev")).toBeVisible();
  await expect(page.getByText("Installation active")).toBeVisible();
  await expect(page.getByText("4 accessible")).toBeVisible();
  const disconnect = page.getByRole("button", { name: "Disconnect GitHub" });
  await disconnect.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Historical activity remains in Trace");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(disconnect).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Confirm disconnect" }).click();
  await expect(page.getByRole("status")).toContainText("Historical activity remains");
  await expect(page.getByRole("button", { name: "Reconnect GitHub" })).toBeVisible();
  expect(csrf).toBe("csrf_opaque_value");
});

test("confirmed account switch uses the dedicated intent-bound endpoint", async ({ page }) => {
  await authenticated(page);
  await interceptGithubDestination(page);
  await page.route("**/api/v1/github/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connected) }));
  let switchCsrf: string | undefined;
  await page.route("**/api/v1/github/switch", async (route) => {
    switchCsrf = route.request().headers()["x-csrf-token"];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorizationUrl: "https://github.com/login/oauth/authorize?client_id=trace&state=switch" }) });
  });

  await page.goto("/github");
  await page.getByRole("button", { name: "Switch GitHub account" }).click();
  await expect(page.getByRole("dialog", { name: "Switch GitHub account?" })).toContainText("stop tracking repositories from @alice-dev");
  await page.getByRole("button", { name: "Confirm account switch" }).click();

  await expect(page).toHaveURL(/^https:\/\/github\.com\//);
  expect(switchCsrf).toBe("csrf_opaque_value");
});

test("connect uses the backend github.com URL and callback errors remain closed", async ({ page }) => {
  await authenticated(page);
  await interceptGithubDestination(page);
  await page.route("**/api/v1/github/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    accountConnection: { status: "DISCONNECTED", account: null },
    installationAuthorization: { status: "NOT_INSTALLED", installation: null },
    accessibleRepositoryCount: 0,
    trackedRepositoryCount: 0,
    historyRetained: true,
  }) }));
  await page.route("**/api/v1/github/connect", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorizationUrl: "https://github.com/login/oauth/authorize?client_id=trace&state=opaque" }) }));

  await page.goto("/github?result=error&reason=callback_failed&provider_secret=never-render");
  await expect(page.locator(".github-notice[role='alert']")).toContainText("GitHub could not complete the connection");
  await expect(page.getByText("never-render")).toHaveCount(0);
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page).toHaveURL(/^https:\/\/github\.com\//);
});

test("connected account can start or repair GitHub App installation", async ({ page }) => {
  await authenticated(page);
  await interceptGithubDestination(page);
  await page.route("**/api/v1/github/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    ...connected,
    installationAuthorization: { status: "NOT_INSTALLED", installation: null },
    accessibleRepositoryCount: 0,
    trackedRepositoryCount: 0,
  }) }));
  await page.route("**/api/v1/github/installation", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    installationUrl: "https://github.com/apps/trace/installations/new?state=opaque",
  }) }));

  await page.goto("/github");
  await page.getByRole("button", { name: "Install GitHub App" }).click();
  await expect(page).toHaveURL(/^https:\/\/github\.com\/apps\/trace\/installations\/new/);
});
