import type { CliEventEnvelope } from "@trace/contracts";
import { EventStore } from "./event-store.js";

export type EventDeliveryResult =
  | { readonly eventId: string; readonly outcome: "accepted" }
  | {
      readonly eventId: string;
      readonly outcome: "rejected";
      readonly reason: string;
    }
  | { readonly eventId: string; readonly outcome: "retry" };

export type EventTransport = {
  send(
    events: readonly CliEventEnvelope[],
  ): Promise<readonly EventDeliveryResult[]>;
};

export type SendSummary = {
  readonly attempted: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly keptForRetry: number;
};

export class QueueSender {
  public constructor(
    private readonly eventStore: EventStore,
    private readonly transport: EventTransport,
    private readonly batchSize = 20,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error("Batch size must be an integer from 1 to 100.");
    }
  }

  public async sendPending(): Promise<SendSummary> {
    const events = (await this.eventStore.list("pending")).slice(
      0,
      this.batchSize,
    );
    if (events.length === 0) {
      return { attempted: 0, accepted: 0, rejected: 0, keptForRetry: 0 };
    }

    const results = await this.transport.send(events);
    const expectedIds = new Set(events.map(({ eventId }) => eventId));
    const resultById = new Map<string, EventDeliveryResult>();

    for (const result of results) {
      if (!expectedIds.has(result.eventId)) {
        throw new Error(
          `Received a result for unknown event ${result.eventId}.`,
        );
      }
      if (resultById.has(result.eventId)) {
        throw new Error(
          `Received duplicate results for event ${result.eventId}.`,
        );
      }
      if (result.outcome === "rejected" && result.reason.trim().length === 0) {
        throw new Error(`Rejected event ${result.eventId} requires a reason.`);
      }
      resultById.set(result.eventId, result);
    }

    let accepted = 0;
    let rejected = 0;

    for (const event of events) {
      const result = resultById.get(event.eventId);
      if (result?.outcome === "accepted") {
        await this.eventStore.accept(event.eventId);
        accepted += 1;
      } else if (result?.outcome === "rejected") {
        await this.eventStore.deadLetter(event.eventId, result.reason);
        rejected += 1;
      }
    }

    return {
      attempted: events.length,
      accepted,
      rejected,
      keptForRetry: events.length - accepted - rejected,
    };
  }
}
