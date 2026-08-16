import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createReport, downloadReportArtifact, getReport, regenerateReport, updateReportRevision } from "./reports";

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

  it("preserves safe rate-limit outcomes for create and revision mutations", async () => {
    server.use(
      http.post("http://localhost:3001/api/v1/reports", () => HttpResponse.json({ code: "RATE_LIMITED", message: "raw limiter detail", requestId: "req-create-limit" }, { status: 429 })),
      http.put("http://localhost:3001/api/v1/reports/report-poll/revision", () => HttpResponse.json({ code: "RATE_LIMITED", message: "raw limiter detail", requestId: "req-revision-limit" }, { status: 429 })),
    );

    await expect(createReport({ reportDate: "2026-08-13", timezone: "UTC" }, "csrf-live")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many report requests. Please wait and try again.",
      status: 429,
      requestId: "req-create-limit",
    });
    await expect(updateReportRevision("report-poll", { expectedRevision: 1, prosePatch: { executiveSummary: "Edited summary." } }, "csrf-live")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many report requests. Please wait and try again.",
      status: 429,
      requestId: "req-revision-limit",
    });
  });

  it("preserves permanent CSRF failures for report mutations", async () => {
    server.use(http.post("http://localhost:3001/api/v1/reports", () => HttpResponse.json(
      { code: "CSRF_INVALID", message: "raw guard detail", requestId: "req-csrf" },
      { status: 403 },
    )));

    await expect(createReport({ reportDate: "2026-08-13", timezone: "UTC" }, "stale-csrf")).rejects.toMatchObject({
      code: "CSRF_INVALID",
      message: "Your security session has expired. Refresh the page and sign in again if needed.",
      status: 403,
      requestId: "req-csrf",
    });
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

  it("requires CSRF and the current revision when regenerating", async () => {
    let csrf: string | null = null;
    let body: unknown;
    server.use(http.post("http://localhost:3001/api/v1/reports/report-poll/regenerate", async ({ request }) => {
      csrf = request.headers.get("x-csrf-token");
      body = await request.json();
      return HttpResponse.json({ report: { ...base, status: "processing", completedAt: null, errorMessage: null, revision: 1, downloadAvailable: false, revisionSource: "manual", content: { executiveSummary: "Edited summary remains authoritative.", repositories: [] }, artifacts: [] } });
    }));

    await expect(regenerateReport("report-poll", { expectedRevision: 1 }, "csrf-regenerate")).resolves.toMatchObject({ report: { status: "processing", revision: 1, revisionSource: "manual" } });
    expect(csrf).toBe("csrf-regenerate");
    expect(body).toEqual({ expectedRevision: 1 });
  });

  it("downloads only bytes matching frozen artifact metadata and ignores response filenames", async () => {
    const bytes = new TextEncoder().encode("%PDF");
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const artifact = { id: "pdf_safe-1", revision: 1, kind: "pdf" as const, fileName: "trace-report.pdf", contentType: "application/pdf" as const, sizeBytes: bytes.byteLength, checksum };
    let requestedArtifact: string | null = null;
    server.use(http.get("http://localhost:3001/api/v1/reports/report-poll/download", ({ request }) => {
      requestedArtifact = new URL(request.url).searchParams.get("artifactId");
      return new HttpResponse(bytes, { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=../../unsafe.pdf" } });
    }));

    const downloaded = await downloadReportArtifact("report-poll", artifact);
    expect(requestedArtifact).toBe("pdf_safe-1");
    expect(downloaded.fileName).toBe("trace-report.pdf");
    expect(downloaded.blob).toMatchObject({ size: bytes.byteLength, type: "application/pdf" });

    server.use(http.get("http://localhost:3001/api/v1/reports/report-poll/download", () => new HttpResponse(new TextEncoder().encode("FAKE"), { headers: { "content-type": "application/pdf" } })));
    await expect(downloadReportArtifact("report-poll", artifact)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed completed responses", async () => {
    server.use(http.get("http://localhost:3001/api/v1/reports/report-poll", () => HttpResponse.json({ report: { ...base, status: "completed", downloadAvailable: true } })));
    await expect(getReport("report-poll")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
