import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const demoNote = "No API, GitHub account, database, queue, or worker is connected.";

async function expectAccessible(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }" });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations, accessibility.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

test("credential-free mock mode serves the implemented workspace", async ({ page }) => {
    await page.goto("/dashboard");
    const disclosure = page.getByRole("note").filter({ hasText: "Demo data" });
    await expect(disclosure).toContainText("Demo data");
    await expect(disclosure).toContainText(demoNote);
    await expect(page.getByRole("heading", { name: "Development dashboard" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Development activity metrics" })).toContainText("120");
    await expectAccessible(page);

    const blockedApis = await page.evaluate(async () => {
      const requests: Array<[string, RequestInit | undefined]> = [
        ["http://localhost:3001/api/v1/not-a-real-operation", undefined],
        ["http://localhost:3001/api/v1/repositories/repo_02/tracking", { method: "PATCH", headers: { "x-csrf-token": "csrf-demo-only" } }],
        ["http://localhost:3001/api/v1/github/connect", { method: "POST", headers: { "x-csrf-token": "csrf-demo-only" } }],
      ];
      return Promise.all(requests.map(async ([url, init]) => {
        const response = await fetch(url, init);
        return { status: response.status, body: await response.json() };
      }));
    });
    expect(blockedApis).toHaveLength(3);
    for (const blocked of blockedApis) expect(blocked).toEqual({ status: 501, body: { code: "MOCK_API_UNHANDLED", message: "This API operation is not available in demo mode.", requestId: "mock-request" } });

    await page.goto("/repositories");
    const repositorySummary = page.locator(".repository-summary");
    await expect(repositorySummary).toContainText("2");
    await expect(repositorySummary).toContainText("repositories loaded");
    await page.getByRole("button", { name: "Track trace-demo-org/docs" }).click();
    await expect(page.getByRole("button", { name: "Stop tracking trace-demo-org/docs" })).toBeVisible();
    await expectAccessible(page);

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(page.getByText("Refine activity timeline")).toBeVisible();
    await expectAccessible(page);

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Report date").fill("2026-08-17");
    await page.getByRole("button", { name: "Create report" }).click();
    await expect(page.getByRole("status")).toContainText("Report requested for August 17, 2026");

    await page.goto("/reports/report-completed");
    await expect(page.getByLabel("Executive summary")).toBeVisible();
    await page.getByLabel("Executive summary").fill("Updated demo summary.");
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect(page.getByText("Revision 2 · Manually edited")).toBeVisible();
    await expect(page.getByLabel("Executive summary")).toHaveValue("Updated demo summary.");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("trace-demo-report.pdf");
    await page.getByRole("button", { name: "Regenerate report" }).click();
    await expect(page.getByText("Building your report")).toBeVisible();
    await expectAccessible(page);

    await page.goto("/github");
    await expect(page).toHaveURL(/\/github$/);
    await expect(page.getByRole("heading", { name: "GitHub", level: 1, exact: true })).toBeVisible();
    await expect(page.getByText("@trace-demo", { exact: true })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "External GitHub authorization is unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch GitHub account" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Manage repository access" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Disconnect GitHub" })).toBeEnabled();
    await expectAccessible(page);
  });
