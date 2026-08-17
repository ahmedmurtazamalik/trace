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
});
