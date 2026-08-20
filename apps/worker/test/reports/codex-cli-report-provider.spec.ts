import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexProcessRequest } from '../../src/reports/codex-cli-report-provider';
import {
  CodexCLIReportProvider,
  reportProviderFromEnvironment,
  runCodexProcess,
} from '../../src/reports/codex-cli-report-provider';
import type { ReportInputSnapshot } from '../../src/reports/report-provider';

const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-20',
  timezone: 'UTC',
  facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  repositories: [],
};

const validContent = { executiveSummary: 'No development commits were recorded for 2026-08-20.', repositories: [] };

function outputPath(request: CodexProcessRequest): string {
  return request.args[request.args.indexOf('--output-last-message') + 1]!;
}

function schemaPath(request: CodexProcessRequest): string {
  return request.args[request.args.indexOf('--output-schema') + 1]!;
}

describe('Codex CLI structured report provider', () => {
  it('runs a subprocess with prompt data on stdin without shell interpolation', async () => {
    await expect(runCodexProcess({
      command: process.execPath,
      args: ['-e', 'process.stdin.on("data", () => undefined); process.stdin.on("end", () => process.exit(0));'],
      input: 'snapshot text; $(touch /tmp/trace-codex-shell-injection)',
      timeoutMs: 5_000,
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH },
    })).resolves.toEqual({ exitCode: 0 });
    expect(existsSync('/tmp/trace-codex-shell-injection')).toBe(false);
  });

  it('terminates the Codex process group when the configured timeout expires', async () => {
    await expect(runCodexProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => undefined, 1000)'],
      input: '',
      timeoutMs: 100,
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH },
    })).rejects.toThrow('REPORT_PROVIDER_TIMEOUT');
  });

  it('terminates a process while its output file exceeds the configured bound', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'trace-codex-output-bound-'));
    const outputFilePath = join(directory, 'response.json');
    writeFileSync(outputFilePath, '', { mode: 0o600 });
    try {
      await expect(runCodexProcess({
        command: process.execPath,
        args: ['-e', `const fs=require('node:fs'); setInterval(() => fs.appendFileSync(${JSON.stringify(outputFilePath)}, 'x'.repeat(4096)), 5)`],
        input: '',
        timeoutMs: 2_000,
        cwd: directory,
        environment: { PATH: process.env.PATH },
        outputFilePath,
        maximumOutputBytes: 1_024,
      })).rejects.toThrow('REPORT_PROVIDER_RESPONSE_TOO_LARGE');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('terminates process-group descendants after a successful direct-child exit', async () => {
    const marker = join(tmpdir(), `trace-codex-orphan-${process.pid}-${Date.now()}`);
    rmSync(marker, { force: true });
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 350)`;
    const launcher = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); child.unref()`;
    await expect(runCodexProcess({
      command: process.execPath,
      args: ['-e', launcher],
      input: '',
      timeoutMs: 1_000,
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH },
    })).resolves.toEqual({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(marker)).toBe(false);
  });

  it('returns a closed error when the Codex executable is missing', async () => {
    await expect(runCodexProcess({
      command: '/definitely-missing-trace-codex',
      args: [],
      input: '',
      timeoutMs: 1_000,
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH },
    })).rejects.toThrow('REPORT_PROVIDER_EXECUTABLE_MISSING');
  });

  it('classifies sanitized Codex authentication failures as permanent', async () => {
    const provider = new CodexCLIReportProvider({
      command: 'codex', model: 'model', timeoutMs: 25_000,
      runner: () => Promise.resolve({ exitCode: 1, stderr: 'Error: not logged in; run codex login' }),
    });
    await expect(provider.generate(snapshot)).rejects.toThrow('REPORT_PROVIDER_AUTH');
  });

  it('selects only fake or Codex providers from explicit environment configuration', () => {
    expect(reportProviderFromEnvironment({ REPORT_LLM_PROVIDER: 'fake' }).constructor.name)
      .toBe('DeterministicReportProvider');
    expect(reportProviderFromEnvironment({ REPORT_LLM_PROVIDER: 'codex' }).constructor.name)
      .toBe('CodexCLIReportProvider');
    expect(() => reportProviderFromEnvironment({ REPORT_LLM_PROVIDER: 'configured' }))
      .toThrow('Invalid report provider configuration.');
    expect(() => reportProviderFromEnvironment({
      REPORT_LLM_PROVIDER: 'codex',
      REPORT_CODEX_TIMEOUT_MS: '999',
    })).toThrow('Invalid report provider configuration.');
  });

  it('rejects oversized prompts before starting Codex', async () => {
    const runner = jest.fn();
    const provider = new CodexCLIReportProvider({
      command: 'codex', model: 'model', timeoutMs: 25_000, runner, maximumPromptBytes: 100,
    });

    await expect(provider.generate(snapshot)).rejects.toThrow('REPORT_PROVIDER_REQUEST_TOO_LARGE');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects oversized response files without a repair attempt', async () => {
    const runner = jest.fn((request: CodexProcessRequest) => {
      writeFileSync(outputPath(request), 'x'.repeat(101));
      return Promise.resolve({ exitCode: 0 });
    });
    const provider = new CodexCLIReportProvider({
      command: 'codex', model: 'model', timeoutMs: 25_000, runner, maximumResponseBytes: 100,
    });

    await expect(provider.generate(snapshot)).rejects.toThrow('REPORT_PROVIDER_RESPONSE_TOO_LARGE');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('runs one isolated schema-constrained Codex process and returns its final JSON response', async () => {
    const calls: CodexProcessRequest[] = [];
    let capturedSchema: unknown;
    let capturedOutputMode: number | undefined;
    const runner = jest.fn((request: CodexProcessRequest) => {
      calls.push(request);
      capturedSchema = JSON.parse(readFileSync(schemaPath(request), 'utf8')) as unknown;
      capturedOutputMode = statSync(outputPath(request)).mode & 0o777;
      writeFileSync(outputPath(request), JSON.stringify(validContent));
      return Promise.resolve({ exitCode: 0 });
    });
    const provider = new CodexCLIReportProvider({
      command: '/opt/codex',
      model: 'gpt-5.6-sol-test',
      timeoutMs: 25_000,
      runner,
      environment: {
        PATH: '/usr/bin',
        HOME: '/home/trace',
        CODEX_HOME: '/var/lib/trace/codex',
        DATABASE_URL: 'must-not-reach-codex',
        GITHUB_APP_PRIVATE_KEY: 'must-not-reach-codex',
      },
    });

    await expect(provider.generate(snapshot)).resolves.toEqual(validContent);
    expect(runner).toHaveBeenCalledTimes(1);
    const request = calls[0]!;
    expect(request.args.slice(0, 2)).toEqual(['exec', '--ephemeral']);
    expect(request.args).toEqual(expect.arrayContaining([
      '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check',
      '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps',
      '--disable', 'browser_use', '--disable', 'computer_use', '--disable', 'code_mode_host',
      '--disable', 'image_generation', '--disable', 'multi_agent', '--disable', 'plugins',
      '--disable', 'skill_search', '--disable', 'tool_suggest',
      '--model', 'gpt-5.6-sol-test', '--output-schema', schemaPath(request),
      '--output-last-message', outputPath(request), '-',
    ]));
    expect(request.command).toBe('/opt/codex');
    expect(request.timeoutMs).toBe(25_000);
    expect(request.environment).toMatchObject({
      PATH: '/usr/bin', HOME: '/home/trace', CODEX_HOME: '/var/lib/trace/codex', TMPDIR: request.cwd,
    });
    expect(request.environment).not.toHaveProperty('DATABASE_URL');
    expect(request.environment).not.toHaveProperty('GITHUB_APP_PRIVATE_KEY');
    expect(request.outputFilePath).toBe(outputPath(request));
    expect(request.maximumOutputBytes).toBe(1_000_000);
    expect(capturedOutputMode).toBe(0o600);
    expect(request.input).toContain('No development commits were recorded for 2026-08-20.');
    expect(request.input).toContain('Return only the schema-conforming final response.');
    expect(capturedSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(existsSync(request.cwd)).toBe(false);
  });

  it('makes exactly one schema-repair attempt after invalid Codex output', async () => {
    let call = 0;
    const prompts: string[] = [];
    const runner = jest.fn((request: CodexProcessRequest) => {
      prompts.push(request.input);
      writeFileSync(outputPath(request), call++ === 0 ? 'not JSON' : JSON.stringify(validContent));
      return Promise.resolve({ exitCode: 0 });
    });
    const provider = new CodexCLIReportProvider({ command: 'codex', model: 'model', timeoutMs: 25_000, runner });

    await expect(provider.generate(snapshot)).resolves.toEqual(validContent);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain('Repair the previous invalid response');
  });

  it('aliases internal identifiers before disclosure and restores them in the response', async () => {
    const sensitiveSnapshot: ReportInputSnapshot = {
      version: 1,
      reportDate: '2026-08-20',
      timezone: 'UTC',
      facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 1, additions: 2, deletions: 1 },
      repositories: [{
        id: 'internal-repository-id',
        fullName: 'private-owner/private-repository',
        facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 1, additions: 2, deletions: 1 },
        contributors: [{
          id: 'internal-contributor-id', username: 'developer', displayName: 'Developer',
          facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 1, additions: 2, deletions: 1 },
        }],
        evidence: [{
          activityId: 'internal-activity-id', occurredAt: '2026-08-20T10:00:00.000Z', type: 'commit',
          sha: 'a'.repeat(40), message: 'Implement private feature',
        }],
      }],
    };
    let outboundPrompt = '';
    const runner = jest.fn((request: CodexProcessRequest) => {
      outboundPrompt = request.input;
      const requiredContentText = request.input.match(/^Required content: (.+)$/m)?.[1];
      if (requiredContentText === undefined) throw new Error('Missing required content.');
      writeFileSync(outputPath(request), requiredContentText);
      return Promise.resolve({ exitCode: 0 });
    });
    const provider = new CodexCLIReportProvider({ command: 'codex', model: 'model', timeoutMs: 25_000, runner });

    const output = await provider.generate(sensitiveSnapshot) as {
      repositories: Array<{ repositoryId: string; contributors: Array<{ contributorId: string }> }>;
    };

    expect(output.repositories[0]).toMatchObject({
      repositoryId: 'internal-repository-id',
      contributors: [{ contributorId: 'internal-contributor-id' }],
    });
    expect(outboundPrompt).not.toContain('internal-repository-id');
    expect(outboundPrompt).not.toContain('internal-contributor-id');
    expect(outboundPrompt).not.toContain('internal-activity-id');
    expect(outboundPrompt).not.toContain('a'.repeat(40));
    expect(outboundPrompt).toContain('private-owner/private-repository');
    expect(outboundPrompt).toContain('Implement private feature');
  });
});
