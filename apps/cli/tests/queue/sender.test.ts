import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliEventEnvelope } from "@trace/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/queue/event-store.js";
import {
  QueueSender,
  type EventDeliveryResult,
  type EventTransport,
} from "../../src/queue/sender.js";

const queueRoots: string[] = [];

function event(sequence: number): CliEventEnvelope {
  const suffix = sequence.toString().padStart(12, "0");
  return {
    eventId: `00000000-0000-4000-8000-${suffix}`,
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
    payload: { fingerprint: `fixture-${sequence}` },
  };
}

async function temporaryStore(): Promise<EventStore> {
  const root = await mkdtemp(join(tmpdir(), "trace-sender-test-"));
  queueRoots.push(root);
  return new EventStore(root);
}

afterEach(async () => {
  await Promise.all(
    queueRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("QueueSender", () => {
  it("handles each saved event according to its own result", async () => {
    const store = await temporaryStore();
    const acceptedEvent = event(1);
    const rejectedEvent = event(2);
    const retryEvent = event(3);
    await Promise.all(
      [acceptedEvent, rejectedEvent, retryEvent].map((item) =>
        store.enqueue(item),
      ),
    );

    const results: EventDeliveryResult[] = [
      { eventId: acceptedEvent.eventId, outcome: "accepted" },
      {
        eventId: rejectedEvent.eventId,
        outcome: "rejected",
        reason: "Payload does not match the test server rules.",
      },
      { eventId: retryEvent.eventId, outcome: "retry" },
    ];
    const transport: EventTransport = {
      send: (events: readonly CliEventEnvelope[]) => {
        expect(events.map(({ eventId }) => eventId)).toEqual([
          acceptedEvent.eventId,
          rejectedEvent.eventId,
          retryEvent.eventId,
        ]);
        return Promise.resolve(results);
      },
    };

    const summary = await new QueueSender(store, transport).sendPending();

    expect(summary).toEqual({
      attempted: 3,
      accepted: 1,
      rejected: 1,
      keptForRetry: 1,
    });
    expect(await store.list("accepted")).toEqual([acceptedEvent]);
    expect(await store.list("dead-letter")).toEqual([rejectedEvent]);
    expect(await store.deadLetterReason(rejectedEvent.eventId)).toBe(
      "Payload does not match the test server rules.",
    );
    expect(await store.list("pending")).toEqual([retryEvent]);
  });
});
