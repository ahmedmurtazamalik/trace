import { unavailableCommand } from "./unavailable.js";

export function createLoginCommand() {
  return unavailableCommand(
    "login",
    "Pair this device with Trace",
    "Device login is not available in this foundation build.",
  );
}
