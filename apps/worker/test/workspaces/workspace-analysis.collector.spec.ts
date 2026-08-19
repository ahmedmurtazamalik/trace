import { isContinuousComparisonStatus } from '../../src/workspaces/workspace-analysis.collector';

describe('Workspace analysis comparison continuity', () => {
  it.each(['ahead', 'identical'])('accepts %s as proven continuity', (status) => {
    expect(isContinuousComparisonStatus(status)).toBe(true);
  });

  it.each(['behind', 'diverged', null, undefined, 'unknown'])('rejects %p as unproven continuity', (status) => {
    expect(isContinuousComparisonStatus(status)).toBe(false);
  });
});
