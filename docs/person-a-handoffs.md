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

The password-forgot response is non-enumerating. Session tokens remain cookie-only and never appear in DTOs. The response contains public user data and a CSRF token only. State-changing authenticated requests send that token in the frozen `X-CSRF-Token` header.

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
- 21 unit/contract tests passed
- 8 database/API integration tests passed
- cross-report artifact/revision ownership was rejected by PostgreSQL
- seed reruns were verified not to reset credentials, re-enable users, relink GitHub identities, or reassign ownership
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

## Day 2 — authentication backend and Day 3 GitHub contract

**Status:** implementation complete; ready for integration after exact-commit review.

### Done

- Implemented `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/password/forgot`, and `POST /api/v1/auth/password/reset`.
- Passwords use Argon2id. Opaque session credentials are cookie-only and persisted only as keyed hashes.
- Session cookies are HTTP-only, `SameSite=Lax`, API-wide, seven days, and `Secure` in production.
- CSRF tokens are deterministically recoverable only with the HTTP-only session credential and server secret; authenticated mutations validate `X-CSRF-Token` against a persisted hash.
- Disabled, revoked, and expired sessions fail closed. Password reset is single-use and atomically revokes all active sessions.
- Forgot-password responses do not distinguish known, unknown, disabled, or email-less accounts.
- Redis enforces direct-address and normalized-principal limits for registration, login, forgot, and reset. Untrusted forwarded-address headers do not change the limiter principal, and a blocked direct address cannot churn new principal keys.
- Security-relevant successful transitions create audit events without raw credentials or tokens.
- Added reusable session authentication guard, CSRF guard, and current-session decorator for later authorized APIs.

### Database/migrations

Migration `20260812013500_authentication`:

- adds a unique CSRF-token hash to each session;
- revokes any pre-Day-2 session rows that cannot satisfy the new CSRF contract;
- adds PostgreSQL case-insensitive unique indexes for Trace usernames and optional emails.

The schema and migration remain aligned. A database integration test proves the case-insensitive constraints reject conflicting rows independently of API prechecks.

### Frozen Day 3 GitHub contract

Published in:

- `packages/shared/src/github.ts`
- `packages/shared/test/github.spec.ts`
- `packages/shared/test/fixtures/github/`
- `docs/api.md`

Frozen operations:

- `POST /api/v1/github/connect`
- `GET /api/v1/github/callback`
- `GET /api/v1/github/status`
- `POST /api/v1/github/reconnect`
- `POST /api/v1/github/disconnect`

The contract keeps Trace account connection separate from GitHub App installation authorization, uses only backend-provided HTTPS GitHub authorization URLs, exposes closed callback outcomes, never exposes provider/state/token details, and guarantees `historyRetained: true` on disconnect.

No GitHub controller, provider adapter, OAuth exchange, App installation, repository synchronization, frontend, or CLI behavior was implemented on Day 2.

### Password-reset delivery boundary

The API creates hashed, expiring, single-use reset tokens and invokes `PasswordResetDelivery`. No outbound email vendor was specified for Day 2, so the default adapter is deliberately silent and never logs or exposes the raw token. A deployment must bind an approved delivery provider before claiming user-facing email delivery; endpoint/token consumption semantics are implemented and integration-tested independently of a vendor.

### Verification record

Executed with disposable PostgreSQL and Redis services, including a migration from an empty volume, repeatable seed, focused RED/GREEN authentication execution, full root gates, production-cookie/runtime probes, dependency failure checks, and cleanup.

Final recorded results:

- 25 unit/contract tests passed.
- 16 database/API integration tests passed.
- Registration → session → current user → CSRF rejection → logout → session rejection passed against real PostgreSQL/Redis.
- Generic invalid credentials, disabled accounts, case-insensitive conflicts, non-enumerating forgot, reset replay rejection, credential rotation, session revocation, audit non-disclosure, and normalized-account rate limiting passed.
- Shared GitHub contract fixtures and closed error/result enums passed.
- Lint, typecheck, build, production dependency audit, and whitespace checks passed.
- No Day 3 implementation or Person B-owned files were changed.
