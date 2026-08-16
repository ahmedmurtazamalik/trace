import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { FileSystemArtifactStorage, artifactStorageFromEnvironment } from '../src';

const execFileAsync = promisify(execFile);

describe('report artifact storage', () => {
  let root: string;

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'trace-storage-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('writes and reads a restrictive generation-and-attempt-scoped artifact key idempotently', async () => {
    const storage = new FileSystemArtifactStorage(root);
    const key = 'users/user_1/reports/report_1/revisions/2/generations/3/attempts/11111111-2222-4333-8444-555555555555/report.pdf';
    const bytes = Buffer.from('%PDF-1.7 trace');

    await storage.put(key, bytes);
    await storage.put(key, bytes);
    await expect(storage.get(key, 100)).resolves.toEqual(bytes);
    await expect(storage.getOptional('users/user_1/reports/report_1/revisions/3/report.pdf', 100)).resolves.toBeNull();
    const metadata = await stat(join(root, key));
    expect(metadata.mode & 0o777).toBe(0o400);
    await expect(storage.put(key, Buffer.from('different'))).rejects.toThrow('REPORT_STORAGE_FAILED');
  });

  it('terminates a hung filesystem writer when the storage deadline aborts', async () => {
    const helper = resolve(root, 'hanging-writer.cjs');
    await writeFile(helper, "const fs = require('node:fs'); const path = require('node:path'); fs.writeFileSync(path.join(process.argv[2], 'writer.pid'), String(process.pid)); process.stdin.resume(); setInterval(() => undefined, 60_000);\n", { mode: 0o500 });
    const storage = new FileSystemArtifactStorage(root, helper);
    const controller = new AbortController();
    const startedAt = Date.now();
    const key = 'users/user_1/reports/report_1/revisions/2/generations/3/attempts/11111111-2222-4333-8444-555555555555/report.pdf';
    const writing = storage.put(key, Buffer.from('%PDF-1.7 trace'), controller.signal);
    let writerPid: number | undefined;
    for (let attempt = 0; attempt < 50 && writerPid === undefined; attempt += 1) {
      try {
        writerPid = Number(await readFile(join(root, 'writer.pid'), 'utf8'));
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    }
    expect(writerPid).toBeDefined();
    controller.abort();

    await expect(writing).rejects.toThrow('REPORT_STORAGE_FAILED');
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    let processError: NodeJS.ErrnoException | undefined;
    try {
      process.kill(writerPid!, 0);
    } catch (error) {
      processError = error as NodeJS.ErrnoException;
    }
    expect(processError?.code).toBe('ESRCH');
  });

  it('rejects traversal, unexpected names, symlinks, and oversized reads', async () => {
    const storage = new FileSystemArtifactStorage(root);
    await expect(storage.put('../escape.pdf', Buffer.from('x'))).rejects.toThrow('REPORT_STORAGE_INVALID_KEY');
    await expect(storage.put('users/a/reports/a/revisions/1/arbitrary.bin', Buffer.from('x'))).rejects.toThrow('REPORT_STORAGE_INVALID_KEY');
    await storage.put('users/user_1/reports/a/revisions/1/report.pdf', Buffer.from('%PDF-1.7 trace'));
    await expect(storage.get('users/user_1/reports/a/revisions/1/report.pdf', 2)).rejects.toThrow('REPORT_STORAGE_FAILED');
    const fifoKey = 'users/user_1/reports/a/revisions/1/report.tex';
    await execFileAsync('mkfifo', [join(root, fifoKey)]);
    await expect(storage.get(fifoKey, 100)).rejects.toThrow('REPORT_STORAGE_FAILED');
    await symlink('/etc/passwd', join(root, 'link'));
    await expect(storage.get('link', 100)).rejects.toThrow('REPORT_STORAGE_INVALID_KEY');

    const redirected = join(root, 'redirected-users');
    await mkdir(redirected, { mode: 0o700 });
    await rm(join(root, 'users'), { recursive: true, force: true });
    await symlink(redirected, join(root, 'users'));
    await expect(storage.put('users/victim/reports/a/revisions/1/report.pdf', Buffer.from('x')))
      .rejects.toThrow('REPORT_STORAGE_FAILED');
  });

  it('rejects a symlinked storage root without changing its target permissions', async () => {
    const target = join(root, 'root-target');
    const symlinkRoot = join(root, 'storage-root');
    await mkdir(target, { mode: 0o755 });
    await symlink(target, symlinkRoot);
    const before = (await stat(target)).mode & 0o777;
    const storage = new FileSystemArtifactStorage(symlinkRoot);
    const key = 'users/user_1/reports/report_1/revisions/2/generations/3/attempts/11111111-2222-4333-8444-555555555555/report.pdf';

    await expect(storage.put(key, Buffer.from('%PDF-1.7 trace'))).rejects.toThrow('REPORT_STORAGE_FAILED');
    await expect(storage.getOptional(key, 100)).rejects.toThrow('REPORT_STORAGE_FAILED');
    expect((await stat(target)).mode & 0o777).toBe(before);
  });

  it('defaults storage settings only in explicit non-production modes', () => {
    expect(artifactStorageFromEnvironment({ NODE_ENV: 'test', REPORT_STORAGE_ROOT: root })).toBeInstanceOf(FileSystemArtifactStorage);
    expect(artifactStorageFromEnvironment({ NODE_ENV: 'development' })).toBeInstanceOf(FileSystemArtifactStorage);
    expect(() => artifactStorageFromEnvironment({})).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: 'prod' })).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: '' })).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: 'test', REPORT_STORAGE_DRIVER: 'unknown' })).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: 'production' })).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: 'production', REPORT_STORAGE_DRIVER: 'filesystem' })).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: 'production', REPORT_STORAGE_ROOT: root })).toThrow('REPORT_STORAGE_CONFIG');
    expect(() => artifactStorageFromEnvironment({ NODE_ENV: 'production', REPORT_STORAGE_DRIVER: 'filesystem', REPORT_STORAGE_ROOT: 'relative' })).toThrow('REPORT_STORAGE_CONFIG');
    expect(artifactStorageFromEnvironment({ NODE_ENV: 'production', REPORT_STORAGE_DRIVER: 'filesystem', REPORT_STORAGE_ROOT: root })).toBeInstanceOf(FileSystemArtifactStorage);
  });
});
