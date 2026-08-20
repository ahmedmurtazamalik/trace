import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const execute = promisify(execFile);
const serviceBlock = (compose, service) => {
  const match = compose.match(new RegExp(`^  ${service}:\\n[\\s\\S]*?(?=^  [a-z][a-z-]*:|^volumes:|^networks:)`, 'm'));
  assert.ok(match, `missing ${service} service block`);
  return match[0];
};
const composeEnvironment = () => {
  const digest = 'a'.repeat(64);
  return {
    ...process.env,
    POSTGRES_PASSWORD: 'example',
    DATABASE_URL: 'postgresql://trace:example@postgres:5432/trace',
    REDIS_URL: 'redis://redis:6379',
    SESSION_SECRET: 'x'.repeat(32),
    FRONTEND_ORIGIN: 'https://trace.example.test',
    GITHUB_APP_ID: '1',
    GITHUB_APP_SLUG: 'trace',
    GITHUB_APP_PRIVATE_KEY: 'example',
    GITHUB_APP_CLIENT_ID: 'example',
    GITHUB_APP_CLIENT_SECRET: 'example',
    GITHUB_CALLBACK_URL: 'https://api.example.test/api/v1/github/callback',
    GITHUB_INSTALLATION_CALLBACK_URL: 'https://api.example.test/api/v1/github/installation/callback',
    GITHUB_WEBHOOK_SECRET: 'w'.repeat(32),
    REPORT_CODEX_MODEL: 'gpt-5.6-sol',
    TRACE_CODEX_HOME: '/tmp/trace-codex',
    REPORT_LATEX_IMAGE: `sha256:${digest}`,
    REPORT_LATEX_WORK_ROOT: '/tmp/trace-latex',
    DOCKER_GID: '1',
    DOCKER_SOCKET: '/var/run/docker.sock',
    TRACE_API_IMAGE: `sha256:${digest}`,
    TRACE_MIGRATION_IMAGE: `sha256:${digest}`,
    TRACE_WORKER_IMAGE: `sha256:${digest}`,
  };
};

test('public development seed commands set an explicit safe environment', async () => {
  const [readme, backendSetup] = await Promise.all([read('README.md'), read('docs/backend-setup.md')]);
  const command = 'NODE_ENV=development ALLOW_DEMO_SEED=true corepack pnpm db:seed';
  assert.match(readme, /set -a\n\. \.\/\.env\nset \+a/);
  assert.match(readme, new RegExp(command));
  assert.match(backendSetup, new RegExp(command));
});

test('migration production bundle contains an executable pinned Prisma CLI', async () => {
  const target = await mkdtemp(join(tmpdir(), 'trace-migration-deploy-'));
  try {
    await execute('corepack', ['pnpm', '--filter', '@trace/database', 'deploy', '--legacy', target], {
      cwd: root.pathname,
    });
    const prisma = join(target, 'node_modules', '.bin', 'prisma');
    await access(prisma, constants.X_OK);
    const { stdout } = await execute(prisma, ['--version']);
    assert.match(stdout, /prisma\s+: 6\.19\.3/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('generated Prisma client payload is copied into deployed pnpm bundles', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'trace-prisma-copy-test-'));
  const source = join(fixture, 'source', 'node_modules');
  const target = join(fixture, 'target', 'node_modules');
  const packagePath = '@prisma+client@6.19.3/node_modules';
  try {
    await mkdir(join(source, '.pnpm', packagePath, '.prisma', 'client'), { recursive: true });
    await mkdir(join(target, '.pnpm', packagePath, '@prisma', 'client'), { recursive: true });
    await writeFile(join(source, '.pnpm', packagePath, '.prisma', 'client', 'default.js'), 'generated');
    await execute(process.execPath, [
      new URL('../scripts/copy-prisma-client.mjs', import.meta.url).pathname,
      source,
      target,
    ]);
    assert.equal(
      await readFile(join(target, '.pnpm', packagePath, '.prisma', 'client', 'default.js'), 'utf8'),
      'generated',
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('release image validator accepts only immutable image references', async () => {
  const script = new URL('../scripts/validate-image-references.mjs', import.meta.url).pathname;
  const digest = 'a'.repeat(64);
  await execute(process.execPath, [script, `sha256:${digest}`, `registry.example/trace/migrate@sha256:${digest}`, `trace/worker@sha256:${digest}`]);
  await assert.rejects(execute(process.execPath, [script, 'trace/api:latest', `sha256:${digest}`, `sha256:${digest}`]));
});

test('production API and worker images run as non-root services', async () => {
  const [api, worker, workerPackageText, dockerignore] = await Promise.all([
    read('apps/api/Dockerfile'),
    read('apps/worker/Dockerfile'),
    read('apps/worker/package.json'),
    read('.dockerignore'),
  ]);
  const workerPackage = JSON.parse(workerPackageText);

  assert.match(api, /^FROM .* AS runtime$/m);
  assert.match(api, /^# syntax=docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}$/m);
  assert.match(api, /^ARG NODE_IMAGE=node:22-bookworm-slim@sha256:[a-f0-9]{64}$/m);
  assert.match(api, /openssl/);
  assert.match(api, /copy-prisma-client\.mjs/);
  assert.match(api, /^USER node$/m);
  assert.match(api, /CMD \["node", "dist\/src\/main\.js"\]/);
  assert.match(api, /^FROM .* AS migration$/m);
  assert.match(api, /trace-migrate/);
  assert.match(api, /CMD \["\.\/node_modules\/\.bin\/prisma", "migrate", "deploy"\]/);

  assert.match(worker, /^FROM .* AS runtime$/m);
  assert.match(worker, /^# syntax=docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}$/m);
  assert.match(worker, /^ARG NODE_IMAGE=node:22-bookworm-slim@sha256:[a-f0-9]{64}$/m);
  assert.match(worker, /copy-prisma-client\.mjs/);
  assert.match(worker, /verify-worker-drain\.mjs/);
  assert.match(worker, /^USER node$/m);
  assert.match(worker, /CMD \["node", "dist\/src\/main\.js"\]/);
  assert.match(worker, /docker\.io/);
  assert.match(worker, /ENV PATH=\/app\/node_modules\/\.bin:/);
  assert.equal(workerPackage.dependencies['@openai/codex'], '0.146.0');

  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^\.git$/m);
});

test('production-like backend Compose gates startup on migration and dependency health', async () => {
  const compose = await read('infrastructure/compose/backend.production.yml');

  for (const service of ['postgres:', 'redis:', 'migrate:', 'api:', 'worker:']) {
    assert.match(compose, new RegExp(`^  ${service.replace(':', '\\:')}$`, 'm'));
  }
  assert.doesNotMatch(compose, /^  web:$/m);
  assert.match(compose, /image: postgres@sha256:[a-f0-9]{64}/);
  assert.match(compose, /image: redis@sha256:[a-f0-9]{64}/);
  assert.match(compose, /image: \$\{TRACE_API_IMAGE:\?[^}]+\}/);
  assert.match(compose, /image: \$\{TRACE_MIGRATION_IMAGE:\?[^}]+\}/);
  assert.match(compose, /image: \$\{TRACE_WORKER_IMAGE:\?[^}]+\}/);
  assert.doesNotMatch(compose, /trace-(?:api|migrate|worker):day13/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /\/health/);
  assert.match(compose, /\/ready/);
  assert.match(compose, /REPORT_STORAGE_ROOT/);
  assert.match(compose, /REPORT_LATEX_WORK_ROOT/);
  assert.match(compose, /docker\.sock/);
  assert.match(compose, /stop_grace_period:/);
  assert.match(compose, /data:\n    internal: true/);
  assert.match(compose, /egress:\n    driver: bridge/);
  const migration = serviceBlock(compose, 'migrate');
  for (const hardening of ['init: true', 'read_only: true', 'cap_drop: [ALL]', 'no-new-privileges:true', 'stop_grace_period:', 'tmpfs:']) {
    assert.match(migration, new RegExp(hardening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const workerService = serviceBlock(compose, 'worker');
  const apiService = serviceBlock(compose, 'api');
  assert.match(workerService, /WORKER_SHUTDOWN_TIMEOUT_MS: \$\{WORKER_SHUTDOWN_TIMEOUT_MS:-210000\}/);
  assert.match(workerService, /FRONTEND_ORIGIN: \$\{FRONTEND_ORIGIN:\?/);
  assert.match(workerService, /SLACK_REPORT_WEBHOOK_URL: \$\{SLACK_REPORT_WEBHOOK_URL:-\}/);
  assert.doesNotMatch(apiService, /SLACK_REPORT_WEBHOOK_URL/);
  assert.match(workerService, /REPORT_LLM_PROVIDER: codex/);
  assert.match(workerService, /REPORT_CODEX_COMMAND: \/app\/node_modules\/\.bin\/codex/);
  assert.match(workerService, /REPORT_CODEX_MODEL: \$\{REPORT_CODEX_MODEL:-gpt-5\.6-sol\}/);
  assert.match(workerService, /CODEX_HOME: \/var\/lib\/trace\/codex/);
  assert.match(workerService, /\$\{TRACE_CODEX_HOME:\?/);
  assert.match(workerService, /stop_grace_period: 240s/);
  assert.match(workerService, /\$\{DOCKER_SOCKET:\?/);

  const composePath = new URL('../compose/backend.production.yml', import.meta.url).pathname;
  const { stdout } = await execute('docker', ['compose', '--file', composePath, 'config', '--format', 'json'], {
    env: composeEnvironment(),
  });
  const renderedMigration = JSON.parse(stdout).services.migrate;
  assert.deepEqual({
    init: renderedMigration.init,
    readOnly: renderedMigration.read_only,
    capDrop: renderedMigration.cap_drop,
    securityOpt: renderedMigration.security_opt,
    stopGracePeriod: renderedMigration.stop_grace_period,
    tmpfs: renderedMigration.tmpfs,
  }, {
    init: true,
    readOnly: true,
    capDrop: ['ALL'],
    securityOpt: ['no-new-privileges:true'],
    stopGracePeriod: '30s',
    tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777'],
  });
});

test('release automation pins actions and enforces pnpm supply-chain policy', async () => {
  const [workflow, workspace, packageJsonText, apiDockerfile, workerDockerfile] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('pnpm-workspace.yaml'),
    read('package.json'),
    read('apps/api/Dockerfile'),
    read('apps/worker/Dockerfile'),
  ]);
  const packageJson = JSON.parse(packageJsonText);
  const expectedActions = new Map([
    ['actions/checkout', '11d5960a326750d5838078e36cf38b85af677262'],
    ['actions/setup-node', '49933ea5288caeca8642d1e84afbd3f7d6820020'],
    ['pnpm/action-setup', 'b906affcce14559ad1aafd4ab0e942779e9f58b1'],
  ]);
  const actionReferences = [...workflow.matchAll(/^\s*- uses: ([^@\s]+)@([^\s]+)$/gm)];

  assert.equal(actionReferences.length, 6);
  for (const [, action, revision] of actionReferences) {
    assert.equal(revision, expectedActions.get(action), `${action} must use its reviewed full commit SHA`);
  }
  assert.equal(packageJson.packageManager, 'pnpm@10.34.5');
  assert.equal((workflow.match(/version: 10\.34\.5/g) ?? []).length, 2);
  for (const dockerfile of [apiDockerfile, workerDockerfile]) {
    assert.match(dockerfile, /corepack prepare pnpm@10\.34\.5 --activate/);
    assert.doesNotMatch(dockerfile, /pnpm@10\.15\.1/);
  }
  assert.match(workspace, /^minimumReleaseAge: 10080$/m);
  const maturityExclusions = workspace.match(/^minimumReleaseAgeExclude:\n((?:  - .+\n?)*)/m)?.[1]
    .trim()
    .split('\n')
    .map((entry) => entry.trim().replace(/^- /, ''));
  assert.deepEqual(
    maturityExclusions,
    ['"@napi-rs/wasm-runtime@1.2.3"'],
    'the only maturity exception must remain pinned to the already-locked version',
  );
  assert.match(workspace, /^trustPolicy: no-downgrade$/m);
  assert.match(workspace, /^blockExoticSubdeps: true$/m);
});

test('backend coverage command builds workspace declarations before coverage', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const scripts = packageJson.scripts ?? {};
  const coverage = scripts['test:coverage:backend'];
  const buildLibraries = scripts['build:libraries'];

  assert.equal(
    buildLibraries,
    'pnpm --filter @trace/config --filter @trace/database --filter @trace/github --filter @trace/report-storage --filter @trace/shared build',
  );
  assert.equal(
    coverage,
    'pnpm db:generate && pnpm build:libraries && pnpm --filter @trace/api test:coverage && pnpm --filter @trace/worker test:coverage',
    'coverage must generate Prisma before building declarations and running backend suites',
  );
});

test('backend operations and smoke entrypoints are present', async () => {
  const [operations, github, smoke, drain] = await Promise.all([
    read('docs/backend-operations.md'),
    read('docs/github-app-setup.md'),
    read('infrastructure/scripts/smoke-backend.sh'),
    read('infrastructure/scripts/verify-worker-drain.mjs'),
  ]);

  for (const heading of [
    'Environment contract',
    'Migration and rollback',
    'Health and readiness',
    'Graceful shutdown and queue draining',
    'Report storage',
    'LLM provider',
    'LaTeX compiler',
    'Backup and restore',
    'Smoke test',
  ]) {
    assert.match(operations, new RegExp(`^## ${heading}$`, 'm'));
  }
  assert.match(github, /^# GitHub App setup$/m);
  assert.match(github, /OAuth callback/i);
  assert.match(github, /installation callback/i);
  assert.match(github, /webhook secret/i);
  assert.match(smoke, /docker compose/);
  assert.match(smoke, /\/health/);
  assert.match(smoke, /\/ready/);
  assert.match(smoke, /SIGTERM/);
  for (const prerequisite of ['python3', 'curl', 'openssl', 'node', 'stat']) assert.match(smoke, new RegExp(prerequisite));
  assert.match(smoke, /verify-worker-drain\.mjs/);
  assert.match(smoke, /validate-image-references\.mjs/);
  assert.match(drain, /worker\.active-drain\.verified/);
});
