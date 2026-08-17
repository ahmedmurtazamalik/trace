import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

export const MAX_LATEX_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const COMPILE_FAILED = 'REPORT_COMPILE_FAILED';

export interface ProcessRunnerOptions {
  timeoutMs: number;
  prepareOutput(bytes: Buffer): Promise<void>;
}

export type ProcessRunner = (
  command: string,
  arguments_: string[],
  options: ProcessRunnerOptions,
) => Promise<void>;

export interface LatexCompiler {
  compile(source: string): Promise<Buffer>;
}

export interface DockerLatexCompilerOptions {
  image: string;
  timeoutMs?: number;
  workingRoot?: string;
  runner?: ProcessRunner;
}

export class DockerLatexCompiler implements LatexCompiler {
  private readonly timeoutMs: number;
  private readonly workingRoot: string;
  private readonly runner: ProcessRunner;

  constructor(private readonly options: DockerLatexCompilerOptions) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?:@sha256:[a-f0-9]{64})?$/.test(options.image)) {
      throw new Error('REPORT_COMPILE_CONFIG');
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
      throw new Error('REPORT_COMPILE_CONFIG');
    }
    this.workingRoot = options.workingRoot ?? tmpdir();
    if (!isAbsolute(this.workingRoot)) throw new Error('REPORT_COMPILE_CONFIG');
    this.runner = options.runner ?? spawnRunner;
  }

  async compile(source: string): Promise<Buffer> {
    if (Buffer.byteLength(source, 'utf8') > MAX_LATEX_BYTES) throw new Error(COMPILE_FAILED);
    await mkdir(this.workingRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.workingRoot, 'trace-latex-'));
    const inputDirectory = join(directory, 'input');
    const outputDirectory = join(directory, 'output');
    const inputPath = join(inputDirectory, 'report.tex');
    const outputPath = join(outputDirectory, 'report.pdf');
    const containerName = `trace-latex-${randomUUID()}`;
    const uid = 65_532;
    const gid = 65_532;
    try {
      await mkdir(inputDirectory, { mode: 0o700 });
      await mkdir(outputDirectory, { mode: 0o733 });
      await chmod(outputDirectory, 0o733);
      await writeFile(inputPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o444 });
      const arguments_ = [
        'run', '--rm', '--name', containerName,
        '--network', 'none',
        '--read-only',
        '--cap-drop', 'ALL',
        '--pids-limit', '64',
        '--memory', '512m',
        '--cpus', '1',
        '--security-opt', 'no-new-privileges',
        '--user', `${uid}:${gid}`,
        '--env', 'HOME=/tmp',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
        '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=32m,mode=1777',
        '--mount', `type=bind,src=${inputPath},dst=/input/report.tex,readonly`,
        '--mount', `type=bind,src=${outputDirectory},dst=/output`,
        '--workdir', '/work',
        this.options.image,
        '/input/report.tex', '/output/report.pdf',
      ];
      await this.runner('docker', arguments_, {
        timeoutMs: this.timeoutMs,
        prepareOutput: (bytes) => writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 }),
      });
      const pdf = await readBoundedRegularFile(outputPath, MAX_PDF_BYTES);
      return await validateCompiledPdf(pdf);
    } catch {
      throw new Error(COMPILE_FAILED);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumBytes) {
      throw new Error(COMPILE_FAILED);
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new Error(COMPILE_FAILED);
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
      throw new Error(COMPILE_FAILED);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function validateCompiledPdf(pdf: Buffer): Promise<Buffer> {
  if (pdf.length < 12 || pdf.length > MAX_PDF_BYTES || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error(COMPILE_FAILED);
  }
  const tail = pdf.subarray(Math.max(0, pdf.length - 1_024)).toString('latin1');
  if (!/%%EOF\s*$/.test(tail)) throw new Error(COMPILE_FAILED);
  try {
    const document = await PDFDocument.load(pdf, {
      ignoreEncryption: false,
      parseSpeed: 20,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const pages = document.getPageCount();
    if (pages < 1 || pages > 10_000) throw new Error(COMPILE_FAILED);
  } catch {
    throw new Error(COMPILE_FAILED);
  }
  return pdf;
}

const spawnRunner: ProcessRunner = (command, arguments_, options) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, arguments_, {
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  let settled = false;
  let timedOut = false;
  let cleanupStarted = false;
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error === undefined) resolve();
    else reject(error);
  };
  const cleanupTimedOutContainer = (): void => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    const nameIndex = arguments_.indexOf('--name');
    const containerName = nameIndex >= 0 ? arguments_[nameIndex + 1] : undefined;
    if (command !== 'docker' || containerName === undefined || !/^trace-latex-[a-f0-9-]+$/.test(containerName)) {
      finish(new Error(COMPILE_FAILED));
      return;
    }
    void removeContainer(containerName)
      .then(() => finish(new Error(COMPILE_FAILED)))
      .catch(() => finish(new Error(COMPILE_FAILED)));
  };
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
    // Let the Docker client close its daemon request before removing by name.
    setTimeout(cleanupTimedOutContainer, 100);
  }, options.timeoutMs);
  child.once('error', () => {
    if (timedOut) cleanupTimedOutContainer();
    else finish(new Error(COMPILE_FAILED));
  });
  child.once('exit', (code, signal) => {
    if (timedOut) {
      cleanupTimedOutContainer();
      return;
    }
    if (code === 0 && signal === null) finish();
    else finish(new Error(COMPILE_FAILED));
  });
});

async function removeContainer(containerName: string): Promise<void> {
  const removed = await runDockerCommand(['rm', '-f', containerName], 5_000);
  if (removed.code !== 0 && !/No such (?:object|container)/i.test(removed.stderr)) {
    throw new Error(COMPILE_FAILED);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inspected = await runDockerCommand(['container', 'inspect', containerName], 5_000);
    if (inspected.code === 0 || !/No such (?:object|container)/i.test(inspected.stderr)) {
      throw new Error(COMPILE_FAILED);
    }
    if (attempt === 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
}

function runDockerCommand(arguments_: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('docker', arguments_, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    let stderr = '';
    let settled = false;
    const finish = (result?: { code: number; stderr: string }, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) rejectCommand(error);
      else if (result !== undefined) resolveCommand(result);
      else rejectCommand(new Error(COMPILE_FAILED));
    };
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 4_096) stderr += chunk.slice(0, 4_096 - stderr.length);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(undefined, new Error(COMPILE_FAILED));
    }, timeoutMs);
    child.once('error', () => finish(undefined, new Error(COMPILE_FAILED)));
    child.once('exit', (code) => finish({ code: code ?? -1, stderr }));
  });
}
