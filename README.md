# Trace

Trace turns GitHub engineering activity into deterministic, user-requested reports. This repository is a pnpm TypeScript monorepo.

## Current implementation

Day 1 provides:

- NestJS API foundation in `apps/api`
- PostgreSQL/Prisma package in `packages/database`
- validated environment configuration in `packages/config`
- versioned shared API contracts in `packages/shared`
- local PostgreSQL and Redis services through Docker Compose

The web application and all post-Day-1 backend features remain intentionally unimplemented.

## Quick start

Requirements: Node.js 22+, Corepack, and Docker with Compose.

```bash
corepack enable
corepack pnpm install
cp .env.example .env
corepack pnpm infra:up
corepack pnpm db:migrate
ALLOW_DEMO_SEED=true corepack pnpm db:seed
corepack pnpm build
corepack pnpm dev:api
```

The API listens on `http://localhost:3001` by default:

- `GET /health` — process liveness
- `GET /ready` — PostgreSQL and Redis readiness
- application APIs use the `/api/v1` prefix

See `docs/backend-setup.md` for setup, reset, validation, and seed safety details. API contracts are documented in `docs/api.md`.

## Plans and specifications

- `docs/plans/PERSON_A_REVIEWED_PLAN.md`
- `docs/plans/PERSON_B_IMPLEMENTATION_PLAN.md`
- `docs/prompts/`
