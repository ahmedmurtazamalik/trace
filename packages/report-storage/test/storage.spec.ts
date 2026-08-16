import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FileSystemArtifactStorage, artifactStorageFromEnvironment } from '../src';

const execFileAsync = promisify(execFile);

describe('report artifact storage', () => {
  let root: string;

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'trace-storage-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('writes and reads a restrictive generation-scoped artifact key idempotently', async () => {
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
