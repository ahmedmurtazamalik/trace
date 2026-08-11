import { Command } from "commander";

export function unavailableCommand(
  name: string,
  description: string,
  guidance: string,
): Command {
  return new Command(name).description(description).action(() => {
    process.stderr.write(`${guidance}\n`);
    process.exitCode = 1;
  });
}
