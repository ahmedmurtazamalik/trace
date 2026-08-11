import { unavailableCommand } from "./unavailable.js";

export function createStartCommand() {
  return unavailableCommand(
    "start",
    "Start staged-file observation",
    "Run `trace login` and `trace init` first; the watcher is not available in this foundation build.",
  );
}
