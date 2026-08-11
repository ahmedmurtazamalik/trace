#!/usr/bin/env node
import { Command } from "commander";
import { createDoctorCommand } from "./commands/doctor.js";
import { createInitCommand } from "./commands/init.js";
import { createLoginCommand } from "./commands/login.js";
import { createRemoveCommand } from "./commands/remove.js";
import { createStartCommand } from "./commands/start.js";
import { createStatusCommand } from "./commands/status.js";
import { createStopCommand } from "./commands/stop.js";

const program = new Command();

program
  .name("trace")
  .description(
    "Observe staged changes and local commits in explicitly initialized Git repositories.",
  )
  .addHelpText(
    "after",
    [
      "",
      "Collection and privacy:",
      "  Trace collects bounded staged changes and local commits while its watcher is active.",
      "  Trace does not collect untracked files, unstaged changes, terminal history, or screen activity.",
      "",
    ].join("\n"),
  );

program.addCommand(createLoginCommand());
program.addCommand(createInitCommand());
program.addCommand(createStatusCommand());
program.addCommand(createStartCommand());
program.addCommand(createStopCommand());
program.addCommand(createRemoveCommand());
program.addCommand(createDoctorCommand());

await program.parseAsync(process.argv);
