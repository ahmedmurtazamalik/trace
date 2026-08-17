import { Buffer } from 'node:buffer';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DockerLatexCompiler, validateCompiledPdf, type ProcessRunner } from '../../src/latex/latex-compiler';

let pdf: Buffer;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 200]);
  pdf = Buffer.from(await document.save({ useObjectStreams: false }));
});

describe('bounded LaTeX compiler', () => {
  it('uses a fixed no-network Docker boundary and returns a real bounded PDF', async () => {
    const calls: Array<{ command: string; arguments_: string[]; timeoutMs: number }> = [];
    const runner: ProcessRunner = async (command, arguments_, options) => {
      calls.push({ command, arguments_, timeoutMs: options.timeoutMs });
      await options.prepareOutput(pdf);
    };
    const compiler = new DockerLatexCompiler({ image: 'trace-latex:test', runner, timeoutMs: 12_000 });

    await expect(compiler.compile('\\documentclass{article}\\begin{document}Trace\\end{document}')).resolves.toEqual(pdf);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('docker');
    expect(calls[0]?.arguments_).toEqual(expect.arrayContaining([
      'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--pids-limit', '64',
      '--memory', '512m', '--cpus', '1', '--security-opt', 'no-new-privileges', '--user', '65532:65532', '--env', 'HOME=/tmp',
      '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=32m,mode=1777', 'trace-latex:test',
      '/input/report.tex', '/output/report.pdf',
    ]));
    expect(calls[0]?.arguments_.some((argument) => argument.endsWith('dst=/input/report.tex,readonly'))).toBe(true);
    expect(calls[0]?.arguments_.some((argument) => argument.endsWith('dst=/output'))).toBe(true);
    expect(calls[0]?.arguments_).not.toContain('sh');
    expect(calls[0]?.timeoutMs).toBe(12_000);
  });

  it('uses an explicit absolute host-shared working root for Docker bind mounts', async () => {
    const workingRoot = await mkdtemp(join(tmpdir(), 'trace-latex-root-test-'));
    const calls: string[][] = [];
    const runner: ProcessRunner = async (_command, arguments_, options) => {
      calls.push(arguments_);
      await options.prepareOutput(pdf);
    };
    try {
      const compiler = new DockerLatexCompiler({ image: 'trace-latex:test', workingRoot, runner });
      await expect(compiler.compile('safe')).resolves.toEqual(pdf);
      const mounts = calls[0]?.filter((argument) => argument.startsWith('type=bind,src=')) ?? [];
      expect(mounts).toHaveLength(2);
      expect(mounts.every((mount) => mount.startsWith(`type=bind,src=${workingRoot}/trace-latex-`))).toBe(true);
      expect(() => new DockerLatexCompiler({ image: 'trace-latex:test', workingRoot: 'relative/path' }))
        .toThrow('REPORT_COMPILE_CONFIG');
    } finally {
      await rm(workingRoot, { recursive: true, force: true });
    }
  });

  it('rejects malformed, prefixed, empty, or oversized compiler output', async () => {
    await expect(validateCompiledPdf(Buffer.from('not a pdf'))).rejects.toThrow('REPORT_COMPILE_FAILED');
    await expect(validateCompiledPdf(Buffer.from('%PDF-not actually a PDF\n%%EOF'))).rejects.toThrow('REPORT_COMPILE_FAILED');
    await expect(validateCompiledPdf(Buffer.alloc(0))).rejects.toThrow('REPORT_COMPILE_FAILED');
    await expect(validateCompiledPdf(Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(20 * 1024 * 1024)]))).rejects.toThrow('REPORT_COMPILE_FAILED');
  });

  it('rejects symlinked and oversized compiler output before reading bytes', async () => {
    const symlinkRunner: ProcessRunner = async (_command, arguments_) => {
      const mount = arguments_.find((argument) => argument.startsWith('type=bind,src=') && argument.endsWith(',dst=/output'));
      const outputDirectory = mount?.slice('type=bind,src='.length, -',dst=/output'.length);
      if (outputDirectory === undefined) throw new Error('missing output mount');
      await symlink('/etc/passwd', join(outputDirectory, 'report.pdf'));
    };
    await expect(new DockerLatexCompiler({ image: 'trace-latex:test', runner: symlinkRunner })
      .compile('safe')).rejects.toThrow('REPORT_COMPILE_FAILED');

    const oversizedRunner: ProcessRunner = async (_command, _arguments, options) => {
      await options.prepareOutput(Buffer.alloc(20 * 1024 * 1024 + 1));
    };
    await expect(new DockerLatexCompiler({ image: 'trace-latex:test', runner: oversizedRunner })
      .compile('safe')).rejects.toThrow('REPORT_COMPILE_FAILED');
  });

  it('rejects unsafe image names and oversized source before process execution', async () => {
    expect(() => new DockerLatexCompiler({ image: 'image; touch /tmp/pwned' })).toThrow('REPORT_COMPILE_CONFIG');
    const compiler = new DockerLatexCompiler({ image: 'trace-latex:test', runner: jest.fn() });
    await expect(compiler.compile('x'.repeat(2 * 1024 * 1024 + 1))).rejects.toThrow('REPORT_COMPILE_FAILED');
    expect(compiler).toBeDefined();
  });
});
