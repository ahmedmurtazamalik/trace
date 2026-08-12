import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageShell } from "./page-shell";

describe("PageShell", () => {
  it("labels future functionality without presenting inert actions", () => {
    render(<PageShell title="Reports" eyebrow="Workspace" description="Create a daily work narrative." upcoming="Report generation starts on Day 8." />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByText("Report generation starts on Day 8.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
