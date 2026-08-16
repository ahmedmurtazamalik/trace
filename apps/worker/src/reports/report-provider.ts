import { z } from 'zod';
import { gitObjectIdSchema, reportContentSchema, reportFactsSchema, type ReportContent, type ReportFacts } from '@trace/shared';

const snapshotContributorSchema = z.object({
  id: z.string().min(1).max(256),
  username: z.string().min(1).max(100).nullable(),
  displayName: z.string().min(1).max(256).nullable(),
  facts: reportFactsSchema,
}).strict();

const snapshotEvidenceSchema = z.object({
  activityId: z.string().min(1).max(256),
  occurredAt: z.iso.datetime(),
  type: z.literal('commit'),
  sha: gitObjectIdSchema,
  message: z.string().min(1).max(10_000),
}).strict();

const snapshotRepositorySchema = z.object({
  id: z.string().min(1).max(256),
  fullName: z.string().min(1).max(512),
  facts: reportFactsSchema,
  contributors: z.array(snapshotContributorSchema).max(100),
  evidence: z.array(snapshotEvidenceSchema).max(10_000),
}).strict();

export const reportInputSnapshotSchema = z.object({
  version: z.literal(1),
  reportDate: z.iso.date(),
  timezone: z.string().min(1).max(100),
  facts: reportFactsSchema,
  repositories: z.array(snapshotRepositorySchema).max(100),
}).strict();

export type ReportInputSnapshot = z.infer<typeof reportInputSnapshotSchema>;

export interface StructuredReportProvider {
  generate(snapshot: ReportInputSnapshot): Promise<unknown>;
}

export class DeterministicReportProvider implements StructuredReportProvider {
  generate(snapshotInput: ReportInputSnapshot): Promise<ReportContent> {
    const snapshot = reportInputSnapshotSchema.parse(snapshotInput);
    return Promise.resolve(groundedTemplate(snapshot));
  }
}

export function validateGroundedReportContent(output: unknown, snapshotInput: unknown): ReportContent {
  const snapshot = reportInputSnapshotSchema.parse(snapshotInput);
  const content = reportContentSchema.parse(output);
  const expected = groundedTemplate(snapshot);
  if (content.executiveSummary !== expected.executiveSummary || content.repositories.length !== expected.repositories.length) {
    throw new Error('REPORT_OUTPUT_NOT_GROUNDED');
  }
  for (let index = 0; index < content.repositories.length; index += 1) {
    const repository = content.repositories[index]!;
    const expectedRepository = expected.repositories[index]!;
    const snapshotRepository = snapshot.repositories[index]!;
    if (repository.repositoryId !== expectedRepository.repositoryId
      || repository.contributors.length !== expectedRepository.contributors.length) {
      throw new Error('REPORT_OUTPUT_NOT_GROUNDED');
    }
    const evidenceSuffix = repository.summary.slice(expectedRepository.summary.length);
    if (!repository.summary.startsWith(expectedRepository.summary)
      || !validEvidenceSuffix(evidenceSuffix, snapshotRepository.evidence.map((evidence) => evidence.message))) {
      throw new Error('REPORT_OUTPUT_NOT_GROUNDED');
    }
    for (let contributorIndex = 0; contributorIndex < repository.contributors.length; contributorIndex += 1) {
      const contributor = repository.contributors[contributorIndex]!;
      const expectedContributor = expectedRepository.contributors[contributorIndex]!;
      if (contributor.contributorId !== expectedContributor.contributorId
        || contributor.summary !== expectedContributor.summary
        || contributor.accomplishments.length !== 0) {
        throw new Error('REPORT_OUTPUT_NOT_GROUNDED');
      }
    }
  }
  return content;
}

function validEvidenceSuffix(suffix: string, evidenceMessages: string[]): boolean {
  if (suffix === '') return true;
  if (!suffix.startsWith(' Evidence: ')) return false;
  const supplied = suffix.slice(' Evidence: '.length).split('; ');
  const available = new Set(evidenceMessages);
  return supplied.length > 0 && supplied.every((message) => available.has(message)) && new Set(supplied).size === supplied.length;
}

export function groundedTemplate(snapshot: ReportInputSnapshot): ReportContent {
  return reportContentSchema.parse({
    executiveSummary: snapshot.facts.commitCount === 0
      ? `No development commits were recorded for ${snapshot.reportDate}.`
      : `${snapshot.facts.commitCount} development commit${snapshot.facts.commitCount === 1 ? '' : 's'} changed ${snapshot.facts.filesChanged} file${snapshot.facts.filesChanged === 1 ? '' : 's'} across ${snapshot.facts.repositoryCount} repositor${snapshot.facts.repositoryCount === 1 ? 'y' : 'ies'}.`,
    repositories: snapshot.repositories.map((repository) => ({
      repositoryId: repository.id,
      summary: `${repository.fullName} recorded ${repository.facts.commitCount} commit${repository.facts.commitCount === 1 ? '' : 's'}, ${repository.facts.additions} addition${repository.facts.additions === 1 ? '' : 's'}, and ${repository.facts.deletions} deletion${repository.facts.deletions === 1 ? '' : 's'}.`,
      contributors: repository.contributors.map((contributor) => ({
        contributorId: contributor.id,
        summary: `${contributor.displayName ?? contributor.username ?? 'Contributor'} authored ${contributor.facts.commitCount} commit${contributor.facts.commitCount === 1 ? '' : 's'} in ${repository.fullName}.`,
        accomplishments: [],
      })),
    })),
  });
}

export type { ReportContent, ReportFacts };
