import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(workerRoot, 'src/latex/templates');
const destination = resolve(workerRoot, 'dist/src/latex/templates');

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true, force: true });