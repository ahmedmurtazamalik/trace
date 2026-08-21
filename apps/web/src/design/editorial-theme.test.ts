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

  it("matches the approved Terminal Noir palette and surface treatment", () => {
    expect(css).toContain('html[data-theme="night"]');
    expect(css).toContain("--night-canvas: #05070a;");
    expect(css).toContain("--night-panel: #0a0e13;");
    expect(css).toContain("--night-line: #1c2733;");
    expect(css).toContain("--night-signal: #19df91;");
    expect(css).toMatch(/html\[data-theme="night"\] body\s*\{[^}]*radial-gradient\(circle at 78% 0, var\(--night-soft\), transparent 27rem\)/s);
    expect(css).toMatch(/html\[data-theme="night"\] \.nav-link\.active\s*\{[^}]*box-shadow:\s*inset 2px 0 var\(--signal\)/s);
    expect(css).toMatch(/html\[data-theme="night"\] \.trace-card[\s\S]*?box-shadow:\s*none;/);
  });

  it("themes every native data-entry surface in night mode", () => {
    const night = css.slice(css.indexOf("/* Terminal night mode: approved Preview 01 */"));
    expect(night).toContain('html[data-theme="night"] :where(input:not([type="checkbox"]):not([type="radio"])');
    expect(night).toContain('textarea, select)');
    expect(night).toContain('html[data-theme="night"] input:-webkit-autofill');
    expect(night).toContain('html[data-theme="night"] input:disabled');
    expect(night).toContain('html[data-theme="night"] .manager-tool-grid form');
    expect(night).toContain('html[data-theme="night"] .workspace-invitation-tool');
  });

  it("keeps the Activity empty-state action in normal document flow", () => {
    expect(css).toMatch(/\.activity-state-card\s*\{[^}]*display:\s*grid;[^}]*gap:/s);
    expect(css).toMatch(/\.activity-state-card\s+\.trace-button\s*\{[^}]*position:\s*static;/s);
  });

  it("keeps report metadata above WCAG AA contrast on pale cards", () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const foreground = luminance("#5f7086");
    const background = luminance("#f8faf5");
    expect((background + 0.05) / (foreground + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(".report-currentness span, .report-currentness small { color: #5f7086;");
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
