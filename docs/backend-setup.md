# Backend setup

## Scope

This document covers the Day 1 backend foundation only. It does not enable authentication, GitHub OAuth, GitHub App installation, webhooks, queues, report generation, storage, or the future CLI.

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

It creates only fictional `.test` users and fake GitHub identifiers. The development-only password is `TraceDevOnly!2026`. Never enable the demo seed in a shared or production environment. Running the seed repeatedly converges on the same records rather than adding duplicates.

## API

Start in development:

```bash
corepack pnpm dev:api
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

The integration suite verifies PostgreSQL constraints, per-user repository tracking, deterministic seed behavior, root health endpoints, dependency readiness, request IDs, and the centralized safe error envelope.
