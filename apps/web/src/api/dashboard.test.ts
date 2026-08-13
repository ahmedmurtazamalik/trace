import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";
import { DashboardApiError, getDashboard } from "./dashboard";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("dashboard API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps a validated dashboard query to the production endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(dashboardFixtures.ready));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getDashboard({ date: "2026-08-12", timezone: "UTC", repositoryId: "repo_1" }, { signal: controller.signal })).resolves.toEqual(dashboardFixtures.ready);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/dashboard?date=2026-08-12&timezone=UTC&repositoryId=repo_1",
      expect.objectContaining({ method: "GET", credentials: "include", signal: controller.signal }),
    );
  });

  it("rejects invalid responses and maps authorization errors safely", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: "READY" }))
      .mockResolvedValueOnce(jsonResponse({ code: "UNAUTHENTICATED", message: "raw detail", requestId: "request-2" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDashboard({ date: "2026-08-12", timezone: "UTC" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getDashboard({ date: "2026-08-12", timezone: "UTC" })).rejects.toEqual(expect.objectContaining<Partial<DashboardApiError>>({
      code: "UNAUTHENTICATED",
      message: "Your session has expired. Please sign in again.",
      status: 401,
    }));
  });
});
