# Trace Frontend Setup

This guide covers the Next.js frontend in `apps/web` and shared UI components in `packages/ui`. It does not configure the API, database, Redis, queue worker, GitHub App, report storage, email, LLM, or LaTeX services.

## Prerequisites

- Node.js 20 or newer
- pnpm 10.15.1 or a compatible pnpm 10 release
- Chromium installed by Playwright when browser tests are required

Check the local tools:

```bash
node --version
pnpm --version
```

## Install

From the repository root:

```bash
pnpm install --frozen-lockfile
```

For the first browser-test run:

```bash
pnpm --filter @trace/web exec playwright install chromium
```

## Fastest start: credential-free demo mode

Demo mode runs the real frontend with a browser Mock Service Worker (MSW). It requires no API, PostgreSQL, Redis, GitHub credentials, email provider, queue worker, report storage, LLM, or LaTeX installation.

```bash
pnpm --filter @trace/web dev:mock
```

Open `http://localhost:3000/dashboard`.

The page displays a persistent **Demo data** note. Demo responses are deterministic, in-memory fixtures from `apps/web/src/mocks/`; they are not current GitHub, database, or production data. Reloading or restarting may reset simulated changes. OAuth provider redirects, real email delivery, durable report processing, and real artifact storage are not provided by demo mode.

Use another port when 3000 is busy:

```bash
pnpm --filter @trace/web dev:mock --hostname 0.0.0.0 --port 3100
```

Then open `http://localhost:3100/dashboard` on the host computer.

### Verify demo mode automatically

```bash
NODE_ENV=production pnpm --filter @trace/web test:e2e:mock
```

This builds and starts Trace on port 3201, uses the real browser MSW worker, and checks the dashboard, repository tracking, activity, reports, and GitHub pages in desktop Chrome and a Pixel 5 viewport. The Playwright test does not intercept the API itself.

The committed worker file is `apps/web/public/mockServiceWorker.js`. Regenerate it only after intentionally upgrading MSW:

```bash
cd apps/web
pnpm exec msw init public --save
```

## Live frontend configuration

Copy the frontend-only example:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Supported browser-visible variables:

```dotenv
NEXT_PUBLIC_API_ORIGIN=http://localhost:3001
NEXT_PUBLIC_MSW_ENABLED=false
```

- `NEXT_PUBLIC_API_ORIGIN` is the API origin used by browser requests. Do not include a trailing slash.
- `NEXT_PUBLIC_MSW_ENABLED=true` enables deterministic browser mocks. Prefer `dev:mock`, which sets this safely for one command.
- Every `NEXT_PUBLIC_*` value is embedded in browser code and is public.

Never put session credentials, CSRF secrets, database URLs, Redis URLs, GitHub client secrets, App private keys, provider tokens, email credentials, LLM keys, or storage credentials in the frontend environment.

## Run against the live API

The API and its required services must already be healthy according to the backend operations documentation. Then run:

```bash
pnpm --filter @trace/web dev
```

Open `http://localhost:3000/login`.

Live mode uses HTTP-only session cookies and in-memory CSRF state. The browser API origin must allow the exact frontend origin with credentialed CORS. `NEXT_PUBLIC_MSW_ENABLED` must be absent or `false`; otherwise the frontend displays fixtures instead of proving backend integration.

## Routes

Public routes:

- `/login`
- `/register`
- `/forgot-password`
- `/reset-password?token=<opaque-token>`

Protected routes:

- `/dashboard`
- `/repositories`
- `/repositories/<id>`
- `/activity`
- `/reports`
- `/reports/<id>`
- `/github`
- `/settings`

## Tests and quality gates

Run focused frontend gates from the repository root:

```bash
NODE_ENV=test pnpm --filter @trace/ui test
NODE_ENV=test pnpm --filter @trace/ui typecheck
NODE_ENV=test pnpm --filter @trace/web test
NODE_ENV=test pnpm --filter @trace/web lint
NODE_ENV=test pnpm --filter @trace/web typecheck
NODE_ENV=production pnpm --filter @trace/web build
NODE_ENV=production pnpm --filter @trace/web test:e2e
NODE_ENV=production pnpm --filter @trace/web test:e2e:mock
```

- Vitest covers components, adapters, safe errors, URL state, and MSW HTTP boundaries.
- Standard Playwright tests run desktop/mobile workflows with controlled route responses and axe WCAG A/AA scans.
- Mock-mode Playwright builds the production frontend and verifies its committed MSW worker without external credentials.
- A green mocked run proves frontend behavior and contract compatibility, not a live GitHub, database, queue, report-generation, or artifact-storage integration.

## Production build and local start

```bash
NODE_ENV=production pnpm --filter @trace/web build
NODE_ENV=production pnpm --filter @trace/web start
```

The default production URL is `http://localhost:3000`. Build public environment values for the intended deployment; changing them after `next build` does not reliably rewrite an already-built client bundle.

## Common problems

### The page remains on “Starting credential-free demo…”

Confirm that `apps/web/public/mockServiceWorker.js` exists, clear the site’s service-worker data, reload, and rerun `pnpm install --frozen-lockfile`. The UI displays an explicit error if worker startup fails.

### Live mode says the network is unavailable

Check that the API is listening at `NEXT_PUBLIC_API_ORIGIN`, the exact frontend origin is allowed by credentialed CORS, and MSW is disabled.

### Port 3000 is already in use

Pass `--port 3100` to `dev` or `dev:mock`, then update backend CORS when using live mode.

### Playwright reports a server collision

Stop the process using ports 3100 or 3201. Both Playwright configurations use `reuseExistingServer: false` so a different app cannot produce false passing evidence.

## CLI status

Trace CLI support is future work. There is no supported CLI installation, local-commit ingestion, background watcher, or CLI-to-API workflow in the current frontend. Do not use illustrative `cli` activity fixtures as evidence that a CLI exists.
