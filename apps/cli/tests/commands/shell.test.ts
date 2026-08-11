import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const temporaryHomes: string[] = [];

function runTrace(args: string[]) {
  const home = mkdtempSync(resolve(tmpdir(), "trace-cli-home-"));
  temporaryHomes.push(home);

  return spawnSync("pnpm", ["exec", "tsx", "apps/cli/src/index.ts", ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: resolve(home, ".config"),
      XDG_DATA_HOME: resolve(home, ".local/share"),
    },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("trace command shell", () => {
  it("explains collected and excluded data in help", () => {
    const result = runTrace(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("staged changes and local commits");
    expect(result.stdout).toContain("does not collect untracked files");
    expect(result.stdout).toContain("login");
    expect(result.stdout).toContain("doctor");
  });

  it("makes an inactive fresh installation obvious", () => {
    const result = runTrace(["status"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Watcher: inactive");
    expect(result.stdout).toContain("Run `trace start`");
    expect(result.stdout).toContain("Pending events: 0");
  });
});
