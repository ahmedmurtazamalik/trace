import { escapeLatex, renderReportLatex } from '../../src/latex/report-latex-renderer';
import type { ReportInputSnapshot } from '../../src/reports/report-provider';

const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-13',
  timezone: 'Asia/Karachi',
  facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 3, additions: 11, deletions: 4 },
  repositories: [{
    id: 'repo_1',
    fullName: 'neodym/trace_100%',
    facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 3, additions: 11, deletions: 4 },
    contributors: [{
      id: 'contributor_1',
      username: 'joey_dev',
      displayName: 'Joey & Co.',
      facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 3, additions: 11, deletions: 4 },
    }],
    evidence: [{
      activityId: 'activity_1',
      occurredAt: '2026-08-13T10:00:00.000Z',
      type: 'commit',
      sha: 'a'.repeat(40),
      message: 'Escape 50% of #1_{x} & \\input{/etc/passwd}',
    }],
  }],
};

const content = {
  executiveSummary: 'Built \\input{/etc/passwd} & 50% of #1_{x}.\nSecond paragraph.',
  repositories: [{
    repositoryId: 'repo_1',
    summary: 'Improved $rendering$ with ~safe^ text.',
    contributors: [{
      contributorId: 'contributor_1',
      summary: 'Shipped {renderer} and fixed \\ paths.',
      accomplishments: ['Added #1 PDF', 'Kept facts & prose separate'],
    }],
  }],
};

describe('Trace LaTeX report renderer', () => {
  it('renders the approved midnight-blue/teal report style deterministically', () => {
    const first = renderReportLatex(snapshot, content, 1);
    const second = renderReportLatex(snapshot, content, 1);

    expect(first).toBe(second);
    expect(first).toContain('\\definecolor{primarycolor}{RGB}{0, 51, 102}');
    expect(first).toContain('\\definecolor{secondarycolor}{RGB}{0, 128, 128}');
    expect(first).toContain('\\usepackage{palatino}');
    expect(first).toContain('\\begin{titlepage}');
    expect(first).toContain('Engineering Activity Report');
    expect(first).toContain('Revision 1');
    expect(first).toContain('Repositories & 1');
    expect(first).toContain('Commits & 2');
  });

  it('escapes every untrusted LaTeX metacharacter without exposing commands', () => {
    const latex = renderReportLatex(snapshot, content, 1);

    expect(latex).not.toContain('\\input{/etc/passwd}');
    expect(latex).toContain('\\textbackslash{}input\\{/etc/passwd\\}');
    expect(latex).toContain('50\\%');
    expect(latex).toContain('\\#1\\_\\{x\\}');
    expect(latex).toContain('Joey \\& Co.');
    expect(latex).toContain('\\textasciitilde{}safe\\textasciicircum{} text');
    expect(latex).toContain('Second paragraph.');
  });

  it('rejects C0, DEL, and C1 controls while preserving supported whitespace', () => {
    expect(() => escapeLatex('bad\u0000value')).toThrow('REPORT_RENDER_INVALID');
    expect(() => escapeLatex('bad\u007fvalue')).toThrow('REPORT_RENDER_INVALID');
    expect(() => escapeLatex('bad\u0085value')).toThrow('REPORT_RENDER_INVALID');
    expect(escapeLatex('tab\tline\nnext')).toContain('tab\tline');
  });

  it('rejects invalid revision numbers and output beyond the compiler boundary', () => {
    expect(() => renderReportLatex(snapshot, content, 0)).toThrow('REPORT_RENDER_INVALID');
    const oversized = {
      ...content,
      executiveSummary: 'a'.repeat(20_000),
      repositories: Array.from({ length: 100 }, (_, repositoryIndex) => ({
        repositoryId: `repo_${repositoryIndex}`,
        summary: 'b'.repeat(10_000),
        contributors: [],
      })),
    };
    expect(() => renderReportLatex(snapshot, oversized, 1)).toThrow('REPORT_RENDER_INVALID');
  });
});
