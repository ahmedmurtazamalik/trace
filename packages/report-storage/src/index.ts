import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, mkdir, open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const KEY_PATTERN = /^users\/[A-Za-z0-9_-]{1,128}\/reports\/[A-Za-z0-9_-]{1,128}\/revisions\/[1-9][0-9]{0,8}\/(?:generations\/[1-9][0-9]{0,8}\/attempts\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/)?report\.(?:pdf|tex)$/;
const STORAGE_FAILED = 'REPORT_STORAGE_FAILED';
const MAX_ARTIFACT_BYTES = 100_000_000;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

export interface ArtifactStorage {
  put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void>;
  get(key: string, maximumBytes: number): Promise<Buffer>;
  getOptional(key: string, maximumBytes: number): Promise<Buffer | null>;
}

export class FileSystemArtifactStorage implements ArtifactStorage {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root) || process.platform !== 'linux') throw new Error('REPORT_STORAGE_CONFIG');
    this.root = resolve(root);
  }

  async put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.validateKey(key);
    if (bytes.length < 1 || bytes.length > MAX_ARTIFACT_BYTES) throw new Error(STORAGE_FAILED);
    let parent: FileHandle | undefined;
    let temporary: string | undefined;
    try {
      const opened = await this.openParent(key, true);
      signal?.throwIfAborted();
      parent = opened.parent;
      const destination = this.at(parent, opened.name);
      temporary = this.at(parent, `.${randomUUID()}.tmp`);
      const handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(bytes, { signal });
        signal?.throwIfAborted();
        await handle.sync();
        signal?.throwIfAborted();
        await handle.chmod(0o400);
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== bytes.length) {
          throw new Error(STORAGE_FAILED);
        }
      } finally {
        await handle.close();
      }
      try {
        signal?.throwIfAborted();
        await link(temporary, destination);
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
        const existing = await this.readAnchored(destination, MAX_ARTIFACT_BYTES);
        if (!existing.equals(bytes)) throw new Error(STORAGE_FAILED);
      }
    } catch {
      throw new Error(STORAGE_FAILED);
    } finally {
      if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
      await parent?.close().catch(() => undefined);
    }
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
    await chmod(this.root, 0o700);
    let current = await open(this.root, DIRECTORY_FLAGS);
    try {
      const rootMetadata = await current.stat();
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error(STORAGE_FAILED);
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
