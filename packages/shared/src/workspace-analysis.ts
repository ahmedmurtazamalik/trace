import { z } from 'zod';

const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/i);

export const workspaceAnalysisStatusSchema = z.enum(['UNINITIALIZED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'BLOCKED_ACCESS']);
export const workspaceAnalysisRunKindSchema = z.enum(['BASELINE', 'INCREMENTAL']);
export const workspaceAnalysisAccessStateSchema = z.enum(['ACTIVE', 'ACCESS_REMOVED']);

export const workspaceAnalysisCoverageSchema = z.object({
  totalFiles: z.number().int().nonnegative(),
  eligibleFiles: z.number().int().nonnegative(),
  analyzedFiles: z.number().int().nonnegative(),
  excludedFiles: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  analyzedBytes: z.number().int().nonnegative(),
  truncatedFiles: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.eligibleFiles + value.excludedFiles !== value.totalFiles) context.addIssue({ code: 'custom', message: 'Coverage file totals must balance.' });
  if (value.analyzedFiles > value.eligibleFiles || value.truncatedFiles > value.analyzedFiles) context.addIssue({ code: 'custom', message: 'Analyzed coverage exceeds eligible coverage.' });
  if (value.analyzedBytes > value.totalBytes) context.addIssue({ code: 'custom', message: 'Analyzed bytes exceed repository bytes.' });
});

export const workspaceAnalysisFileEvidenceSchema = z.object({
  path: z.string().min(1).max(1024),
  blobSha: shaSchema,
  size: z.number().int().nonnegative(),
  language: z.string().min(1).max(64),
  disposition: z.enum(['ANALYZED', 'EXCLUDED', 'TRUNCATED']),
  exclusionReason: z.string().min(1).max(160).nullable(),
  content: z.string().max(32_768).nullable(),
}).strict();

export const workspaceAnalysisChangeEvidenceSchema = z.object({
  path: z.string().min(1).max(1024),
  previousPath: z.string().min(1).max(1024).nullable(),
  status: z.enum(['ADDED', 'MODIFIED', 'RENAMED', 'DELETED']),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  patch: z.string().max(65_536).nullable(),
  truncationReason: z.string().min(1).max(160).nullable(),
}).strict();

export const workspaceAnalysisEvidenceSnapshotSchema = z.object({
  version: z.literal(1),
  defaultBranch: z.string().min(1).max(255),
  baselineOnly: z.boolean(),
  files: z.array(workspaceAnalysisFileEvidenceSchema).max(10_000),
  changes: z.array(workspaceAnalysisChangeEvidenceSchema).max(3_000),
  exclusions: z.record(z.string().min(1).max(80), z.number().int().nonnegative()),
}).strict();

export const workspaceAnalysisRunSchema = z.object({
  id: z.string().min(1).max(256),
  workspaceId: z.string().min(1).max(256),
  repositoryId: z.string().min(1).max(256),
  kind: workspaceAnalysisRunKindSchema,
  fromSha: shaSchema.nullable(),
  toSha: shaSchema.nullable(),
  dataCutoffAt: z.iso.datetime(),
  status: workspaceAnalysisStatusSchema.exclude(['UNINITIALIZED']),
  coverage: workspaceAnalysisCoverageSchema.nullable(),
  accessState: workspaceAnalysisAccessStateSchema,
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  error: z.string().max(500).nullable(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'BASELINE' && value.fromSha !== null) context.addIssue({ code: 'custom', message: 'Baseline runs cannot have a prior SHA.' });
  if (value.kind === 'INCREMENTAL' && value.fromSha === null) context.addIssue({ code: 'custom', message: 'Incremental runs require a prior SHA.' });
  if (value.status === 'COMPLETED' && (value.toSha === null || value.startedAt === null || value.completedAt === null || value.coverage === null)) context.addIssue({ code: 'custom', message: 'Completed runs require a pinned SHA, timestamps, and coverage.' });
});

const workspaceRepositoryAnalysisCurrentnessShape = {
  workspaceId: z.string().min(1).max(256),
  repositoryId: z.string().min(1).max(256),
  repositoryFullName: z.string().min(1).max(512),
  status: workspaceAnalysisStatusSchema,
  baselineSha: shaSchema.nullable(),
  lastAnalyzedSha: shaSchema.nullable(),
  baselineCompletedAt: z.iso.datetime().nullable(),
  lastAnalyzedAt: z.iso.datetime().nullable(),
  accessState: workspaceAnalysisAccessStateSchema,
  coverage: workspaceAnalysisCoverageSchema.nullable(),
};

export const workspaceRepositoryAnalysisSchema = z.object({
  ...workspaceRepositoryAnalysisCurrentnessShape,
  baselineStartedAt: z.iso.datetime().nullable(),
  lastError: z.string().max(500).nullable(),
  latestRun: workspaceAnalysisRunSchema.nullable(),
}).strict();

export const workspaceRepositoryAnalysisListItemSchema = z.object({
  ...workspaceRepositoryAnalysisCurrentnessShape,
  baselineStartedAt: z.iso.datetime().nullable().optional(),
  lastError: z.string().max(500).nullable().optional(),
  latestRun: workspaceAnalysisRunSchema.nullable().optional(),
}).strict();

export const workspaceAnalysisResponseSchema = z.object({ items: z.array(workspaceRepositoryAnalysisListItemSchema).max(500) }).strict();
export const workspaceAnalysisStartResponseSchema = z.object({ analysis: workspaceRepositoryAnalysisSchema, run: workspaceAnalysisRunSchema }).strict();

export type WorkspaceAnalysisCoverage = z.infer<typeof workspaceAnalysisCoverageSchema>;
export type WorkspaceAnalysisEvidenceSnapshot = z.infer<typeof workspaceAnalysisEvidenceSnapshotSchema>;
export type WorkspaceAnalysisRun = z.infer<typeof workspaceAnalysisRunSchema>;
export type WorkspaceRepositoryAnalysis = z.infer<typeof workspaceRepositoryAnalysisSchema>;
export type WorkspaceRepositoryAnalysisListItem = z.infer<typeof workspaceRepositoryAnalysisListItemSchema>;
export type WorkspaceAnalysisResponse = z.infer<typeof workspaceAnalysisResponseSchema>;
export type WorkspaceAnalysisStartResponse = z.infer<typeof workspaceAnalysisStartResponseSchema>;
