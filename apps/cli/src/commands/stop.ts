import { unavailableCommand } from "./unavailable.js";

export function createStopCommand() {
  return unavailableCommand(
    "stop",
    "Stop staged-file observation",
    "No Trace watcher is active in this foundation build.",
  );
}
