import { unavailableCommand } from "./unavailable.js";

export function createDoctorCommand() {
  return unavailableCommand(
    "doctor",
    "Check the local Trace installation",
    "Diagnostics are not available in this foundation build; run `trace status` for the current state.",
  );
}
