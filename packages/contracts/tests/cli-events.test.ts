import { describe, expect, it } from "vitest";
import { cliEventEnvelopeSchema } from "../src/cli-events.js";

const validStagedEvent = {
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
  payload: {},
};

describe("CLI event envelope contract", () => {
  it("accepts the frozen version 1 staged-event envelope", () => {
    expect(cliEventEnvelopeSchema.parse(validStagedEvent)).toEqual(
      validStagedEvent,
    );
  });

  it("rejects event variants outside the frozen contract", () => {
    expect(() =>
      cliEventEnvelopeSchema.parse({
        ...validStagedEvent,
        type: "TERMINAL_CAPTURE",
      }),
    ).toThrow();
  });

  it("rejects malformed event IDs and timestamps", () => {
    expect(() =>
      cliEventEnvelopeSchema.parse({
        ...validStagedEvent,
        eventId: "retry-me",
        observedAt: "yesterday",
      }),
    ).toThrow();
  });
});
