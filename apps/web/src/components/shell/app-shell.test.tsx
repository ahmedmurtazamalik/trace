import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("provides accessible navigation without an integration-placeholder disclosure", () => {
    render(<AppShell><h1>Dashboard</h1></AppShell>);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    expect(screen.getAllByRole("navigation").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.queryByRole("region", { name: "Environment disclosure" })).not.toBeInTheDocument();
    expect(screen.queryByText(/environment-aware data/i)).not.toBeInTheDocument();
    for (const name of ["Dashboard", "Repositories", "Workspaces", "Activity", "Reports", "GitHub", "Settings"]) expect(screen.getAllByRole("link", { name }).length).toBeGreaterThan(0);
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

  it("persists a terminal night mode and exposes an accessible toggle", async () => {
    window.localStorage.setItem("trace-theme", "night");
    const user = userEvent.setup();
    render(<AppShell><h1>Dashboard</h1></AppShell>);

    const toggle = await screen.findByRole("button", { name: "Use light mode" });
    expect(document.documentElement).toHaveAttribute("data-theme", "night");
    await user.click(toggle);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("trace-theme")).toBe("light");
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

  it("does not disarm the current dirty editor for modified clicks that open another context", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AppShell><h1>Report editor</h1></AppShell>);
    act(() => window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: true } })));
    const dashboard = screen.getAllByRole("link", { name: "Dashboard" })[0];

    dashboard?.addEventListener("click", (event) => event.preventDefault(), { once: true });
    dashboard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(confirm).not.toHaveBeenCalled();

    dashboard?.addEventListener("click", (event) => event.preventDefault(), { once: true });
    dashboard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
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

  it("does not bypass a later traversal when the compensating popstate never arrives", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    render(<AppShell><h1>Report editor</h1></AppShell>);
    window.history.pushState({}, "", "#source");
    const currentPoint = window.history.state.__traceUnsavedNavigationPoint as number;
    act(() => window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: true } })));

    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: { __traceUnsavedNavigationPoint: currentPoint - 1 } })));
    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: { __traceUnsavedNavigationPoint: currentPoint + 1 } })));

    expect(confirm).toHaveBeenCalledTimes(2);
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
