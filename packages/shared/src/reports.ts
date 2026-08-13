import { z } from 'zod';
import { timezoneSchema } from './activity';
import { pageInfoSchema } from './pagination';

export const reportStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export const reportRevisionSourceSchema = z.enum(['ai', 'manual']);
export const reportArtifactKindSchema = z.enum(['latex', 'pdf']);

const boundedProse = (maximum: number) => z.string().trim().min(1).max(maximum);

export const reportContributorContentSchema = z.object({
  contributorId: z.string().min(1).max(256),
  summary: boundedProse(10_000),
  accomplishments: z.array(boundedProse(2_000)).max(50),
}).strict();

export const reportRepositoryContentSchema = z.object({
  repositoryId: z.string().min(1).max(256),
  summary: boundedProse(10_000),
  contributors: z.array(reportContributorContentSchema).max(100),
}).strict();

export const reportContentSchema = z.object({
  executiveSummary: boundedProse(20_000),
  repositories: z.array(reportRepositoryContentSchema).max(100),
}).strict().superRefine((value, context) => {
  const repositoryIds = new Set<string>();
  value.repositories.forEach((repository, repositoryIndex) => {
    if (repositoryIds.has(repository.repositoryId)) {
      context.addIssue({ code: 'custom', path: ['repositories', repositoryIndex, 'repositoryId'], message: 'Duplicate repository' });
    }
    repositoryIds.add(repository.repositoryId);
    const contributorIds = new Set<string>();
    repository.contributors.forEach((contributor, contributorIndex) => {
      if (contributorIds.has(contributor.contributorId)) {
        context.addIssue({ code: 'custom', path: ['repositories', repositoryIndex, 'contributors', contributorIndex, 'contributorId'], message: 'Duplicate contributor' });
      }
      contributorIds.add(contributor.contributorId);
    });
  });
});

export const reportFactsSchema = z.object({
  repositoryCount: z.number().int().nonnegative(),
  contributorCount: z.number().int().nonnegative(),
  commitCount: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
}).strict();

export const reportArtifactSchema = z.object({
  id: z.string().min(1).max(256),
  revision: z.number().int().positive(),
  kind: reportArtifactKindSchema,
  fileName: z.string().min(1).max(200).regex(/^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._ -]*$/),
  contentType: z.enum(['application/pdf', 'application/x-tex']),
  sizeBytes: z.number().int().positive().max(100_000_000),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, context) => {
  const expected = value.kind === 'pdf' ? 'application/pdf' : 'application/x-tex';
  if (value.contentType !== expected) {
    context.addIssue({ code: 'custom', path: ['contentType'], message: 'Artifact content type does not match kind' });
  }
});

const reportSummaryShape = {
  id: z.string().min(1).max(256),
  reportDate: z.iso.date(),
  timezone: timezoneSchema,
  status: reportStatusSchema,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  errorMessage: z.string().min(1).max(1_000).nullable(),
  revision: z.number().int().positive().nullable(),
  downloadAvailable: z.boolean(),
};

export const reportSummarySchema = z.object(reportSummaryShape).strict().superRefine((value, context) => {
  if (value.status === 'completed') {
    if (value.completedAt === null) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Completed report requires timestamp' });
    if (value.revision === null) context.addIssue({ code: 'custom', path: ['revision'], message: 'Completed report requires revision' });
    if (!value.downloadAvailable) context.addIssue({ code: 'custom', path: ['downloadAvailable'], message: 'Completed report requires download' });
  } else {
    if (value.completedAt !== null) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Incomplete report cannot have completed timestamp' });
    if (value.downloadAvailable) context.addIssue({ code: 'custom', path: ['downloadAvailable'], message: 'Incomplete report cannot be downloadable' });
  }
  if (value.status === 'failed' ? value.errorMessage === null : value.errorMessage !== null) {
    context.addIssue({ code: 'custom', path: ['errorMessage'], message: 'Error message must match failed status' });
  }
});

export const reportCreateRequestSchema = z.object({
  reportDate: z.iso.date(),
  timezone: timezoneSchema.default('UTC'),
}).strict();

export const reportListQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: reportStatusSchema.optional(),
}).strict();

export const reportListResponseSchema = z.object({
  items: z.array(reportSummarySchema).max(100),
  pageInfo: pageInfoSchema,
}).strict();

export const reportCreateResponseSchema = z.object({ report: reportSummarySchema }).strict();

export const reportDetailSchema = z.object({
  ...reportSummaryShape,
  revisionSource: reportRevisionSourceSchema.nullable(),
  content: reportContentSchema.nullable(),
  facts: reportFactsSchema,
  artifacts: z.array(reportArtifactSchema).max(20),
}).strict().superRefine((value, context) => {
  if (value.status === 'completed') {
    if (value.completedAt === null) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Completed report requires timestamp' });
    if (value.revision === null || value.revisionSource === null || value.content === null) {
      context.addIssue({ code: 'custom', path: ['content'], message: 'Completed report requires revisioned content' });
    }
    if (!value.downloadAvailable || !value.artifacts.some((artifact) => artifact.kind === 'pdf' && artifact.revision === value.revision)) {
      context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Completed report requires current PDF artifact' });
    }
  } else {
    if (value.completedAt !== null) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Incomplete report cannot have completed timestamp' });
    if (value.downloadAvailable || value.artifacts.some((artifact) => artifact.kind === 'pdf')) {
      context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Incomplete report cannot expose PDF artifact' });
    }
  }
  if (value.status === 'failed' ? value.errorMessage === null : value.errorMessage !== null) {
    context.addIssue({ code: 'custom', path: ['errorMessage'], message: 'Error message must match failed status' });
  }
  if ((value.revision === null) !== (value.revisionSource === null) || (value.revision === null) !== (value.content === null)) {
    context.addIssue({ code: 'custom', path: ['revision'], message: 'Revision, source, and content must appear together' });
  }
  const artifactIds = new Set<string>();
  for (const artifact of value.artifacts) {
    if (artifactIds.has(artifact.id)) {
      context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Duplicate artifact ID' });
    }
    artifactIds.add(artifact.id);
    if (value.revision !== null && artifact.revision > value.revision) {
      context.addIssue({ code: 'custom', path: ['artifacts'], message: 'Artifact cannot reference a future revision' });
    }
  }
});

export const reportDetailResponseSchema = z.object({ report: reportDetailSchema }).strict();

const reportProsePatchSchema = z.object({
  executiveSummary: boundedProse(20_000).optional(),
  repositories: z.array(z.object({
    repositoryId: z.string().min(1).max(256),
    summary: boundedProse(10_000).optional(),
    contributors: z.array(z.object({
      contributorId: z.string().min(1).max(256),
      summary: boundedProse(10_000).optional(),
      accomplishments: z.array(boundedProse(2_000)).max(50).optional(),
    }).strict().refine(
      (contributor) => contributor.summary !== undefined || contributor.accomplishments !== undefined,
      'Contributor patch is empty',
    )).min(1).max(100).optional(),
  }).strict().refine(
    (repository) => repository.summary !== undefined || repository.contributors !== undefined,
    'Repository patch is empty',
  )).min(1).max(100).optional(),
}).strict()
  .refine((patch) => patch.executiveSummary !== undefined || patch.repositories !== undefined, 'Patch is empty')
  .superRefine((patch, context) => {
    const repositoryIds = new Set<string>();
    patch.repositories?.forEach((repository, repositoryIndex) => {
      if (repositoryIds.has(repository.repositoryId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['repositories', repositoryIndex, 'repositoryId'], message: 'Duplicate repository' });
      }
      repositoryIds.add(repository.repositoryId);
      const contributorIds = new Set<string>();
      repository.contributors?.forEach((contributor, contributorIndex) => {
        if (contributorIds.has(contributor.contributorId)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['repositories', repositoryIndex, 'contributors', contributorIndex, 'contributorId'], message: 'Duplicate contributor' });
        }
        contributorIds.add(contributor.contributorId);
      });
    });
  });

export const reportRevisionUpdateRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  prosePatch: reportProsePatchSchema,
}).strict();

export const reportRegenerationRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

export const reportRevisionUpdateResponseSchema = reportDetailResponseSchema;
export const reportRegenerationResponseSchema = reportDetailResponseSchema;

export const reportDownloadQuerySchema = z.object({
  artifactId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

export const reportErrorCodeSchema = z.enum([
  'REPORT_NOT_FOUND',
  'REPORT_ALREADY_EXISTS',
  'REPORT_NOT_EDITABLE',
  'REPORT_REVISION_CONFLICT',
  'REPORT_ARTIFACT_NOT_FOUND',
  'REPORT_GENERATION_UNAVAILABLE',
]);

export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type ReportRevisionSource = z.infer<typeof reportRevisionSourceSchema>;
export type ReportArtifactKind = z.infer<typeof reportArtifactKindSchema>;
export type ReportContent = z.infer<typeof reportContentSchema>;
export type ReportFacts = z.infer<typeof reportFactsSchema>;
export type ReportArtifact = z.infer<typeof reportArtifactSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type ReportCreateRequest = z.infer<typeof reportCreateRequestSchema>;
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;
export type ReportListResponse = z.infer<typeof reportListResponseSchema>;
export type ReportCreateResponse = z.infer<typeof reportCreateResponseSchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;
export type ReportDetailResponse = z.infer<typeof reportDetailResponseSchema>;
export type ReportRevisionUpdateRequest = z.infer<typeof reportRevisionUpdateRequestSchema>;
export type ReportRegenerationRequest = z.infer<typeof reportRegenerationRequestSchema>;
export type ReportRevisionUpdateResponse = z.infer<typeof reportRevisionUpdateResponseSchema>;
export type ReportRegenerationResponse = z.infer<typeof reportRegenerationResponseSchema>;
export type ReportDownloadQuery = z.infer<typeof reportDownloadQuerySchema>;
export type ReportErrorCode = z.infer<typeof reportErrorCodeSchema>;
