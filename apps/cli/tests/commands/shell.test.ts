import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const temporaryHomes: string[] = [];

type TestEnvironment = {
  readonly home: string;
  readonly configHome: string;
  readonly dataHome: string;
};

function runTrace(
  args: string[],
  setup?: (environment: TestEnvironment) => void,
) {
  const home = mkdtempSync(resolve(tmpdir(), "trace-cli-home-"));
  temporaryHomes.push(home);
  const environment = {
    home,
    configHome: resolve(home, ".config"),
    dataHome: resolve(home, ".local/share"),
  };
  setup?.(environment);

  return spawnSync("pnpm", ["exec", "tsx", "apps/cli/src/index.ts", ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOME: environment.home,
      XDG_CONFIG_HOME: environment.configHome,
      XDG_DATA_HOME: environment.dataHome,
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

  it("reports real counts from the XDG data queue", () => {
    const result = runTrace(["status"], ({ dataHome }) => {
      const queueRoot = resolve(dataHome, "trace", "events");
      const baseEvent = {
        schemaVersion: 1,
        workspaceId: "workspace-test",
        deviceId: "device-test",
        repository: {
          remoteUrl: "git@github.com:example/trace.git",
          gitDirFingerprint: "fingerprint-test",
          branch: "main",
        },
        type: "STAGED_SNAPSHOT",
        observedAt: "2026-08-11T09:00:00+00:00",
        payload: { fingerprint: "fixture" },
      };
      const states = ["pending", "accepted", "dead-letter"] as const;

      states.forEach((state, index) => {
        const directory = resolve(queueRoot, state);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          resolve(
            directory,
            `00000000-0000-4000-8000-00000000000${index}.json`,
          ),
          `${JSON.stringify({
            ...baseEvent,
            eventId: `00000000-0000-4000-8000-00000000000${index}`,
          })}\n`,
          { mode: 0o600 },
        );
      });
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pending events: 1");
    expect(result.stdout).toContain("Accepted events: 1");
    expect(result.stdout).toContain("Dead-letter events: 1");
  });
});
