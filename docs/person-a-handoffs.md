# Person A handoffs

## Day 1 — backend foundation and Day 2 auth contract

**Status:** ready for integration after Person B reviews the frozen auth contract.

### Published frozen contract

The complete Day 2 authentication contract is published in:

- Schemas and inferred DTO types: `packages/shared/src/auth.ts`
- Error envelope: `packages/shared/src/errors.ts`
- Request and success-response fixtures: `packages/shared/test/fixtures/auth/`
- Contract tests: `packages/shared/test/auth.spec.ts`
- Method/path/request/response documentation: `docs/api.md`

Frozen paths:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/password/forgot`
- `POST /api/v1/auth/password/reset`

The password-forgot response is non-enumerating. Session tokens remain cookie-only and never appear in DTOs. The response contains public user data and a CSRF token only.

### Provisional contracts

The GitHub, repository, activity, pagination, and report schemas in `packages/shared` are provisional. Person B must not treat those shapes as frozen until their scheduled handoff days.

### Backend foundation

- NestJS application with `/api/v1` product prefix
- root `GET /health` liveness endpoint
- root `GET /ready` PostgreSQL and Redis readiness endpoint
- request IDs and centralized safe errors
- validated environment configuration with production placeholder rejection
- Prisma PostgreSQL schema, initial migration, lifecycle service, and deterministic gated seed
- composite ownership constraint preventing report artifacts from referencing another report’s revision
- canonical commit uniqueness on `(repositoryId, sha)`
- per-user repository tracking through `UserRepository`
- local loopback-only PostgreSQL and Redis Compose services

No authentication endpoint implementation, GitHub integration, webhook processing, workers, reports, frontend, or CLI functionality was added on Day 1.

### Verification record

Executed on the Day 1 branch with PostgreSQL and Redis containers:

```bash
docker compose down -v --remove-orphans
docker compose up -d postgres redis
corepack pnpm db:generate
corepack pnpm db:migrate
ALLOW_DEMO_SEED=true corepack pnpm db:seed
ALLOW_DEMO_SEED=true corepack pnpm db:seed
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm test:integration
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --prod
```

Actual results:

- committed initial migration applied successfully to a newly created empty PostgreSQL volume
- repeatable seed completed twice with no duplicate deterministic entities
- Jest harness matched the required backend test stack
- 20 unit/contract tests passed
- 7 database/API integration tests passed
- cross-report artifact/revision ownership was rejected by PostgreSQL
- lint passed for all backend packages
- TypeScript typecheck passed for all backend packages
- all backend packages built successfully
- production dependency audit reported no known vulnerabilities
- compiled runtime returned `200` from `/health` and `/ready` with PostgreSQL/Redis healthy
- with Redis stopped, `/health` remained `200` and `/ready` returned a safe `503 DEPENDENCIES_UNAVAILABLE`
- with PostgreSQL and Redis stopped, readiness completed within its two-second bound instead of hanging
- a cold API start without either dependency still exposed `/health` and safely returned `503` from `/ready`
- arbitrary internal 5xx messages were covered by a non-disclosure test
- independent review findings were resolved; no frontend or CLI implementation files were changed
- the temporary API process, containers, networks, volumes, and seeded verification data were removed after verification
