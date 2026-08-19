// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const appShell = readFileSync(resolve(process.cwd(), "src/components/shell/app-shell.tsx"), "utf8");
const githubPanel = readFileSync(resolve(process.cwd(), "src/features/github/github-connection-panel.tsx"), "utf8");

describe("Editorial Console visual system", () => {
  it("uses the approved Preview 3 palette, square surfaces, and offset depth", () => {
    expect(css).toContain("/* Editorial Console: selected preview 03 */");
    expect(css).toContain("--canvas: #eef0e9;");
    expect(css).toContain("--signal: #166c45;");
    expect(css).toContain("--editorial-sidebar: #e6e9e2;");
    expect(css).toContain("box-shadow: 3px 3px 0 var(--line-strong);");
    expect(css).toContain("border-radius: 0;");
  });

  it("adds the terminal night palette and keeps action buttons green", () => {
    expect(css).toContain('html[data-theme="night"]');
    expect(css).toContain("--night-canvas: #07100b;");
    expect(css).toContain("--night-signal: #4ade80;");
    expect(css).toContain(".trace-button.trace-button-secondary");
    expect(css).toContain("background: var(--signal-soft);");
  });

  it("publishes completed Workspace navigation without static integration placeholders", () => {
    expect(appShell).toContain('href: "/workspaces"');
    expect(appShell).toContain("UsersRound");
    expect(appShell).not.toContain("Integration workspace");
    expect(appShell).not.toContain("Contract-validated frontend");
    expect(appShell).not.toContain("Integration environment");
    expect(githubPanel).not.toContain("DAY 4 PREVIEW");
    expect(githubPanel).not.toContain("Illustrative repository list");
  });

  it("restores the one-column app shell after the late theme override on narrow screens", () => {
    const theme = css.slice(css.indexOf("/* Editorial Console: selected preview 03 */"));
    const fixedShell = theme.indexOf(".app-frame { grid-template-columns: 230px minmax(0, 1fr); }");
    const responsiveReset = theme.lastIndexOf("@media (max-width: 980px)");
    expect(responsiveReset).toBeGreaterThan(fixedShell);
    expect(theme.slice(responsiveReset)).toContain(".app-frame { grid-template-columns: 1fr; }");
  });

  it("reapplies secondary and danger semantics after the generic primary button theme", () => {
    const theme = css.slice(css.indexOf("/* Editorial Console: selected preview 03 */"));
    const genericButton = theme.indexOf(".trace-button, .auth-form button, .centered-state button");
    expect(theme.lastIndexOf(".trace-button.trace-button-secondary")).toBeGreaterThan(genericButton);
    expect(theme.lastIndexOf(".trace-button.trace-button-danger")).toBeGreaterThan(genericButton);
  });

  it("neutralizes disabled variants after their enabled semantic rules", () => {
    const theme = css.slice(css.indexOf("/* Editorial Console: selected preview 03 */"));
    const secondary = theme.lastIndexOf(".trace-button.trace-button-secondary {");
    const danger = theme.lastIndexOf(".trace-button.trace-button-danger {");
    const disabled = theme.lastIndexOf(".trace-button.trace-button-secondary:disabled");
    expect(disabled).toBeGreaterThan(secondary);
    expect(disabled).toBeGreaterThan(danger);
  });

  it("contains no em dash characters in user-facing website source", () => {
    const files = [
      resolve(process.cwd(), "src/components/auth/auth-shell.tsx"),
      resolve(process.cwd(), "src/features/reports/report-detail.tsx"),
      resolve(process.cwd(), "src/mocks/fixtures/workspace.ts"),
    ];
    const emDash = String.fromCodePoint(0x2014);
    expect(files.filter((path) => readFileSync(path, "utf8").includes(emDash))).toEqual([]);
  });
});
