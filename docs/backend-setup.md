# Backend setup

## Scope

This document covers the Day 1 backend foundation and Person A's Day 2 authentication backend. GitHub OAuth/App installation, webhooks, queues, report generation, storage, frontend behavior, and the future CLI remain unimplemented.

## Requirements

- Node.js 22 or newer
- Corepack
- Docker Engine with Docker Compose

The repository pins pnpm through the root `packageManager` field.

## Install

```bash
corepack enable
corepack pnpm install
cp .env.example .env
```

Keep `.env` local. It is ignored by Git. Before any production start, replace every placeholder and use externally managed secrets. Production config rejects missing, weak, or known placeholder session secrets.

## Local dependencies

```bash
corepack pnpm infra:up
docker compose ps
```

The Compose stack binds PostgreSQL and Redis to loopback only:

- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`

Both services include health checks and persistent named volumes.

Stop services without deleting data:

```bash
corepack pnpm infra:down
```

Delete local service data only when a clean database is explicitly required:

```bash
docker compose down -v
```

## Database lifecycle

Generate the Prisma client and validate the schema:

```bash
corepack pnpm db:generate
corepack pnpm --filter @trace/database db:validate
```

Apply committed migrations:

```bash
corepack pnpm db:migrate
```

Create a migration during an intentional schema change:

```bash
corepack pnpm --filter @trace/database db:migrate:dev -- --name descriptive_name
```

### Development seed

The deterministic seed is blocked in production and requires an explicit opt-in:

```bash
ALLOW_DEMO_SEED=true corepack pnpm db:seed
```

It creates only fictional `.test` users and fake GitHub identifiers. The development-only password is `TraceDevOnly!2026`. Never enable the demo seed in a shared or production environment. The seed addresses records only through reserved `seed_*` IDs. Reruns leave existing records unchanged, and natural-key collisions fail rather than overwriting unrelated data.

## API

Start in development:

```bash
corepack pnpm --filter @trace/api dev
```

Build and run compiled output:

```bash
corepack pnpm build
corepack pnpm --filter @trace/api start
```

The default port is `3001`. The root liveness and readiness endpoints are deliberately outside `/api/v1`; all product APIs are versioned under `/api/v1`.

## Quality gates

With PostgreSQL and Redis healthy:

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

The integration suite verifies PostgreSQL constraints, per-user repository tracking, deterministic seed behavior, root health endpoints, dependency readiness, request IDs, the centralized safe error envelope, and the complete authentication lifecycle.

## Authentication behavior

The implemented `/api/v1/auth` endpoints are documented in `docs/api.md`. Authentication requires `SESSION_SECRET`; if it is unavailable, auth requests fail closed while `/health` remains usable. Production also rejects missing or placeholder secrets during configuration loading.

- Passwords use Argon2id.
- Opaque session tokens exist only in an HTTP-only `trace_session` cookie and are stored as keyed hashes.
- The cookie uses `SameSite=Lax`, API-wide path `/api/v1`, a seven-day maximum age, and `Secure` in production.
- Authenticated mutations require the response's CSRF token in `X-CSRF-Token`.
- Redis-backed fixed-window limits apply first per direct client address and then per normalized account/identifier, so already-blocked traffic cannot churn principal keys. Forwarded-address headers are not trusted by the application.
- Password-reset tokens expire after 30 minutes, are stored only as SHA-256 hashes, are single-use, and revoke every active session when consumed.
- Forgot-password responses remain identical for known and unknown identifiers. Eligible-account issuance runs asynchronously behind a per-user Redis lock, while the public response completes in the same randomized minimum window even if delivery is slower.
- A replacement reset token does not invalidate the previous token until the delivery boundary succeeds. Failed replacements are deleted; successful replacements consume prior outstanding tokens.
- Security-relevant successful transitions are recorded without raw passwords, session tokens, CSRF tokens, or reset tokens.

The password-reset endpoint invokes the `PasswordResetDelivery` boundary. Tests use an in-memory adapter. Non-test deployments bind an unavailable adapter and return `503 SERVICE_UNAVAILABLE` for every forgot-password identifier until an approved, bounded enqueue/delivery provider replaces it; no usable replacement token is persisted through a silent no-op.
