import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Label, Skeleton, Table } from "./index";

describe("Trace UI primitives", () => {
  it("exposes accessible form and feedback primitives", () => {
    render(<><Label htmlFor="repo">Repository</Label><Input id="repo" /><Button>Track</Button><Badge>Mock data</Badge><Skeleton aria-label="Loading activity" /><EmptyState title="No activity" description="Connect a source to begin." /><ErrorState title="Could not load" description="Try again." /></>);
    expect(screen.getByLabelText("Repository")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Track" })).toBeEnabled();
    expect(screen.getByText("Mock data")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading activity")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No activity");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
  });

  it("renders structured content primitives", () => {
    render(<Card><Table><thead><tr><th>Repository</th></tr></thead><tbody><tr><td>trace/web</td></tr></tbody></Table></Card>);
    expect(screen.getByRole("table", { name: "Data table" })).toBeInTheDocument();
    expect(screen.getByText("trace/web")).toBeInTheDocument();
  });

  it("gives simultaneous dialogs independent accessible names", () => {
    render(<>
      <Dialog open title="Remove repository" onClose={vi.fn()} />
      <Dialog open title="Disconnect GitHub" onClose={vi.fn()} />
    </>);

    expect(screen.getByRole("dialog", { name: "Remove repository" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Disconnect GitHub" })).toBeInTheDocument();
  });

  it("closes an open dialog with Escape", () => {
    const onClose = vi.fn();
    render(<Dialog open title="Confirm action" onClose={onClose} />);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes only the focused topmost dialog with Escape", () => {
    const closeLowerDialog = vi.fn();
    const closeTopDialog = vi.fn();
    render(<>
      <Dialog open title="Lower dialog" onClose={closeLowerDialog} />
      <Dialog open title="Top dialog" onClose={closeTopDialog} />
    </>);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(closeTopDialog).toHaveBeenCalledOnce();
    expect(closeLowerDialog).not.toHaveBeenCalled();
  });
});
