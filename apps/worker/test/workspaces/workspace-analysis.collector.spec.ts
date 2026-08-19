import {
  isContinuousComparisonStatus,
  isWorkspaceAnalysisBinaryContent,
  isWorkspaceAnalysisBinaryPath,
} from '../../src/workspaces/workspace-analysis.collector';

describe('Workspace analysis comparison continuity', () => {
  it.each(['ahead', 'identical'])('accepts %s as proven continuity', (status) => {
    expect(isContinuousComparisonStatus(status)).toBe(true);
  });

  it.each(['behind', 'diverged', null, undefined, 'unknown'])('rejects %p as unproven continuity', (status) => {
    expect(isContinuousComparisonStatus(status)).toBe(false);
  });
});

describe('Workspace analysis binary exclusions', () => {
  it.each([
    'docs/CoachConnect-Project-Report.docx',
    'docs/project.xlsx',
    'docs/slides.pptx',
    'assets/module.wasm',
  ])('excludes %s before requesting blob content', (path) => {
    expect(isWorkspaceAnalysisBinaryPath(path)).toBe(true);
  });

  it('treats NUL-containing content as binary even when the extension is unknown', () => {
    expect(isWorkspaceAnalysisBinaryContent(Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
    expect(isWorkspaceAnalysisBinaryContent(Buffer.from('const value = 1;'))).toBe(false);
  });
});
