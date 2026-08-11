import { Command } from "commander";
import { getTracePaths } from "../config/paths.js";
import { EventStore } from "../queue/event-store.js";

export function createStatusCommand(): Command {
  return new Command("status")
    .description("Show login, repository, watcher, queue, and privacy state")
    .action(async () => {
      const { eventQueueDirectory } = getTracePaths();
      const eventStore = new EventStore(eventQueueDirectory);
      const [pendingEvents, acceptedEvents, deadLetterEvents] =
        await Promise.all([
          eventStore.count("pending"),
          eventStore.count("accepted"),
          eventStore.count("dead-letter"),
        ]);

      process.stdout.write(
        [
          "Trace status",
          "Login: not connected",
          "Repository: not initialized",
          "Watcher: inactive",
          `Pending events: ${pendingEvents}`,
          `Accepted events: ${acceptedEvents}`,
          `Dead-letter events: ${deadLetterEvents}`,
          "",
          "Run `trace login`, then `trace init` to connect this repository.",
          "Run `trace start` when initialization is complete.",
        ].join("\n") + "\n",
      );
    });
}
