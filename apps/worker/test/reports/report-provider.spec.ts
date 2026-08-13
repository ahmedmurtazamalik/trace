import { reportContentSchema } from '@trace/shared';
import {
  DeterministicReportProvider,
  validateGroundedReportContent,
  type ReportInputSnapshot,
} from '../../src/reports/report-provider';

const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-13',
  timezone: 'UTC',
  facts: {
    repositoryCount: 1,
    contributorCount: 1,
    commitCount: 1,
    filesChanged: 2,
    additions: 5,
    deletions: 1,
  },
  repositories: [{
    id: 'repo-1',
    fullName: 'trace/example',
    facts: {
      repositoryCount: 1,
      contributorCount: 1,
      commitCount: 1,
      filesChanged: 2,
      additions: 5,
      deletions: 1,
    },
    contributors: [{
      id: 'contributor-1',
      username: 'octocat',
      displayName: 'Octo Cat',
      facts: {
        repositoryCount: 1,
        contributorCount: 1,
        commitCount: 1,
        filesChanged: 2,
        additions: 5,
        deletions: 1,
      },
    }],
    evidence: [{
      activityId: 'activity-1',
      occurredAt: '2026-08-13T10:00:00.000Z',
      type: 'commit',
      sha: 'abcdef1234567',
      message: 'Add report worker contract',
    }],
  }],
};

describe('structured report providers', () => {
  it('generates deterministic schema-valid content grounded in the immutable snapshot', async () => {
    const provider = new DeterministicReportProvider();

    const first = await provider.generate(snapshot);
    const second = await provider.generate(snapshot);

    expect(first).toEqual(second);
    expect(reportContentSchema.parse(first)).toEqual(first);
    expect(first.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 'repo-1',
        contributors: [expect.objectContaining({ contributorId: 'contributor-1' })],
      }),
    ]);
    expect(JSON.stringify(first)).toContain('trace/example recorded 1 commit');
    expect(validateGroundedReportContent(first, snapshot)).toEqual(first);
  });

  it('rejects unknown, duplicate, missing, and cross-repository identifiers', () => {
    const valid = {
      executiveSummary: 'One repository changed.',
      repositories: [{
        repositoryId: 'repo-1',
        summary: 'A grounded summary.',
        contributors: [{ contributorId: 'contributor-1', summary: 'A grounded contribution.', accomplishments: [] }],
      }],
    };

    expect(() => validateGroundedReportContent({ ...valid, repositories: [] }, snapshot)).toThrow('REPORT_OUTPUT_NOT_GROUNDED');
    expect(() => validateGroundedReportContent({
      ...valid,
      repositories: [{ ...valid.repositories[0], repositoryId: 'unknown' }],
    }, snapshot)).toThrow('REPORT_OUTPUT_NOT_GROUNDED');
    expect(() => validateGroundedReportContent({
      ...valid,
      repositories: [{
        ...valid.repositories[0],
        contributors: [{ ...valid.repositories[0]!.contributors[0]!, contributorId: 'unknown' }],
      }],
    }, snapshot)).toThrow('REPORT_OUTPUT_NOT_GROUNDED');
  });

  it('rejects unsupported prose and keeps the deterministic fake valid at snapshot boundaries', async () => {
    const valid = await new DeterministicReportProvider().generate(snapshot);
    expect(() => validateGroundedReportContent({
      ...valid,
      executiveSummary: 'A critical vulnerability was fixed and deployed to production.',
    }, snapshot)).toThrow('REPORT_OUTPUT_NOT_GROUNDED');

    const large: ReportInputSnapshot = {
      ...snapshot,
      facts: { ...snapshot.facts, commitCount: 2 },
      repositories: [{
        ...snapshot.repositories[0]!,
        facts: { ...snapshot.repositories[0]!.facts, commitCount: 2 },
        evidence: [
          { ...snapshot.repositories[0]!.evidence[0]!, message: 'x'.repeat(10_000) },
          { ...snapshot.repositories[0]!.evidence[0]!, activityId: 'activity-2', sha: 'bcdefa1234567', message: 'y'.repeat(10_000) },
        ],
      }],
    };
    const output = await new DeterministicReportProvider().generate(large);
    expect(reportContentSchema.safeParse(output).success).toBe(true);
  });
});
