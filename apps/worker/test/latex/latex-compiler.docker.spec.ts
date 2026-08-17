import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DockerLatexCompiler } from '../../src/latex/latex-compiler';
import { renderReportLatex } from '../../src/latex/report-latex-renderer';

const execFileAsync = promisify(execFile);

const runDocker = process.env.RUN_DOCKER_LATEX === '1';
const dockerImage = process.env.REPORT_LATEX_TEST_IMAGE;
if (runDocker && !dockerImage) {
  throw new Error('REPORT_LATEX_TEST_IMAGE must name the freshly built candidate image');
}
const dockerTest = runDocker ? it : it.skip;
const candidateImage = dockerImage ?? 'docker-test-not-enabled';

describe('Docker LaTeX compiler acceptance', () => {
  dockerTest('compiles the controlled Trace template into a real PDF under the runtime sandbox', async () => {
    const snapshot = {
      version: 1,
      reportDate: '2026-08-13',
      timezone: 'UTC',
      facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 4, additions: 20, deletions: 5 },
      repositories: [{
        id: 'repo_1', fullName: 'trace/backend',
        facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 4, additions: 20, deletions: 5 },
        contributors: [{
          id: 'person_1', username: 'person', displayName: 'Person & Teammate',
          facts: { repositoryCount: 1, contributorCount: 1, commitCount: 2, filesChanged: 4, additions: 20, deletions: 5 },
        }],
        evidence: [{ activityId: 'activity_1', occurredAt: '2026-08-13T10:00:00.000Z', type: 'commit', sha: 'a'.repeat(40), message: 'Ship report' }],
      }],
    };
    const content = {
      executiveSummary: 'Safe % summary with \\write18{touch /tmp/pwned}.',
      repositories: [{
        repositoryId: 'repo_1', summary: 'Backend report.',
        contributors: [{ contributorId: 'person_1', summary: 'Contributed safely.', accomplishments: [] }],
      }],
    };
    const source = renderReportLatex(snapshot, content, 1);
    const compiler = new DockerLatexCompiler({ image: candidateImage, timeoutMs: 60_000 });
    const pdf = await compiler.compile(source);
    const repeated = await compiler.compile(source);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(repeated).toEqual(pdf);
  }, 150_000);

  dockerTest('waits for forced timeout cleanup and leaves no named compiler container', async () => {
    const compiler = new DockerLatexCompiler({ image: candidateImage, timeoutMs: 1_000 });
    const slowSource = String.raw`\documentclass{article}
\begin{document}
\newcount\counter
\counter=0
\loop\advance\counter by 1\ifnum\counter<100000000\repeat
Done
\end{document}`;
    await expect(compiler.compile(slowSource)).rejects.toThrow('REPORT_COMPILE_FAILED');
    const { stdout } = await execFileAsync('docker', [
      'ps', '--all', '--filter', 'name=^/trace-latex-', '--format', '{{.Names}}',
    ]);
    expect(stdout.trim()).toBe('');
  }, 30_000);
});
