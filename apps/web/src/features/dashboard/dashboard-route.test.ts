import { describe, expect, it } from "vitest";
import { dateInTimezone } from "./dashboard-route";

describe("Dashboard route date defaults", () => {
  it("uses the current calendar day in the requested timezone", () => {
    const now = new Date("2026-08-13T01:30:00.000Z");
    expect(dateInTimezone(now, "UTC")).toBe("2026-08-13");
    expect(dateInTimezone(now, "America/Los_Angeles")).toBe("2026-08-12");
    expect(dateInTimezone(now, "Asia/Karachi")).toBe("2026-08-13");
  });

  it("falls back to UTC when the requested timezone is invalid", () => {
    expect(dateInTimezone(new Date("2026-08-13T00:30:00.000Z"), "Not/AZone")).toBe("2026-08-13");
  });
});
