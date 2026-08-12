import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Label, Skeleton, Table } from "./index";

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
});
