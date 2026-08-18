import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RouteErrorState } from "./route-error-state";

describe("RouteErrorState", () => {
  it("announces and focuses a safe recovery message without exposing internal error details", async () => {
    const reset = vi.fn();
    render(<RouteErrorState reset={reset} error={new Error("database password=secret") as Error & { digest?: string }} />);

    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Trace could not load this view." })).toBeInTheDocument();
    expect(screen.queryByText(/password=secret/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("hard reloads a stale client bundle without retrying the stale tree or exposing details", async () => {
    const reset = vi.fn();
    const reload = vi.fn();
    const error = Object.assign(new Error("Loading chunk 842 failed with private URL details"), { name: "ChunkLoadError" });
    const props = { reset, reload, error } as unknown as React.ComponentProps<typeof RouteErrorState>;

    render(<RouteErrorState {...props} />);

    expect(screen.queryByText(/private URL details/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });
});
