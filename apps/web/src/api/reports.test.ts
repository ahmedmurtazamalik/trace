import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createReport, getReport, updateReportRevision } from "./reports";

const base = {
  id: "report-poll", reportDate: "2026-08-13", timezone: "UTC", createdAt: "2026-08-13T08:00:00.000Z",
  facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 5, additions: 40, deletions: 8 },
};
let calls = 0;
const server = setupServer(http.get("http://localhost:3001/api/v1/reports/report-poll", () => {
  calls += 1;
  if (calls === 1) return HttpResponse.json({ report: { ...base, status: "processing", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false, revisionSource: null, content: null, artifacts: [] } });
  return HttpResponse.json({ report: { ...base, status: "completed", completedAt: "2026-08-13T08:02:00.000Z", errorMessage: null, revision: 1, downloadAvailable: true, revisionSource: "ai", content: { executiveSummary: "Development activity was summarized.", repositories: [] }, artifacts: [{ id: "pdf-1", revision: 1, kind: "pdf", fileName: "trace-report.pdf", contentType: "application/pdf", sizeBytes: 1000, checksum: "a".repeat(64) }] } });
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); calls = 0; });
afterAll(() => server.close());

describe("report API status polling seam", () => {
  it("validates processing to completed transitions through MSW", async () => {
    await expect(getReport("report-poll")).resolves.toMatchObject({ report: { status: "processing", downloadAvailable: false } });
    await expect(getReport("report-poll")).resolves.toMatchObject({ report: { status: "completed", downloadAvailable: true } });
  });

  it("requires and sends CSRF for report creation", async () => {
    let csrf: string | null = null;
    server.use(http.post("http://localhost:3001/api/v1/reports", async ({ request }) => {
      csrf = request.headers.get("x-csrf-token");
      return HttpResponse.json({ report: { id: "report-new", reportDate: "2026-08-13", timezone: "UTC", status: "pending", createdAt: "2026-08-13T08:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false } });
    }));
    await expect(createReport({ reportDate: "2026-08-13", timezone: "UTC" }, "csrf-live")).resolves.toMatchObject({ report: { status: "pending" } });
    expect(csrf).toBe("csrf-live");
  });

  it("requires CSRF, validates the structured patch, and preserves revision conflict codes", async () => {
    let csrf: string | null = null;
    let body: unknown;
    server.use(http.put("http://localhost:3001/api/v1/reports/report-poll/revision", async ({ request }) => {
      csrf = request.headers.get("x-csrf-token");
      body = await request.json();
      return HttpResponse.json({ report: { ...base, status: "completed", completedAt: "2026-08-13T08:02:00.000Z", errorMessage: null, revision: 2, downloadAvailable: true, revisionSource: "manual", content: { executiveSummary: "Edited summary.", repositories: [] }, artifacts: [{ id: "pdf-2", revision: 2, kind: "pdf", fileName: "trace-report.pdf", contentType: "application/pdf", sizeBytes: 1000, checksum: "b".repeat(64) }] } });
    }));
    await expect(updateReportRevision("report-poll", { expectedRevision: 1, prosePatch: { executiveSummary: "Edited summary." } }, "csrf-edit")).resolves.toMatchObject({ report: { revision: 2, revisionSource: "manual" } });
    expect(csrf).toBe("csrf-edit");
    expect(body).toEqual({ expectedRevision: 1, prosePatch: { executiveSummary: "Edited summary." } });

    server.use(http.put("http://localhost:3001/api/v1/reports/report-poll/revision", () => HttpResponse.json({ report: { ...base, status: "completed", revision: 2 } })));
    await expect(updateReportRevision("report-poll", { expectedRevision: 1, prosePatch: { executiveSummary: "Edited summary." } }, "csrf-edit")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    server.use(http.put("http://localhost:3001/api/v1/reports/report-poll/revision", () => HttpResponse.json({ code: "REPORT_REVISION_CONFLICT", message: "stale", requestId: "req-conflict" }, { status: 409 })));
    await expect(updateReportRevision("report-poll", { expectedRevision: 1, prosePatch: { executiveSummary: "Edited summary." } }, "csrf-edit")).rejects.toMatchObject({ code: "REPORT_REVISION_CONFLICT", status: 409 });

    server.use(http.put("http://localhost:3001/api/v1/reports/report-poll/revision", () => HttpResponse.json({ code: "NOT_FOUND", message: "Cannot PUT route", requestId: "req-missing" }, { status: 404 })));
    await expect(updateReportRevision("report-poll", { expectedRevision: 1, prosePatch: { executiveSummary: "Edited summary." } }, "csrf-edit")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects malformed completed responses", async () => {
    server.use(http.get("http://localhost:3001/api/v1/reports/report-poll", () => HttpResponse.json({ report: { ...base, status: "completed", downloadAvailable: true } })));
    await expect(getReport("report-poll")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
