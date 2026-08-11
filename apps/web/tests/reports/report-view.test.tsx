// @vitest-environment jsdom
import { demoReport } from "@trace/fixtures/reports/demo";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ReportStatePanel,
  ReportView,
} from "../../components/reports/report-view";

describe("ReportView", () => {
  it("renders lifecycle, attribution, repository, and expandable evidence", () => {
    render(<ReportView report={demoReport} />);

    expect(
      screen.getByRole("heading", { name: "Weekly engineering evidence" }),
    ).toBeTruthy();
    expect(screen.getByText("Work in progress")).toBeTruthy();
    expect(screen.getByText("Committed locally")).toBeTruthy();
    expect(screen.getByText("Pushed to GitHub")).toBeTruthy();
    expect(screen.getByText("Merged")).toBeTruthy();
    expect(screen.getByText("ahmedmurtazamalik/trace")).toBeTruthy();
    expect(
      screen.getByText("Pushed by alimajid266 · authored by Ali"),
    ).toBeTruthy();
    expect(screen.getAllByText("View evidence")).toHaveLength(4);
  });

  it("shows clear generating, empty, and error states", () => {
    const view = render(<ReportStatePanel state="generating" />);
    expect(screen.getByText("Generating your report")).toBeTruthy();

    view.rerender(<ReportStatePanel state="empty" />);
    expect(screen.getByText("No activity matched this scope")).toBeTruthy();

    view.rerender(<ReportStatePanel state="error" />);
    expect(screen.getByText("Report generation paused")).toBeTruthy();
  });
});
