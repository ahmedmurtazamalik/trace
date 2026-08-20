# Trace

Trace is a self-hosted engineering activity workspace for connecting GitHub repositories, collecting factual development activity, exploring daily metrics, and generating editable PDF reports.

The system keeps Trace authentication separate from GitHub authorization, stores signed webhook deliveries durably before processing, derives dashboards from canonical activity records, and generates reports from immutable factual snapshots. Narrative report content is editable; repository, contributor, and activity facts remain server-owned.

> **Current scope:** the repository contains the web application, API, queue workers, shared contracts, PostgreSQL schema, local dependency stack, and sandboxed XeLaTeX image. Production application images and a production deployment topology are environment-specific and are not supplied by this repository.

## Contents

- [What Trace provides](#what-trace-provides)
- [Architecture](#architecture)
- [Technology](#technology)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Running the services](#running-the-services)
- [Core workflows](#core-workflows)
- [API overview](#api-overview)
- [Security model](#security-model)
- [Reports and artifact storage](#reports-and-artifact-storage)
- [Testing and quality gates](#testing-and-quality-gates)
- [Production requirements](#production-requirements)
- [Known operational boundaries](#known-operational-boundaries)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

## What Trace provides

### Account and session security

- Trace-native registration, login, logout, and password reset.
- Argon2id password hashing.
- Opaque HTTP-only session cookies; raw session tokens are not persisted.
- CSRF protection on authenticated mutations.
- Redis-backed address and account rate limits.
- Non-enumerating password-reset responses and single-use reset tokens.

### GitHub connection and repository management

- GitHub OAuth account linking without replacing Trace authentication.
- Separate GitHub App installation authorization.
- Explicit installation ownership verification.
- Repository synchronization using stable GitHub IDs.
- Per-user repository tracking, removal, restoration, and account switching.
- Historical activity retention without treating retained history as current provider authority.

### Activity ingestion and exploration

- HMAC-SHA256 verification over exact GitHub webhook bytes.
- Durable PostgreSQL delivery ledger before queue processing.
- Deterministic BullMQ jobs with retry and reconciliation behavior.
- Canonical push, commit, contributor, file, and activity persistence.
- Date, timezone, repository, contributor, source, and type filters.
- Signed, filter-bound pagination cursors.
- Daily dashboard metrics and recent factual activity.

### Reports

- One report per user and local calendar date.
- Immutable factual input snapshots.
- Deterministic local report provider for development.
- Optional bounded external LLM provider for narrative prose.
- Editable structured prose with optimistic revision checks.
- Explicit regeneration without silently overwriting manual edits.
- Controlled LaTeX rendering and sandboxed XeLaTeX compilation.
- Owner-authorized `.tex` and PDF downloads with size and SHA-256 verification.

## Architecture

```mermaid
flowchart LR
    Browser[Next.js web app] -->|cookie session + CSRF| API[NestJS API]
    GitHub[GitHub OAuth, App and webhooks] --> API

    API --> DB[(PostgreSQL)]
    API --> Redis[(Redis / BullMQ)]

    Redis --> Worker[Activity and report workers]
    Worker --> DB
    Worker --> GitHubAPI[GitHub API]
    Worker --> Provider[Fake or configured report provider]
    Worker --> Latex[Sandboxed XeLaTeX container]
    Worker --> Storage[(Report artifact storage)]

    API -->|authorized, checksum-verified download| Storage
```

### Data flow

1. A user signs in to Trace and links a GitHub identity.
2. A GitHub App installation grants repository access separately from OAuth identity.
3. Repository synchronization creates or updates per-user repository associations.
4. GitHub sends signed push webhooks to the API.
5. The API validates, authorizes, and stores each delivery before publishing a durable queue obligation.
6. The activity worker revalidates authority and persists canonical activity.
7. Dashboard and activity endpoints query only the authenticated user's authorized visibility window.
8. Report creation freezes a bounded factual snapshot and publishes a report job.
9. The report worker generates structured prose, renders the controlled template, compiles it in the XeLaTeX sandbox, and stores immutable artifacts.
10. The API authorizes downloads and verifies artifact metadata before streaming bytes.

## Technology

| Layer | Technology |
| --- | --- |
| Web | Next.js, React, TanStack Query, React Hook Form, Tailwind CSS |
| API | NestJS, Express, Zod/class-validator boundaries |
| Workers | Node.js, BullMQ, Redis |
| Database | PostgreSQL, Prisma |
| GitHub | OAuth, GitHub App installation authorization, signed webhooks |
| Reports | Structured provider interface, controlled LaTeX template, XeLaTeX, PDF validation |
| Tests | Jest, Vitest, Testing Library, Supertest, Playwright |
| Monorepo | pnpm workspaces, TypeScript |

## Repository layout

```text
.
├── apps/
│   ├── api/                 # NestJS HTTP API and publication reconcilers
│   ├── web/                 # Next.js browser application
│   └── worker/              # GitHub activity and report queue workers
├── packages/
│   ├── config/              # Validated runtime configuration
│   ├── database/            # Prisma schema, migrations, seed, database client
│   ├── github/              # GitHub provider adapters and authorization helpers
│   ├── report-storage/      # Artifact storage abstraction and filesystem adapter
│   ├── shared/              # Runtime schemas, DTOs, types, and fixtures
│   └── ui/                  # Shared React UI primitives
├── infrastructure/
│   └── latex/               # Sandboxed XeLaTeX image and compiler entrypoint
├── docs/                    # API, setup, security, and user documentation
├── docker-compose.yml       # Local PostgreSQL and Redis dependencies
├── pnpm-workspace.yaml
└── package.json
```

## Prerequisites

- Node.js 22 or newer.
- Corepack.
- Docker Engine with Docker Compose.
- Git, for normal development workflows.
- A GitHub App and OAuth credentials for live GitHub connection and activity processing.

The repository pins pnpm through the root `packageManager` field.

## Quick start

### 1. Install dependencies

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

### 2. Create local configuration

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

Edit `.env` before running any database command:

```dotenv
# Matches the local-only credentials in docker-compose.yml.
DATABASE_URL=postgresql://trace:trace_dev_password@localhost:5432/trace?schema=public

# Replace this with an independently generated value of at least 32 characters.
SESSION_SECRET=replace-with-a-random-local-secret
```

For example, generate a session secret with `openssl rand -hex 32`. The database URL above is only for the loopback-bound development container; do not reuse its username or password in another environment. Keep `.env` and `.env.local` untracked.

For live GitHub workflows, also configure the GitHub variables described in [Configuration](#configuration). The combined worker process starts both activity and report workers, so it requires valid GitHub App credentials even when the report provider is local.

### 3. Start PostgreSQL and Redis

```bash
corepack pnpm infra:up
docker compose ps
```

The development stack binds both dependencies to loopback:

- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`

### 4. Prepare the database

```bash
# Prisma config does not load the repository-root .env automatically.
set -a
. ./.env
set +a
corepack pnpm db:generate
corepack pnpm db:migrate
```

Optional fictional development data:

```bash
NODE_ENV=development ALLOW_DEMO_SEED=true corepack pnpm db:seed
```

The seed accepts only explicit `development` or `test` modes, is blocked for missing or unknown modes, and must not be enabled in a shared environment.

### 5. Build workspace packages and the LaTeX image

```bash
corepack pnpm build
docker build --tag trace-latex:local infrastructure/latex
```

The root build compiles internal packages, the API and workers, packages the controlled LaTeX template, and creates the optimized web build.

### 6. Start the application

Use separate terminals:

```bash
# Terminal 1: API with source watching
corepack pnpm --filter @trace/api dev
```

```bash
# Terminal 2: web application
corepack pnpm --filter @trace/web dev
```

```bash
# Terminal 3: compiled activity and report workers
corepack pnpm --filter @trace/worker start
```

Open `http://localhost:3000`. The API listens on `http://localhost:3001` by default.

Check runtime health:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/ready
```

`/health` reports process liveness without querying dependencies. `/ready` checks PostgreSQL and Redis and returns `503` when either required dependency is unavailable.

## Configuration

The API and worker start scripts load the repository-root `.env`. The web application loads `apps/web/.env.local`.

### Core API configuration

| Variable | Purpose | Local default/example |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `PORT` | API listen port | `3001` |
| `DATABASE_URL` | PostgreSQL connection URL | local Compose database |
| `REDIS_URL` | Redis/BullMQ connection URL | `redis://localhost:6379` |
| `SESSION_SECRET` | Session-token keying secret; minimum 32 characters | must be replaced |
| `LOG_LEVEL` | `error`, `warn`, `info`, or `debug` | `info` |
| `FRONTEND_ORIGIN` | Sole credentialed CORS origin | `http://localhost:3000` |
| `ALLOW_DEMO_SEED` | Explicit opt-in for fictional seed data | `false` |

### Web configuration

| Variable | Purpose | Local default |
| --- | --- | --- |
| `NEXT_PUBLIC_API_ORIGIN` | Browser-visible API origin | `http://localhost:3001` |

Never put database URLs, provider credentials, session secrets, or private keys in a `NEXT_PUBLIC_*` variable.

### GitHub configuration

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_SLUG` | Public GitHub App slug |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key; escaped newlines are expanded by the worker |
| `GITHUB_APP_CLIENT_ID` | OAuth client ID |
| `GITHUB_APP_CLIENT_SECRET` | OAuth client secret |
| `GITHUB_CALLBACK_URL` | Public OAuth callback URL |
| `GITHUB_INSTALLATION_CALLBACK_URL` | Public installation setup callback URL |
| `GITHUB_WEBHOOK_SECRET` | Secret used to verify exact webhook bytes |

Register callback URLs that exactly match the configured API routes. In production, callback and frontend origins must use HTTPS.

### Slack report sharing

Set `SLACK_REPORT_WEBHOOK_URL` on the report worker to automatically notify one fixed managers-only channel after every successfully finalized personal or workspace report render generation. Create a Slack app, enable Incoming Webhooks, add one webhook for that channel, store the URL as a worker-only server secret, and restart the worker. Trace sends the stored executive summary and an authenticated Trace report link; it does not send metrics or upload the PDF. Regeneration increments the render generation, even when the report revision is unchanged, and therefore produces a new notification.

Slack delivery begins only after the report and its current PDF artifact commit successfully. The report-finalization transaction records a bounded notification snapshot in a render-generation-scoped system audit event, so completion and its delivery obligation become durable together. A Slack outage does not change a completed report to failed: Trace uses the report job's bounded retry policy for definitive or ambiguous delivery failures. Every retry authenticates the unresolved audit target against its report, revision, scope, date, and stored executive summary before posting, so mutable later generations and queue payloads cannot retarget an older obligation. Each attempt performs one webhook request, and any durably recorded success suppresses duplicates for that exact revision and render generation. Slack incoming webhooks provide no idempotency key, so the narrow crash window after Slack accepts a request but before Trace records success can produce a duplicate on retry; Trace favors eventual delivery over silently losing a report. The webhook must never be exposed to the browser, logged, or committed.

### Report configuration

| Variable | Purpose | Local behavior |
| --- | --- | --- |
| `REPORT_LLM_PROVIDER` | `fake` or authenticated local `codex` CLI | `fake` |
| `REPORT_CODEX_COMMAND` | Codex CLI executable path/name | `codex` |
| `REPORT_CODEX_MODEL` | Explicit Codex model | `gpt-5.6-sol` |
| `REPORT_CODEX_TIMEOUT_MS` | Per-inference process timeout (1–75 seconds; two calls remain below the report lease) | `75000` |
| `REPORT_WORKER_CONCURRENCY` | Report worker concurrency | `2` |
| `REPORT_LATEX_IMAGE` | XeLaTeX compiler image | `trace-latex:local` |
| `REPORT_LATEX_TIMEOUT_MS` | Compiler timeout | `30000` |
| `REPORT_STORAGE_DRIVER` | Artifact storage driver | `filesystem` |
| `REPORT_STORAGE_ROOT` | Filesystem artifact root | `/tmp/trace-report-artifacts` |

Production rejects the fake report provider and requires `REPORT_LATEX_IMAGE` to use an immutable SHA-256 image digest.

## Running the services

### Development web and API

```bash
corepack pnpm --filter @trace/api dev
corepack pnpm --filter @trace/web dev
```

### Compiled services

```bash
corepack pnpm build
corepack pnpm --filter @trace/api start
corepack pnpm --filter @trace/web start
corepack pnpm --filter @trace/worker start
```

### Stop local dependencies

Preserve database and Redis volumes:

```bash
corepack pnpm infra:down
```

Delete local dependency data only when a clean environment is intentional:

```bash
docker compose down -v
```

## Core workflows

### Authentication

1. Register at `/register` or sign in at `/login`.
2. The API establishes an HTTP-only `trace_session` cookie.
3. The browser keeps the returned CSRF token only in application memory.
4. Authenticated mutations include that value in `X-CSRF-Token`.
5. Logout revokes the current session; password reset revokes all active sessions.

### GitHub connection

Trace models three different authorities:

1. A Trace account authenticates the user to Trace.
2. GitHub OAuth links a GitHub identity.
3. A GitHub App installation authorizes repository access.

Connecting an identity does not silently select or claim an installation. Installation ownership is verified through an exact-session, purpose-bound flow before persistence.

### Repository tracking and activity

- Synchronization imports every authorized installation page before publishing one reconciled snapshot.
- Repository access and per-user tracking are separate states.
- Signed push deliveries are accepted only for currently authorized and tracked repositories.
- PostgreSQL remains the durable source of queue obligations; Redis job loss is reconciled.
- Reads apply the authenticated user's repository membership and temporal visibility window.

### Report lifecycle

1. Select a date in the web application. The current web route submits `Asia/Karachi`; API clients may supply another validated IANA timezone.
2. Trace freezes a bounded factual snapshot from authorized tracked activity.
3. A report job creates structured narrative content.
4. The worker renders the application-owned LaTeX template and compiles a PDF.
5. Users may edit only structured prose fields.
6. Saving creates an immutable revision guarded by `expectedRevision`.
7. Regeneration preserves the current revision and requests new artifacts.
8. Downloads are owner-scoped and verified against stored size and checksum metadata.

## API overview

Product APIs use the `/api/v1` prefix. Liveness and readiness are intentionally unversioned.

| Area | Main endpoints |
| --- | --- |
| Operations | `GET /health`, `GET /ready` |
| Authentication | `/api/v1/auth/register`, `/login`, `/logout`, `/me`, `/password/forgot`, `/password/reset` |
| GitHub | `/api/v1/github/connect`, `/switch`, `/callback`, `/installation`, `/installation/callback`, `/status`, `/connection` |
| Repositories | `/api/v1/repositories`, `/sync`, `/:id`, `/:id/restore`, `/:id/tracking`, `/:id/activity` |
| Webhooks | `POST /api/v1/webhooks/github` |
| Activity | `GET /api/v1/activity` |
| Dashboard | `GET /api/v1/dashboard` |
| Reports | `/api/v1/reports`, `/:id`, `/:id/revision`, `/:id/regenerate`, `/:id/download` |

All JSON errors use a stable safe envelope:

```json
{
  "code": "NOT_FOUND",
  "message": "The requested resource was not found.",
  "requestId": "opaque-request-id"
}
```

See [`docs/api.md`](docs/api.md) for lower-level DTOs, status codes, lifecycle invariants, pagination semantics, and endpoint-specific errors. That file also retains historical implementation notes; source schemas and tests are authoritative if its commentary conflicts with current behavior.

## Security model

Trace treats backend state as authoritative; hiding a frontend route is never authorization.

Key controls include:

- Strict runtime schemas and bounded request bodies, identifiers, cursors, and provider responses.
- HTTP-only cookies and hashed session credentials at rest.
- CSRF checks for authenticated mutations.
- Helmet headers and one explicit credentialed CORS origin.
- Redis-backed abuse controls that fail closed when unavailable.
- Purpose-specific, exact-session, expiring, single-use OAuth and installation states.
- HMAC verification over exact raw webhook bytes before JSON decoding.
- Per-user repository, activity, report, revision, and artifact authorization.
- Deterministic queue IDs, durable obligations, leases, and generation fences.
- Safe error envelopes and sanitized operational logging.
- Escaped report data and controlled LaTeX markers; arbitrary LaTeX input is not accepted.
- Sandboxed compilation with no network, no shell escape, non-root execution, a read-only root, dropped capabilities, and resource limits.

Read [`docs/backend-security.md`](docs/backend-security.md) for the endpoint authorization matrix, provider disclosure boundary, residual risks, and operational controls. Its verification-evidence sections are historical records rather than setup instructions.

## Reports and artifact storage

The controlled report template lives at:

```text
apps/worker/src/latex/templates/trace-report-theme.tex
```

It is packaged into worker build output. The renderer validates the fixed template structure and substitutes only approved markers with bounded, LaTeX-escaped application data.

The default filesystem driver stores immutable generation- and attempt-scoped artifacts. Production deployments using filesystem storage must mount `REPORT_STORAGE_ROOT` as a persistent volume shared by the API and report worker. The browser never receives storage paths or keys.

The configured external report provider receives bounded prose inputs needed to generate report narrative, including repository names, contributor display identities, timestamps, activity types, and relevant commit messages. Operators are responsible for the selected provider's privacy, geographic-processing, retention, and deletion terms.

## Testing and quality gates

Install dependencies, generate Prisma Client, build internal packages, and keep isolated PostgreSQL and Redis services available for service-backed suites.

### Workspace gates

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

### Backend coverage

```bash
corepack pnpm test:coverage:backend
```

This runs API and worker coverage. It requires valid test PostgreSQL and Redis URLs because database-backed worker suites are part of the normal worker gate.

### Browser acceptance

```bash
corepack pnpm --filter @trace/web exec playwright install --with-deps chromium
corepack pnpm --filter @trace/web test:e2e
```

Playwright starts its own production web server and uses controlled HTTP interception; it does not prove live GitHub-provider behavior.

### Real XeLaTeX acceptance

```bash
corepack pnpm test:latex:docker
```

This builds an image for the current candidate tree and runs real sandboxed compilation and forced-timeout cleanup tests.

### Dependency audits

```bash
corepack pnpm audit --audit-level=low
corepack pnpm audit --prod --audit-level=low
```

CI runs clean installation, Prisma generation, migrations, seed, internal library builds, workspace tests, database/API integration tests, lint, typecheck, production build, production audit, and Playwright.

## Production requirements

Before deploying Trace, provide and verify:

- Externally managed secrets; never deploy `.env` from a developer machine.
- HTTPS frontend, OAuth callback, and installation callback URLs.
- A strong non-placeholder `SESSION_SECRET`.
- Managed PostgreSQL and Redis with backup, restore, monitoring, and capacity policies.
- A configured GitHub App, OAuth credentials, webhook secret, and reachable webhook URL.
- A non-fake report provider with an approved privacy and retention policy.
- An immutable digest-pinned XeLaTeX image.
- Persistent report storage shared by the API and report worker.
- Production API, web, worker, and migration images or an equivalent deployment mechanism.
- Health checks using `/health` and `/ready`.
- Queue-draining and graceful-shutdown procedures.
- Retention and quota policies for reports, artifacts, audit records, and webhook deliveries.
- A bounded password-reset delivery provider if user-facing recovery is required.

The included `docker-compose.yml` is for local PostgreSQL and Redis only. It is not a production application deployment definition.

## Known operational boundaries

- Password-reset generation and consumption exist, but non-test delivery fails closed until a bounded delivery provider is configured.
- Filesystem artifacts require a persistent shared volume; multi-host object storage is not implemented.
- The opt-in local Git activity CLI is not part of this repository's current runtime.
- Browser tests use controlled endpoint interception; live OAuth, App installation, webhook, and external LLM checks require deployment credentials.
- Report and artifact storage quotas, retention, alerting, and backup policy are operator responsibilities.
- Production application Dockerfiles and rollout/rollback automation are not included.
- No license file is currently present; do not assume permission to redistribute this code outside its intended project context.

## Troubleshooting

### `/ready` returns `503`

Check dependency health:

```bash
docker compose ps
docker compose logs postgres redis
```

Confirm `DATABASE_URL` and `REDIS_URL` match the running services.

### Internal workspace packages cannot be resolved

Generate Prisma Client and build workspace packages:

```bash
corepack pnpm db:generate
corepack pnpm build
```

### The worker exits during startup

The combined worker requires:

- `DATABASE_URL`
- `REDIS_URL`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- a valid report-provider configuration
- `REPORT_LATEX_IMAGE`
- a usable artifact-storage configuration

Review sanitized worker logs and validate that the local LaTeX image exists:

```bash
docker image inspect trace-latex:local
docker build --tag trace-latex:local infrastructure/latex
```

### Reports remain pending

Verify that the worker is running, Redis is reachable, the report-provider configuration is valid, and the XeLaTeX image is available. PostgreSQL stores the durable report obligation, so restarting a healthy API/worker pair should reconcile missing deterministic jobs.

### GitHub callbacks fail

Verify that the configured callback URLs exactly match the GitHub App settings, that the browser retains the initiating Trace session, and that the public API URL is reachable. Do not log or copy OAuth state, authorization codes, private keys, webhook secrets, or installation tokens into issue reports.

## Further documentation

This README is the canonical setup, runtime, workflow, testing, and operational guide. Some files under `docs/` preserve implementation plans, handoffs, or acceptance history and should not be used as current setup instructions.

- [`docs/api.md`](docs/api.md) — detailed API contracts and lifecycle semantics; historical commentary is non-normative.
- [`docs/backend-security.md`](docs/backend-security.md) — authorization matrix, security controls, residual risks, and historical verification evidence.

For implementation work, update the relevant contract, migration, test, and operational documentation together. Current source schemas, migrations, and automated tests take precedence over historical notes. Do not treat frontend visibility, provider responses, queue presence, or client-supplied IDs as authorization evidence.
