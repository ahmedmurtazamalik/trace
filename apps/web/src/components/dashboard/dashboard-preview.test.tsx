import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPreview } from "./dashboard-preview";

describe("DashboardPreview visual hierarchy", () => {
  it("assigns a distinct semantic accent to every metric", () => {
    const { container } = render(<DashboardPreview />);
    const metrics = Array.from(container.querySelectorAll("[data-accent]"));
    expect(metrics).toHaveLength(4);
    expect(new Set(metrics.map((metric) => metric.getAttribute("data-accent"))).size).toBe(4);
  });
});
