import { afterEach, describe, expect, it, vi } from "vitest";
import { activityFixturePages } from "@/mocks/fixtures/activity";
import { ActivityApiError, listActivity, listRepositoryActivity } from "./activity";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("activity API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps validated filters to the real activity endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activityFixturePages.first));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(listActivity({ date: "2026-08-12", timezone: "UTC", repositoryId: "repo-01", source: "github", type: "commit", limit: 25 }, { signal: controller.signal })).resolves.toEqual(activityFixturePages.first);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/activity?date=2026-08-12&timezone=UTC&repositoryId=repo-01&source=github&type=commit&limit=25",
      expect.objectContaining({ method: "GET", credentials: "include", signal: controller.signal }),
    );
  });

  it("loads repository activity with an encoded ID and stable cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activityFixturePages.second));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRepositoryActivity("repo/id", { timezone: "UTC", cursor: "activity-page-2", limit: 25 })).resolves.toEqual(activityFixturePages.second);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3001/api/v1/repositories/repo%2Fid/activity?timezone=UTC&cursor=activity-page-2&limit=25");
  });

  it("rejects invalid success payloads and exposes safe session expiry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: "broken" }], pageInfo: {} }))
      .mockResolvedValueOnce(jsonResponse({ code: "UNAUTHENTICATED", message: "raw detail", requestId: "request-1" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listActivity({ timezone: "UTC" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(listActivity({ timezone: "UTC" })).rejects.toEqual(expect.objectContaining<Partial<ActivityApiError>>({
      code: "UNAUTHENTICATED",
      message: "Your session has expired. Please sign in again.",
      status: 401,
    }));
  });

  it("preserves cancellation rather than converting it to a network error", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(listActivity({ timezone: "UTC" })).rejects.toBe(abort);
  });
});
