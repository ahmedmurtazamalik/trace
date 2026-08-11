import { unavailableCommand } from "./unavailable.js";

export function createRemoveCommand() {
  return unavailableCommand(
    "remove",
    "Remove Trace-owned repository configuration",
    "Trace has not initialized this repository in the foundation build, so there is nothing to remove.",
  );
}
