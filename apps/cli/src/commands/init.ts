import { unavailableCommand } from "./unavailable.js";

export function createInitCommand() {
  return unavailableCommand(
    "init",
    "Bind the current Git repository to Trace",
    "Run `trace login` first; repository initialization is not available in this foundation build.",
  );
}
