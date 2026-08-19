import {
  workspaceAnalysisResponseSchema,
  workspaceAnalysisRunSchema,
} from '../src/workspace-analysis';

describe('workspace analysis contracts', () => {
  const coverage = {
    totalFiles: 3,
    eligibleFiles: 1,
    analyzedFiles: 1,
    excludedFiles: 2,
    totalBytes: 1000,
    analyzedBytes: 300,
    truncatedFiles: 0,
  };

  it('requires immutable SHA cutoffs, bounded coverage, and honest currentness', () => {
    const run = workspaceAnalysisRunSchema.parse({
      id: 'run_1', workspaceId: 'workspace_1', repositoryId: 'repo_1', kind: 'BASELINE',
      fromSha: null, toSha: 'a'.repeat(40), dataCutoffAt: '2026-08-18T20:00:00.000Z', status: 'COMPLETED',
      coverage, accessState: 'ACTIVE', startedAt: '2026-08-18T20:00:00.000Z', completedAt: '2026-08-18T20:01:00.000Z', error: null,
    });
    expect(run.coverage?.excludedFiles).toBe(2);
    expect(() => workspaceAnalysisRunSchema.parse({ ...run, surprise: true })).toThrow();
  });

  it('represents uninitialized assignments and completed history without claiming baseline work', () => {
    const response = workspaceAnalysisResponseSchema.parse({ items: [{
      workspaceId: 'workspace_1', repositoryId: 'repo_1', repositoryFullName: 'trace/web',
      status: 'UNINITIALIZED', baselineSha: null, lastAnalyzedSha: null,
      baselineStartedAt: null, baselineCompletedAt: null, lastAnalyzedAt: null,
      accessState: 'ACTIVE', coverage: null, lastError: null, latestRun: null,
    }] });
    expect(response.items[0]?.baselineSha).toBeNull();
  });

  it('rejects invalid coverage arithmetic and unbounded errors', () => {
    expect(() => workspaceAnalysisRunSchema.parse({
      id: 'run_1', workspaceId: 'workspace_1', repositoryId: 'repo_1', kind: 'INCREMENTAL',
      fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40), dataCutoffAt: '2026-08-18T20:00:00.000Z', status: 'FAILED',
      coverage: { ...coverage, analyzedFiles: 5 }, accessState: 'ACTIVE', startedAt: null, completedAt: null, error: 'x'.repeat(501),
    })).toThrow();
  });
});
