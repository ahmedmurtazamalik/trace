import { Command } from "commander";

export function createStatusCommand(): Command {
  return new Command("status")
    .description("Show login, repository, watcher, queue, and privacy state")
    .action(() => {
      process.stdout.write(
        [
          "Trace status",
          "Login: not connected",
          "Repository: not initialized",
          "Watcher: inactive",
          "Pending events: 0",
          "Dead-letter events: 0",
          "",
          "Run `trace login`, then `trace init` to connect this repository.",
          "Run `trace start` when initialization is complete.",
        ].join("\n") + "\n",
      );
    });
}
