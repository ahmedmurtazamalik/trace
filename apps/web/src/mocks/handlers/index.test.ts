import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  activityListResponseSchema,
  authSessionResponseSchema,
  dashboardResponseSchema,
  githubConnectionStatusSchema,
  githubDisconnectResponseSchema,
  logoutResponseSchema,
  repositoryDetailResponseSchema,
  repositoryListResponseSchema,
  repositoryMembershipResponseSchema,
  repositorySynchronizationResponseSchema,
  repositoryTrackingResponseSchema,
  reportCreateResponseSchema,
  reportDetailResponseSchema,
  reportListResponseSchema,
  reportRegenerationResponseSchema,
  reportRevisionUpdateResponseSchema,
} from "@trace/shared";
import { handlers } from "./index";

const server = setupServer(
  ...handlers,
  http.all("*", () => HttpResponse.json({ code: "UNMOCKED" }, { status: 501 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("browser mock-mode handlers", () => {
  it("boots an authenticated session without external credentials", async () => {
    const response = await fetch("http://localhost:3001/api/v1/auth/me");
    expect(response.status).toBe(200);
    expect(authSessionResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("serves contract-valid dashboard data", async () => {
    const response = await fetch("http://localhost:3001/api/v1/dashboard?date=2026-08-17&timezone=UTC");
    expect(response.status).toBe(200);
    expect(dashboardResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each([
    ["GitHub status", "/api/v1/github/status", githubConnectionStatusSchema],
    ["repositories", "/api/v1/repositories", repositoryListResponseSchema],
    ["repository detail", "/api/v1/repositories/repo_01", repositoryDetailResponseSchema],
    ["activity", "/api/v1/activity?date=2026-08-17&timezone=UTC", activityListResponseSchema],
    ["reports", "/api/v1/reports?limit=20", reportListResponseSchema],
    ["report detail", "/api/v1/reports/report-completed", reportDetailResponseSchema],
  ])("serves contract-valid %s data", async (_label, path, schema) => {
    const response = await fetch(`http://localhost:3001${path}`);
    expect(response.status).toBe(200);
    expect(schema.safeParse(await response.json()).success).toBe(true);
  });

  it.each([
    ["repository sync", "/api/v1/repositories/sync", { method: "POST" }, repositorySynchronizationResponseSchema],
    ["repository tracking", "/api/v1/repositories/repo_02/tracking", { method: "POST" }, repositoryTrackingResponseSchema],
    ["repository removal", "/api/v1/repositories/repo_02", { method: "DELETE" }, repositoryMembershipResponseSchema],
    ["repository restoration", "/api/v1/repositories/repo_02/restore", { method: "POST" }, repositoryMembershipResponseSchema],
    ["GitHub disconnect", "/api/v1/github/connection", { method: "DELETE" }, githubDisconnectResponseSchema],
    ["report creation", "/api/v1/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportDate: "2026-08-17", timezone: "UTC" }) }, reportCreateResponseSchema],
  ])("serves a contract-valid %s response", async (_label, path, init, schema) => {
    const requestInit: RequestInit = init;
    const response = await fetch(`http://localhost:3001${path}`, {
      ...requestInit,
      headers: { ...Object.fromEntries(new Headers(requestInit.headers)), "x-csrf-token": "csrf-demo-only" },
    });
    expect(response.status).toBe(200);
    expect(schema.safeParse(await response.json()).success).toBe(true);
  });

  it("mocks the reachable logout operation", async () => {
    const response = await fetch("http://localhost:3001/api/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": "csrf-demo-only" } });
    expect(response.status).toBe(200);
    expect(logoutResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each([
    ["GET tracking", "/api/v1/repositories/repo_02/tracking", "GET"],
    ["PUT tracking", "/api/v1/repositories/repo_02/tracking", "PUT"],
    ["PATCH tracking", "/api/v1/repositories/repo_02/tracking", "PATCH"],
    ["GitHub connect", "/api/v1/github/connect", "POST"],
    ["GitHub switch", "/api/v1/github/switch", "POST"],
    ["GitHub installation", "/api/v1/github/installation", "POST"],
  ])("fails closed for unsupported %s", async (_label, path, method) => {
    const response = await fetch(`http://localhost:3001${path}`, { method, headers: { "x-csrf-token": "csrf-demo-only" } });
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ code: "MOCK_API_UNHANDLED" });
  });

  it("rejects a protected mutation without the demo CSRF token", async () => {
    const response = await fetch("http://localhost:3001/api/v1/github/connection", { method: "DELETE" });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_INVALID" });
  });

  it("fails closed for every otherwise-unhandled API request", async () => {
    const response = await fetch("http://localhost:3001/api/v1/not-a-real-operation");
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ code: "MOCK_API_UNHANDLED" });
  });

  it("persists create, edit, regenerate, and download report behavior coherently", async () => {
    const createResponse = await fetch("http://localhost:3001/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-demo-only" },
      body: JSON.stringify({ reportDate: "2026-08-17", timezone: "UTC" }),
    });
    const created = reportCreateResponseSchema.parse(await createResponse.json());

    const createdDetailResponse = await fetch(`http://localhost:3001/api/v1/reports/${created.report.id}`);
    expect(createdDetailResponse.status).toBe(200);
    const createdDetail = reportDetailResponseSchema.parse(await createdDetailResponse.json());
    expect(createdDetail.report.id).toBe(created.report.id);

    const listResponse = await fetch("http://localhost:3001/api/v1/reports?limit=20");
    const list = reportListResponseSchema.parse(await listResponse.json());
    expect(list.items.some((report) => report.id === created.report.id)).toBe(true);

    const updateResponse = await fetch("http://localhost:3001/api/v1/reports/report-completed/revision", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-demo-only" },
      body: JSON.stringify({ expectedRevision: 1, prosePatch: { executiveSummary: "Updated demo summary." } }),
    });
    const updated = reportRevisionUpdateResponseSchema.parse(await updateResponse.json());
    expect(updated.report.revision).toBe(2);
    expect(updated.report.revisionSource).toBe("manual");
    expect(updated.report.content?.executiveSummary).toBe("Updated demo summary.");

    const artifact = updated.report.artifacts.find((candidate) => candidate.kind === "pdf");
    expect(artifact).toBeDefined();
    const download = await fetch(`http://localhost:3001/api/v1/reports/report-completed/download?artifactId=${artifact?.id}`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(download.status).toBe(200);
    expect(bytes.byteLength).toBe(artifact?.sizeBytes);
    expect(checksum).toBe(artifact?.checksum);

    const regenerateResponse = await fetch("http://localhost:3001/api/v1/reports/report-completed/regenerate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-demo-only" },
      body: JSON.stringify({ expectedRevision: 2 }),
    });
    const regenerated = reportRegenerationResponseSchema.parse(await regenerateResponse.json());
    expect(regenerated.report.status).toBe("processing");
    expect(regenerated.report.downloadAvailable).toBe(false);
  });
});
