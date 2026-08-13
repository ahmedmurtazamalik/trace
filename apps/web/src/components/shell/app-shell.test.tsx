import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("provides accessible navigation and an environment-aware disclosure", () => {
    render(<AppShell><h1>Dashboard</h1></AppShell>);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    expect(screen.getAllByRole("navigation").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByText(/environment-aware data/i)).toBeInTheDocument();
    for (const name of ["Dashboard", "Repositories", "Activity", "Reports", "GitHub", "Settings"]) expect(screen.getAllByRole("link", { name }).length).toBeGreaterThan(0);
  });

  it("makes the skip link the first keyboard destination", async () => {
    const user = userEvent.setup();
    render(<AppShell><h1>Dashboard</h1></AppShell>);
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });

  it("keeps ambient brand visuals hidden from assistive technology", () => {
    render(<AppShell><h1>Dashboard</h1></AppShell>);
    expect(screen.getByTestId("ambient-grid")).toHaveAttribute("aria-hidden", "true");
  });
});
