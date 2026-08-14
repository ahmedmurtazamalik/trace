import { expect, test, type Page } from "@playwright/test";

const session = { user: { id: "usr_01HXYZ", username: "alice.dev", displayName: "Alice Developer", email: "alice@example.com", createdAt: "2026-08-11T12:00:00.000Z" }, csrfToken: "csrf_opaque_value" };
const items = [
  { id: "repo_01", owner: "trace-fixture-org", name: "trace", fullName: "trace-fixture-org/trace", private: true, defaultBranch: "main", url: "https://github.com/trace-fixture-org/trace", accessible: true, trackingEnabled: false, lastActivityAt: "2026-08-12T09:30:00.000Z", contributorCount: 3 },
  { id: "repo_02", owner: "archive-fixture-org", name: "legacy-api", fullName: "archive-fixture-org/legacy-api", private: false, defaultBranch: "trunk", url: null, accessible: false, trackingEnabled: true, lastActivityAt: null, contributorCount: 0 },
];

async function authenticated(page: Page) {
  const repositories = items.map((item) => ({ ...item }));
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/v1/repositories**", async (route) => {
    const request = route.request();
    const corsHeaders = { "access-control-allow-origin": "http://127.0.0.1:3100", "access-control-allow-credentials": "true", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "x-csrf-token, content-type" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders });
    const url = new URL(request.url());
    const segments = url.pathname.split("/");
    const tracking = segments.at(-1) === "tracking" && segments.at(-2)?.startsWith("repo_") ? segments.at(-2) : undefined;
    if (tracking !== undefined) {
      const enabled = request.method() === "POST";
      const repository = repositories.find((item) => item.id === tracking);
      if (repository) repository.trackingEnabled = enabled;
      return route.fulfill({ status: 200, headers: corsHeaders, contentType: "application/json", body: JSON.stringify({ repositoryId: tracking, trackingEnabled: enabled }) });
    }
    if (url.pathname.endsWith("/sync")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accessibleRepositoryCount: 1 }) });
    const detailId = segments.at(-1)?.startsWith("repo_") ? segments.at(-1) : undefined;
    if (detailId !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ repository: repositories.find((item) => item.id === detailId) }) });
    const search = url.searchParams.get("search")?.toLowerCase();
    const filtered = search ? repositories.filter((item) => item.fullName.toLowerCase().includes(search)) : repositories;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: filtered, pageInfo: { nextCursor: null, hasNextPage: false } }) });
  });
  await page.route("**/api/v1/repositories/repo_01", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ repository: repositories[0] }) }));
}

test("repository access and Trace tracking use live API contracts on desktop and mobile", async ({ page }) => {
  await authenticated(page);
  await page.goto("/repositories");
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  await expect(page.getByText("Add repositories through GitHub")).toBeVisible();
  await expect(page.getByRole("link", { name: "trace-fixture-org/trace" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search repositories" });
  await search.fill("legacy");
  await expect(page).toHaveURL(/search=legacy/);
  await expect(page.getByRole("link", { name: "archive-fixture-org/legacy-api" })).toBeVisible();
  await expect(page.getByText("Historical access only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" })).toBeEnabled();
  const trackingRequest = page.waitForRequest((request) => request.method() === "DELETE" && request.url().endsWith("/api/v1/repositories/repo_02/tracking"));
  await page.getByRole("button", { name: "Stop tracking archive-fixture-org/legacy-api" }).click();
  const trackingHeaders = await (await trackingRequest).allHeaders();
  expect(trackingHeaders["x-csrf-token"]).toBe(session.csrfToken);
  expect((await trackingRequest).postData()).toBeNull();
  await search.fill("");
  await expect(page.getByRole("link", { name: "trace-fixture-org/trace" })).toBeVisible();
  await page.getByRole("link", { name: "trace-fixture-org/trace" }).click();
  await expect(page).toHaveURL(/\/repositories\/repo_01$/);
  await expect(page.getByRole("heading", { name: "trace-fixture-org/trace" })).toBeVisible();
});
