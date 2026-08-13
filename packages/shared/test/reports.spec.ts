import detailFixture from './fixtures/reports/detail.completed.json';
import listFixture from './fixtures/reports/list.success.json';
import {
  reportCreateRequestSchema,
  reportCreateResponseSchema,
  reportDetailResponseSchema,
  reportDownloadQuerySchema,
  reportErrorCodeSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  reportRegenerationRequestSchema,
  reportRegenerationResponseSchema,
  reportRevisionUpdateRequestSchema,
  reportRevisionUpdateResponseSchema,
} from '../src';

describe('Frozen Day 8-10 report contract', () => {
  it('freezes create, list, and owner-facing detail schemas', () => {
    expect(reportCreateRequestSchema.parse({ reportDate: '2026-08-12', timezone: 'Asia/Karachi' })).toEqual({
      reportDate: '2026-08-12', timezone: 'Asia/Karachi',
    });
    expect(reportListQuerySchema.parse({ limit: '10', status: 'completed' })).toEqual({ limit: 10, status: 'completed' });
    expect(reportListResponseSchema.parse(listFixture)).toEqual(listFixture);
    expect(reportDetailResponseSchema.parse(detailFixture)).toEqual(detailFixture);
  });

  it('allows only bounded structured prose edits with optimistic revision matching', () => {
    const content = detailFixture.report.content;
    const prosePatch = {
      executiveSummary: content.executiveSummary,
      repositories: content.repositories.map((repository) => ({
        repositoryId: repository.repositoryId,
        summary: repository.summary,
        contributors: repository.contributors.map((contributor) => ({
          contributorId: contributor.contributorId,
          summary: contributor.summary,
          accomplishments: contributor.accomplishments,
        })),
      })),
    };
    const firstRepository = prosePatch.repositories[0]!;
    const firstContributor = firstRepository.contributors[0]!;
    expect(reportRevisionUpdateRequestSchema.parse({ expectedRevision: 2, prosePatch })).toEqual({ expectedRevision: 2, prosePatch });
    expect(reportRegenerationRequestSchema.parse({ expectedRevision: 2 })).toEqual({ expectedRevision: 2 });

    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: { ...prosePatch, latex: '\\input{/etc/passwd}' },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: {
        ...prosePatch,
        repositories: [{ ...prosePatch.repositories[0], commitCount: 999 }],
      },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: { ...prosePatch, repositories: [] },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: {
        ...prosePatch,
        repositories: [{ ...prosePatch.repositories[0], contributors: [] }],
      },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: {
        repositories: [firstRepository, firstRepository],
      },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: {
        repositories: [{
          repositoryId: firstRepository.repositoryId,
          contributors: [firstContributor, firstContributor],
        }],
      },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: { repositories: [{ repositoryId: firstRepository.repositoryId }] },
    }).success).toBe(false);
    expect(reportRevisionUpdateRequestSchema.safeParse({
      expectedRevision: 2,
      prosePatch: {
        repositories: [{
          repositoryId: firstRepository.repositoryId,
          contributors: [{ contributorId: firstContributor.contributorId }],
        }],
      },
    }).success).toBe(false);
  });

  it('enforces lifecycle and artifact consistency', () => {
    expect(reportDetailResponseSchema.safeParse({
      report: { ...detailFixture.report, status: 'processing', completedAt: detailFixture.report.completedAt },
    }).success).toBe(false);
    expect(reportDetailResponseSchema.safeParse({
      report: { ...detailFixture.report, status: 'completed', artifacts: [] },
    }).success).toBe(false);
    const firstArtifact = detailFixture.report.artifacts[0]!;
    expect(reportDetailResponseSchema.safeParse({
      report: { ...detailFixture.report, artifacts: [firstArtifact, firstArtifact] },
    }).success).toBe(false);
    for (const fileName of ['.', '..', 'report\r\nContent-Disposition: attachment', 'report\u0001.pdf']) {
      expect(reportDetailResponseSchema.safeParse({
        report: { ...detailFixture.report, artifacts: [{ ...firstArtifact, fileName }] },
      }).success).toBe(false);
    }
    expect(reportDetailResponseSchema.safeParse({
      report: { ...detailFixture.report, status: 'failed', errorMessage: null, content: null, revision: null, artifacts: [] },
    }).success).toBe(false);
    expect(reportCreateRequestSchema.safeParse({ reportDate: '2026-08-12', timezone: 'not/a-zone' }).success).toBe(false);
    expect(reportListQuerySchema.safeParse({ cursor: 'x'.repeat(2_049) }).success).toBe(false);
  });

  it('freezes mutation responses, download selection, and report error codes', () => {
    const summary = listFixture.items[0];
    expect(reportCreateResponseSchema.parse({ report: summary })).toEqual({ report: summary });
    expect(reportRevisionUpdateResponseSchema.parse(detailFixture)).toEqual(detailFixture);
    expect(reportRegenerationResponseSchema.parse(detailFixture)).toEqual(detailFixture);
    expect(reportDownloadQuerySchema.parse({ artifactId: 'artifact_pdf_1' })).toEqual({ artifactId: 'artifact_pdf_1' });
    expect(reportErrorCodeSchema.options).toEqual([
      'REPORT_NOT_FOUND',
      'REPORT_ALREADY_EXISTS',
      'REPORT_NOT_EDITABLE',
      'REPORT_REVISION_CONFLICT',
      'REPORT_ARTIFACT_NOT_FOUND',
      'REPORT_GENERATION_UNAVAILABLE',
    ]);
    expect(reportDownloadQuerySchema.safeParse({ artifactId: '../secret' }).success).toBe(false);
  });
});
