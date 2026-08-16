'use strict';

const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const { chmod, link, mkdir, open, rm } = require('node:fs/promises');

const KEY_PATTERN = /^users\/[A-Za-z0-9_-]{1,128}\/reports\/[A-Za-z0-9_-]{1,128}\/revisions\/[1-9][0-9]{0,8}\/(?:generations\/[1-9][0-9]{0,8}\/attempts\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/)?report\.(?:pdf|tex)$/;
const MAX_ARTIFACT_BYTES = 100_000_000;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

function failed() {
  return new Error('REPORT_STORAGE_FAILED');
}

function isNodeError(error, code) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function at(parent, name) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw failed();
  return `/proc/self/fd/${parent.fd}/${name}`;
}

async function readAnchored(path, maximumBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumBytes) throw failed();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw failed();
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) throw failed();
    return bytes;
  } finally {
    await handle.close();
  }
}

async function openParent(root, key) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  let current = await open(root, DIRECTORY_FLAGS);
  try {
    const rootMetadata = await current.stat();
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw failed();
    const parts = key.split('/');
    const name = parts.pop();
    if (name === undefined) throw failed();
    for (const part of parts) {
      const nextPath = at(current, part);
      await mkdir(nextPath, { mode: 0o700 }).catch((error) => {
        if (!isNodeError(error, 'EEXIST')) throw error;
      });
      const next = await open(nextPath, DIRECTORY_FLAGS);
      const metadata = await next.stat();
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        await next.close();
        throw failed();
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

async function put(root, key, bytes) {
  let parent;
  let temporary;
  try {
    const opened = await openParent(root, key);
    parent = opened.parent;
    const destination = at(parent, opened.name);
    temporary = at(parent, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.chmod(0o400);
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== bytes.length) throw failed();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, destination);
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      const existing = await readAnchored(destination, MAX_ARTIFACT_BYTES);
      if (!existing.equals(bytes)) throw failed();
    }
  } finally {
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
    await parent?.close().catch(() => undefined);
  }
}

async function main() {
  const root = process.argv[2];
  const key = process.argv[3];
  if (process.platform !== 'linux' || typeof root !== 'string' || !root.startsWith('/') || typeof key !== 'string' || !KEY_PATTERN.test(key)) throw failed();
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_ARTIFACT_BYTES) throw failed();
    chunks.push(chunk);
  }
  if (size < 1) throw failed();
  await put(root, key, Buffer.concat(chunks, size));
}

main().then(() => process.exit(0), () => process.exit(1));
