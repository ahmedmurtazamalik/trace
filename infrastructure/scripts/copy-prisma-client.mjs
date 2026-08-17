import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function prismaPackageNodeModules(nodeModulesRoot) {
  const virtualStore = join(nodeModulesRoot, '.pnpm');
  const entries = await readdir(virtualStore, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('@prisma+client@'))
    .map((entry) => join(virtualStore, entry.name, 'node_modules'));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one @prisma/client virtual-store package in ${nodeModulesRoot}; found ${matches.length}.`);
  }
  return matches[0];
}

const [sourceRoot, ...targetRoots] = process.argv.slice(2);
if (sourceRoot === undefined || targetRoots.length === 0) {
  throw new Error('Usage: node copy-prisma-client.mjs SOURCE_NODE_MODULES TARGET_NODE_MODULES...');
}
const sourcePackageRoot = await prismaPackageNodeModules(sourceRoot);
const source = join(sourcePackageRoot, '.prisma', 'client');
for (const targetRoot of targetRoots) {
  const targetPackageRoot = await prismaPackageNodeModules(targetRoot);
  const target = join(targetPackageRoot, '.prisma', 'client');
  await mkdir(join(targetPackageRoot, '.prisma'), { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
}
