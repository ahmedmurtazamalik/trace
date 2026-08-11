import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliEventEnvelope } from "@trace/contracts";
import { EventStore } from "../../src/queue/event-store.js";

const temporaryDirectories: string[] = [];

const stagedEvent: CliEventEnvelope = {
  eventId: "6e57f34c-79da-4f85-97e4-b686469f0a9f",
  schemaVersion: 1,
  workspaceId: "workspace-fixture",
  deviceId: "device-fixture",
  repository: {
    remoteUrl: "git@github.com:trace-fixtures/example.git",
    gitDirFingerprint: "sha256:fixture",
    headSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "main",
  },
  type: "STAGED_SNAPSHOT",
  observedAt: "2026-08-11T00:00:00.000Z",
  payload: { fingerprint: "staged-fixture" },
};

async function temporaryQueueRoot() {
  const directory = await mkdtemp(join(tmpdir(), "trace-event-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("EventStore", () => {
  it("retains a pending event unchanged across store restarts", async () => {
    const root = await temporaryQueueRoot();
    const firstProcess = new EventStore(root);

    await firstProcess.enqueue(stagedEvent);

    const restartedProcess = new EventStore(root);
    expect(await restartedProcess.list("pending")).toEqual([stagedEvent]);

    const pendingDirectory = join(root, "pending");
    expect(await readdir(pendingDirectory)).toEqual([
      `${stagedEvent.eventId}.json`,
    ]);
    expect(
      (await stat(join(pendingDirectory, `${stagedEvent.eventId}.json`))).mode &
        0o777,
    ).toBe(0o600);
  });

  it("does not replace an existing event file during an identical retry", async () => {
    const root = await temporaryQueueRoot();
    const store = new EventStore(root);
    await store.enqueue(stagedEvent);
    const eventPath = join(root, "pending", `${stagedEvent.eventId}.json`);
    const originalInode = (await stat(eventPath)).ino;

    await store.enqueue(stagedEvent);

    expect((await stat(eventPath)).ino).toBe(originalInode);
    expect(await store.list("pending")).toEqual([stagedEvent]);
  });

  it("rejects a reused event ID with different content", async () => {
    const root = await temporaryQueueRoot();
    const store = new EventStore(root);
    await store.enqueue(stagedEvent);

    await expect(
      store.enqueue({
        ...stagedEvent,
        payload: { fingerprint: "different-content" },
      }),
    ).rejects.toThrow("already exists with different content");

    expect(await store.list("pending")).toEqual([stagedEvent]);
  });

  it("rejects concurrent conflicting writes for the same event ID", async () => {
    const root = await temporaryQueueRoot();
    const firstProcess = new EventStore(root);
    const secondProcess = new EventStore(root);

    const results = await Promise.allSettled([
      firstProcess.enqueue(stagedEvent),
      secondProcess.enqueue({
        ...stagedEvent,
        payload: { fingerprint: "concurrent-conflict" },
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(await firstProcess.list("pending")).toHaveLength(1);
  });

  it("moves an acknowledged event to accepted without changing it", async () => {
    const root = await temporaryQueueRoot();
    const store = new EventStore(root);
    await store.enqueue(stagedEvent);

    await store.accept(stagedEvent.eventId);

    expect(await store.list("pending")).toEqual([]);
    expect(await store.list("accepted")).toEqual([stagedEvent]);
  });

  it("dead-letters a rejected event with a useful reason", async () => {
    const root = await temporaryQueueRoot();
    const store = new EventStore(root);
    await store.enqueue(stagedEvent);

    await store.deadLetter(stagedEvent.eventId, "patch exceeds server limit");

    expect(await store.list("pending")).toEqual([]);
    expect(await store.list("dead-letter")).toEqual([stagedEvent]);
    expect(await store.deadLetterReason(stagedEvent.eventId)).toBe(
      "patch exceeds server limit",
    );
  });
});
