import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global typography", () => {
  it("uses the approved slightly larger and thicker base type", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/html\s*\{[^}]*font-size:\s*16\.5px;/s);
    expect(css).toMatch(/body\s*\{[^}]*font-weight:\s*450;/s);
  });
});
