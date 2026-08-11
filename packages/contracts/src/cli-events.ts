import { z } from "zod";

const repositorySchema = z.object({
  remoteUrl: z.string().min(1),
  gitDirFingerprint: z.string().min(1),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .optional(),
  branch: z.string().min(1).optional(),
});

export const cliEventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  schemaVersion: z.literal(1),
  workspaceId: z.string().min(1),
  deviceId: z.string().min(1),
  repository: repositorySchema,
  type: z.enum(["STAGED_SNAPSHOT", "LOCAL_COMMIT", "PUSH_ATTEMPT"]),
  observedAt: z.iso.datetime({ offset: true }),
  payload: z.unknown(),
});

export type CliEventEnvelope = z.infer<typeof cliEventEnvelopeSchema>;
