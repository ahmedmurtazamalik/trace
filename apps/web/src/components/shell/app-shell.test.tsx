import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("cancels same-app navigation when report edits are unsaved and discarding is declined", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppShell><h1>Report editor</h1></AppShell>);
    act(() => window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: true } })));

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(screen.getAllByRole("link", { name: "Dashboard" })[0]?.dispatchEvent(click)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("restores browser history when the Navigation API is unavailable and discarding is declined", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    render(<AppShell><h1>Report editor</h1></AppShell>);
    act(() => window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: true } })));

    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: { __traceUnsavedNavigationPoint: -1 } })));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(1);
    go.mockRestore();
    confirm.mockRestore();
  });

  it("restores the exact fallback history distance after a multi-entry traversal is declined", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    render(<AppShell><h1>Report editor</h1></AppShell>);
    window.history.pushState({}, "", "#one");
    window.history.pushState({}, "", "#two");
    window.history.pushState({}, "", "#three");
    const currentPoint = window.history.state.__traceUnsavedNavigationPoint as number;
    act(() => window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: true } })));

    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: { __traceUnsavedNavigationPoint: currentPoint - 2 } })));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(2);
    go.mockRestore();
    confirm.mockRestore();
  });

  it("recreates the dirty report entry when a declined fallback traversal reaches unmarked history", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const pushState = vi.spyOn(window.history, "pushState");
    render(<AppShell><h1>Report editor</h1></AppShell>);
    pushState.mockClear();
    act(() => window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: true } })));

    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: {} })));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]?.[2]).toBe(window.location.href);
    pushState.mockRestore();
    confirm.mockRestore();
  });
});
