import { spawn } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const KEY_PATTERN = /^users\/[A-Za-z0-9_-]{1,128}\/reports\/[A-Za-z0-9_-]{1,128}\/revisions\/[1-9][0-9]{0,8}\/(?:generations\/[1-9][0-9]{0,8}\/attempts\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/)?report\.(?:pdf|tex)$/;
const STORAGE_FAILED = 'REPORT_STORAGE_FAILED';
const MAX_ARTIFACT_BYTES = 100_000_000;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

function artifactWriterPath(): string {
  const candidates = [
    resolve(__dirname, '../scripts/artifact-storage-write.cjs'),
    resolve(__dirname, '../../scripts/artifact-storage-write.cjs'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error('REPORT_STORAGE_CONFIG');
  return found;
}

export interface ArtifactStorage {
  put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void>;
  get(key: string, maximumBytes: number): Promise<Buffer>;
  getOptional(key: string, maximumBytes: number): Promise<Buffer | null>;
}

export class FileSystemArtifactStorage implements ArtifactStorage {
  private readonly root: string;

  constructor(root: string, private readonly writerPath = artifactWriterPath()) {
    if (!isAbsolute(root) || process.platform !== 'linux') throw new Error('REPORT_STORAGE_CONFIG');
    this.root = resolve(root);
  }

  async put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.validateKey(key);
    if (bytes.length < 1 || bytes.length > MAX_ARTIFACT_BYTES) throw new Error(STORAGE_FAILED);
    const writer = spawn(process.execPath, [this.writerPath, this.root, key], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    await new Promise<void>((resolveWrite, rejectWrite) => {
      let settled = false;
      let terminationRequested = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (error === undefined) resolveWrite();
        else rejectWrite(error);
      };
      const terminate = (): void => {
        if (terminationRequested) return;
        terminationRequested = true;
        writer.stdin.destroy();
        writer.kill('SIGKILL');
      };
      const abort = (): void => {
        terminate();
      };
      signal?.addEventListener('abort', abort, { once: true });
      writer.once('error', () => {
        terminate();
        if (writer.pid === undefined) finish(new Error(STORAGE_FAILED));
      });
      writer.stdin.once('error', () => {
        terminate();
      });
      writer.once('close', (code) => {
        if (code === 0 && signal?.aborted !== true && !terminationRequested) finish();
        else finish(new Error(STORAGE_FAILED));
      });
      if (signal?.aborted === true) abort();
      else writer.stdin.end(bytes);
    });
  }

  async get(key: string, maximumBytes: number): Promise<Buffer> {
    const bytes = await this.getOptional(key, maximumBytes);
    if (bytes === null) throw new Error(STORAGE_FAILED);
    return bytes;
  }

  async getOptional(key: string, maximumBytes: number): Promise<Buffer | null> {
    this.validateKey(key);
    if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_ARTIFACT_BYTES) {
      throw new Error(STORAGE_FAILED);
    }
    let parent: FileHandle | undefined;
    try {
      const opened = await this.openParent(key, false);
      parent = opened.parent;
      return await this.readAnchored(this.at(parent, opened.name), maximumBytes);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      throw new Error(STORAGE_FAILED);
    } finally {
      await parent?.close().catch(() => undefined);
    }
  }

  private validateKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new Error('REPORT_STORAGE_INVALID_KEY');
  }

  /**
   * Traverse each logical key directory through an already-open directory descriptor.
   * `/proc/self/fd/<fd>/child` keeps subsequent operations anchored to that inode even
   * if an attacker renames or replaces an earlier pathname component.
   */
  private async openParent(key: string, create: boolean): Promise<{ parent: FileHandle; name: string }> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    let current = await open(this.root, DIRECTORY_FLAGS);
    try {
      const rootMetadata = await current.stat();
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error(STORAGE_FAILED);
      await current.chmod(0o700);
      const parts = key.split('/');
      const name = parts.pop();
      if (name === undefined) throw new Error(STORAGE_FAILED);
      for (const part of parts) {
        const nextPath = this.at(current, part);
        if (create) {
          await mkdir(nextPath, { mode: 0o700 }).catch((error: unknown) => {
            if (!isNodeError(error, 'EEXIST')) throw error;
          });
        }
        const next = await open(nextPath, DIRECTORY_FLAGS);
        const metadata = await next.stat();
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          await next.close();
          throw new Error(STORAGE_FAILED);
        }
        const previous = current;
        current = next;
        await previous.close();
      }
      return { parent: current, name };
    } catch (error) {
      await current.close().catch(() => undefined);
      throw error;
    }
  }

  private at(parent: FileHandle, name: string): string {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error(STORAGE_FAILED);
    return `/proc/self/fd/${parent.fd}/${name}`;
  }

  private async readAnchored(path: string, maximumBytes: number): Promise<Buffer> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumBytes) {
        throw new Error(STORAGE_FAILED);
      }
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0) throw new Error(STORAGE_FAILED);
        offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
        throw new Error(STORAGE_FAILED);
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }
}

export function artifactStorageFromEnvironment(environment: NodeJS.ProcessEnv): ArtifactStorage {
  const mode = environment.NODE_ENV;
  if (mode !== 'development' && mode !== 'test' && mode !== 'production') {
    throw new Error('REPORT_STORAGE_CONFIG');
  }
  const driver = environment.REPORT_STORAGE_DRIVER;
  const root = environment.REPORT_STORAGE_ROOT;
  if (driver !== undefined && driver !== 'filesystem') throw new Error('REPORT_STORAGE_CONFIG');
  if (mode === 'production' && (driver !== 'filesystem' || root === undefined || root.length === 0)) {
    throw new Error('REPORT_STORAGE_CONFIG');
  }
  const selected = root ?? join(process.cwd(), '.trace-report-artifacts');
  if (!isAbsolute(selected)) throw new Error('REPORT_STORAGE_CONFIG');
  return new FileSystemArtifactStorage(selected);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as NodeJS.ErrnoException).code === code;
}
