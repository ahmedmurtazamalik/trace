import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  cliEventEnvelopeSchema,
  type CliEventEnvelope,
} from "@trace/contracts";

export type QueueState = "pending" | "accepted" | "dead-letter";

export class EventStore {
  public constructor(private readonly rootDirectory: string) {}

  public async enqueue(event: CliEventEnvelope): Promise<void> {
    const validatedEvent = cliEventEnvelopeSchema.parse(event);
    const pendingDirectory = this.stateDirectory("pending");
    await mkdir(pendingDirectory, { recursive: true, mode: 0o700 });

    const targetPath = this.eventPath("pending", validatedEvent.eventId);
    const serializedEvent = `${JSON.stringify(validatedEvent)}\n`;
    try {
      const existingEvent = await readFile(targetPath, "utf8");
      if (existingEvent === serializedEvent) {
        return;
      }
      throw new Error(
        `Event ${validatedEvent.eventId} already exists with different content.`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const temporaryPath = join(
      pendingDirectory,
      `.${validatedEvent.eventId}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, serializedEvent, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      try {
        await link(temporaryPath, targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const existingEvent = await readFile(targetPath, "utf8");
        if (existingEvent !== serializedEvent) {
          throw new Error(
            `Event ${validatedEvent.eventId} already exists with different content.`,
          );
        }
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  public async accept(eventId: string): Promise<void> {
    await this.transition(eventId, "accepted");
  }

  public async deadLetter(eventId: string, reason: string): Promise<void> {
    if (reason.trim().length === 0) {
      throw new Error("A dead-letter reason is required.");
    }

    await this.transition(eventId, "dead-letter");
    await writeFile(this.deadLetterReasonPath(eventId), `${reason.trim()}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }

  public async deadLetterReason(eventId: string): Promise<string> {
    return (await readFile(this.deadLetterReasonPath(eventId), "utf8")).trim();
  }

  public async count(state: QueueState): Promise<number> {
    const directory = this.stateDirectory(state);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return (await readdir(directory)).filter((filename) =>
      filename.endsWith(".json"),
    ).length;
  }

  public async list(state: QueueState): Promise<CliEventEnvelope[]> {
    const directory = this.stateDirectory(state);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith(".json"))
      .sort();

    return Promise.all(
      filenames.map(async (filename) => {
        const contents = await readFile(join(directory, filename), "utf8");
        return cliEventEnvelopeSchema.parse(JSON.parse(contents));
      }),
    );
  }

  private async transition(
    eventId: string,
    destination: Exclude<QueueState, "pending">,
  ): Promise<void> {
    const destinationDirectory = this.stateDirectory(destination);
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    await rename(
      this.eventPath("pending", eventId),
      this.eventPath(destination, eventId),
    );
  }

  private stateDirectory(state: QueueState): string {
    return join(this.rootDirectory, state);
  }

  private deadLetterReasonPath(eventId: string): string {
    return join(this.stateDirectory("dead-letter"), `${eventId}.reason.txt`);
  }

  private eventPath(state: QueueState, eventId: string): string {
    return join(this.stateDirectory(state), `${eventId}.json`);
  }
}
