import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MockModeProvider } from "./mock-mode-provider";

describe("MockModeProvider", () => {
  it("renders immediately without starting MSW in live mode", () => {
    const startBrowserMocks = vi.fn();
    render(<MockModeProvider enabled={false} startBrowserMocks={startBrowserMocks}><p>Workspace</p></MockModeProvider>);
    expect(screen.getByText("Workspace")).toBeVisible();
    expect(startBrowserMocks).not.toHaveBeenCalled();
  });

  it("holds application requests until browser MSW is ready", async () => {
    let release: (() => void) | undefined;
    const startBrowserMocks = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<MockModeProvider enabled startBrowserMocks={startBrowserMocks}><p>Workspace</p></MockModeProvider>);

    expect(startBrowserMocks).toHaveBeenCalledOnce();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Starting credential-free demo…");

    release?.();
    await waitFor(() => expect(screen.getByText("Workspace")).toBeVisible());
    expect(screen.getByRole("note")).toHaveTextContent("Demo data");
    expect(screen.getByRole("note")).toHaveTextContent("No API, GitHub account, database, queue, or worker is connected");
  });
});
