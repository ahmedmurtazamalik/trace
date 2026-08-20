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
- Forgot-password responses do not distinguish known, unknown, disabled, or email-less accounts in status, body, or randomized response timing. Eligible-account issuance continues asynchronously behind a renewable per-user Redis lock; a PostgreSQL-locked snapshot limits each issuer to retiring only tokens that already existed before it.
- Reset-token replacement preserves the previous valid token until delivery succeeds; failed replacements are removed, and successful replacements consume prior outstanding tokens.
- Password-reset delivery is an injectable boundary. Tests use an in-memory adapter; non-test deployments fail closed with `503 SERVICE_UNAVAILABLE` for every identifier until an approved bounded provider is bound.
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

- `POST /api/v1/github/connect` with `X-CSRF-Token` (also used to reconnect; hardened on Day 11)
- `GET /api/v1/github/callback`
- `GET /api/v1/github/status`
- `DELETE /api/v1/github/connection`

The contract keeps Trace account connection separate from GitHub App installation authorization, uses only backend-provided HTTPS GitHub authorization URLs, validates both successful and provider-denied callbacks, exposes closed callback outcomes, never exposes provider/state/token details, and guarantees `historyRetained: true` on disconnect.

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

---

## Day 4 — Person A

### Done

- Added installation-authorized repository enumeration to the GitHub adapter while keeping App JWTs and installation tokens method-local.
- Implemented authenticated, CSRF-protected repository synchronization by stable GitHub repository ID.
- Added installation-local generation fencing plus a global claim sequence and deterministic stable-ID locks, so stale same-installation or cross-installation provider snapshots cannot overwrite a newer synchronization or repository transfer.
- Added global repository access-removal metadata while preserving repository/activity history and per-user memberships.
- Implemented user-authorized repository list/detail with bounded search, filter-bound opaque cursor pagination, latest activity, and distinct contributor summaries.
- Implemented canonical idempotent `POST` enable and `DELETE` disable tracking routes with per-user state and fail-closed removed-access handling.
- Froze strict Day 5–7 activity/dashboard filters, source/type enums, cursor responses, factual summaries, dashboard states/metrics, and fixtures.
- Updated backend API documentation; no Person B-owned frontend files were changed.

### Contracts published or changed

- Implemented repository routes: `POST /api/v1/repositories/sync`, `GET /api/v1/repositories`, `GET /api/v1/repositories/:id`, `POST /api/v1/repositories/:id/tracking`, and `DELETE /api/v1/repositories/:id/tracking`.
- Preserved the frozen Day 3 repository DTOs, including `lastActivityAt`, `contributorCount`, separate `accessible` and `trackingEnabled`, and canonical `POST` enablement.
- Frozen Day 5–7 schemas: `ActivityListQuery`, `ActivityListResponse`, `DashboardQuery`, and `DashboardResponse`.
- Fixtures: `packages/shared/test/fixtures/activity/**` and `packages/shared/test/fixtures/dashboard/**`.
- The report contract remains provisional until its scheduled Day 7 freeze.

### Database/migrations

- Migration: `20260812130000_repository_access_state`.
- Adds nullable global and per-user `access_removed_at` cutoffs to retain history without exposing activity imported after access ends.
- Adds `github_installations.sync_generation` for synchronization fencing.
- Does not move tracking state onto global repository rows; `UserRepository.trackingEnabled` remains authoritative per user.

### Verification record

- Clean disposable PostgreSQL database: all five migrations applied, guarded deterministic seed passed, 6 database integrations passed, and the database was removed.
- API integration: 26 passed, including 7 repository synchronization/list/detail/tracking cases.
- Shared/provider contracts: 19 shared tests and 4 GitHub adapter tests passed.
- Workspace unit/component tests passed, including 50 web tests.
- Workspace lint and typecheck passed.
- Production API/web builds passed.
- Production dependency audit reported no known vulnerabilities.
- Production-server Playwright passed 38/38 desktop/mobile tests.
- `git diff --check` passed.

### Deferred by plan

- Webhook acceptance and ingestion remain Day 5.
- GitHub activity normalization/processing remains Day 6.
- Activity/dashboard endpoint implementation remains Day 7; Day 4 publishes only their frozen contracts and fixtures.
- The GitHub App installation-start frontend action remains outside Person A ownership and was not implemented.

---

## Day 5 — Person A

### Done

- Added `POST /api/v1/webhooks/github` with a route-specific 256 KiB raw JSON parser. HMAC-SHA256 is verified against the exact request bytes before JSON decoding.
- Enforced lowercase canonical delivery UUIDs, supported `push` events, strict signature format, and a bounded push envelope containing ref/SHAs, installation, stable repository ID, sender, and strictly validated nested commit fields.
- Resolved installation/repository authority exclusively from current server state. Suspended installations, disconnected accounts, removed repository access, disabled users, removed memberships, and wholly untracked repositories are acknowledged without persistence or queueing.
- Serialized account/user authority with disconnect and disable flows, then serialized delivery IDs transactionally with a PostgreSQL advisory lock and retained the unique database constraint. Conflicting delivery-ID reuse fails closed.
- Persisted the validated bounded JSON payload, digest, and durable `publishedAt` queue-publication marker through upgrade-safe migration `20260812144000_webhook_payload`; legacy rows are retained but terminally quarantined before the payload column becomes non-null, and the obsolete status/received-time index is replaced rather than retained beside the reconciliation index.
- Added deterministic BullMQ jobs containing only the durable delivery-row ID, with five exponential-backoff attempts and bounded completed/failed job retention.
- Added autonomous startup/periodic publication reconciliation for pending rows, independent of GitHub retries and later authority changes. Request-path publication is bounded and deterministic re-adds close the Redis/marker crash window.
- Established request correlation before all body parsers so oversized webhook and general API requests retain their request ID in the scoped `413` envelope.
- Added the `@trace/worker` workspace package with Redis readiness, monitored fatal run-loop completion, SIGINT/SIGTERM handling, one absolute shutdown deadline covering pause, queue inspection, graceful close, and run-loop settlement, immediate catch-observed force-close/disconnect fallback, and sanitized BullMQ failure persistence even when terminal observability itself fails. Failed-start cleanup uses the same bounded principle and catch-observes any run loop before cleanup can trigger a late rejection. Processing remains an injected Day 6 boundary and the executable fails closed until a real processor is composed.
- Added real PostgreSQL/Redis integration coverage for valid and conflicting concurrent delivery reuse, malformed/case-variant IDs, invalid signatures, oversized requests, unsupported/untracked/revoked authority, publication failure and deterministic replay, migration of an existing ledger row, queue references, retries, observability failure, fatal runtime failure, and forced shutdown.
- No `apps/web/**` or `packages/ui/**` files were changed.

### Integration boundary

- Redis jobs contain `{ deliveryId }` only. Day 6 reads the durable row and processes its validated `payload`.
- Worker terminal-failure callbacks receive only the delivery row ID and stable code `WEBHOOK_PROCESSING_FAILED`; raw exception or payload text is neither passed to observability nor retained in BullMQ failure fields.
- The queue and API both default to `github-webhook-deliveries`. Worker concurrency must remain within 1–32.
- Webhook retries retain an independent durable publication obligation while authority remains valid. Day 11 supersedes the original acceptance semantics: every publication and worker attempt revalidates current installation, repository, user, membership, and tracking authority, and later revocation terminally rejects pending work rather than processing it.

### Deferred by plan

- Push/commit normalization, enrichment, activity persistence, and processing-state transitions remain Day 6.
- AI calls and report generation remain outside webhook request and worker acceptance infrastructure.

---

## Day 6 — Person A

### Done

- Composed the real GitHub activity processor into the existing `github-webhook-deliveries` worker; the executable now validates PostgreSQL, Redis, and GitHub App configuration and closes Prisma with BullMQ on signals or fatal run-loop failure.
- Reads only the durable internal delivery-row ID from Redis and validates the complete delivery → installation → repository authority chain against stable external IDs. Day 11 supersedes the original post-acceptance behavior: later revocation terminally rejects pending work, while concurrent repository reassignment cannot race canonical persistence.
- Stores one push per GitHub delivery UUID and one commit per repository+SHA, with repository-relative file paths/statuses and generic push/commit activity rows.
- Assigns contributor foreign keys only from stable GitHub numeric user IDs. Webhook author/committer name, email, and optional username are retained as raw facts and are never used to guess identity.
- Uses deterministic activity `sourceKey` values for push and commit idempotency. Concurrent overlapping deliveries in one worker process coalesce the same repository+SHA enrichment request through transaction completion; all processes converge through database uniqueness on one commit and one commit activity.
- Adds bounded GitHub API enrichment only for unseen commits. Each request has a fixed timeout and streamed response-byte cap, commit-file pagination is capped at three 100-file pages, repository paths and numeric/string facts are bounded, malformed provider facts fail closed, and App/installation credentials remain request-local.
- Persists enriched authored/committed times, stable contributor identities, numeric commit totals, and per-file additions/deletions/rename paths when available; the bounded accepted webhook facts remain sufficient when enrichment is not configured in tests.
- Migration `20260812190000_github_activity_processing` adds raw author/committer facts and unique activity source keys. Existing rows are retained with explicit legacy-unavailable identity facts and deterministic `legacy:<activity-id>` keys before non-null/unique enforcement.
- Terminal retries retain the Day 5 five-attempt policy and persist only `WEBHOOK_PROCESSING_FAILED`; raw database, Redis, provider, and payload errors are not stored in BullMQ terminal metadata.

### Verification boundary

- Real PostgreSQL tests cover delivery retry idempotency, concurrent overlapping pushes, stable-ID contributor normalization, file metadata, malformed-payload rollback, and historical populated-schema migration.
- A signed mocked push → Nest webhook acceptance → PostgreSQL ledger → Redis/BullMQ → production worker/processor → PostgreSQL gate proves duplicate delivery creates exactly one canonical push, commit, and activity set.
- No `apps/web/**`, `packages/ui/**`, activity API, dashboard API, AI, or report functionality was added.

### Deferred by plan

- Activity/dashboard endpoint implementation, authorization, date filters, timezone boundaries, and cursor pagination remain Day 7.
- Report aggregation and all AI/rendering work remain Days 8–10.

---

## Day 7 — Person A

### Done

- Added authenticated `GET /api/v1/activity` and `GET /api/v1/repositories/:id/activity` routes backed by canonical PostgreSQL `ActivityEvent` rows.
- Enforced caller authorization exclusively through Trace session identity and `UserRepository` membership. Unassociated repository routes fail with `404`; events are visible only inside the current inclusive membership interval from `createdAt` through optional `accessRemovedAt`, and restored access resets the lower boundary.
- Served only GitHub activity until opt-in CLI ingestion can persist explicit Trace-user/device ownership; repository membership alone cannot authorize another user's local work.
- Implemented bounded repository, contributor, source, type, local-date, timezone, cursor, and limit filters. Local dates use true half-open IANA calendar days, including daylight-saving transitions.
- Added deterministic descending `(occurredAt, id)` pagination with versioned HMAC-signed opaque cursors bound to the authenticated user, complete normalized query, and route repository.
- Projected only the frozen strict activity summary. Required source/type and repository facts fail closed when malformed; optional stored metadata is revalidated and bounded, and unsafe links normalize to `null` rather than exposing arbitrary metadata or invalidating the response.
- Froze the complete Days 8–10 report contract and fixtures: lifecycle/list/detail, nonempty structured prose edits, expected-revision conflict semantics, regeneration, unique artifact selection/download metadata, closed error codes, and lifecycle/artifact consistency.
- Kept deterministic report facts and repository/contributor structure server-owned. Edits are bounded prose patches keyed to the current immutable ID sets and exclude arbitrary LaTeX, metrics, storage keys, filesystem paths, and unknown mutation fields.

### Verification boundary

- PostgreSQL integration coverage proves session authorization, repository isolation, historical cutoff behavior, combined activity filters, signed filter/user-bound cursor validation and tamper rejection, stable tie-breaking, Asia/Karachi local dates, DST 23-hour and 25-hour days, skipped-civil-date rejection, unsafe URL removal, invalid source/type exclusion, and malformed optional metadata handling.
- Shared contract tests validate success fixtures, strict edit boundaries, lifecycle invariants, current PDF requirements, mutation wrappers, artifact selection, and report error vocabulary.
- No `apps/web/**`, `packages/ui/**`, database schema/migration, worker, report endpoint, AI, LaTeX, storage, push, PR, or merge work is included.

### Deferred by plan

- Dashboard endpoint implementation is not part of Person A's reviewed Day 7 task and remains unimplemented despite its previously frozen shared DTO.
- Report persistence, owner-authorized endpoints, factual aggregation, queue/worker orchestration, AI validation/retry, revision history, regeneration behavior, deterministic rendering, sandboxed compilation, storage, and byte-stream download remain Days 8–10.

---

## Day 8 — Person A

### Done

- Added authenticated `POST /api/v1/reports`, `GET /api/v1/reports`, and `GET /api/v1/reports/:id` handlers using the frozen Day 7 shared contracts; report creation enforces the session CSRF token.
- Aggregated only canonical GitHub commit activity authorized through the caller's active GitHub account, installation, repository access, and enabled tracking relationship inside the requested half-open IANA local day.
- Persisted a versioned immutable snapshot with deterministic global, repository, contributor, and evidence facts. Invalid stored commit metadata is excluded rather than guessed, and aggregation fails safely above 10,000 accepted activity rows or 500,000 UTF-8 bytes of evidence messages.
- Enforced one report per user/date with `409 REPORT_ALREADY_EXISTS`; queue availability does not roll back the durable pending report.
- Published retained deterministic BullMQ jobs to `report-generation` as `generate-report`, with job ID `report-<reportId>` and payload `{ reportId }`; retention preserves lifetime deduplication while the report remains pending.
- Added a durable `publishedAt` observation plus startup/interval reconciliation for every pending report, including previously published rows, so lost Redis jobs are recreated. Repeated and multi-instance reconciliation remains queue-idempotent through the deterministic job ID.
- Added owner-only report history/detail reads. Foreign IDs fail indistinguishably with `404 REPORT_NOT_FOUND`; list pagination uses signed opaque cursors bound to user, status, and limit with descending `(createdAt, id)` ordering.
- Kept report lifecycle output truthful: pending reports expose no generated prose, revision, completion timestamp, artifacts, or download availability.

### Verification boundary

- PostgreSQL/Redis integration coverage proves timezone-aware authorized aggregation, immutable snapshot persistence, deterministic queue identity, duplicate conflict handling, CSRF enforcement, explicit queue-failure recovery, multi-publisher reconciliation, owner isolation, and filter-bound pagination.
- API lint and strict TypeScript checks pass for the Day 8 implementation.
- No `apps/web/**`, `packages/ui/**`, LLM call, report processor, revision generation, LaTeX compilation, storage, download, push, PR, or merge work is included.

### Deferred by plan

- Structured AI generation, provider validation/retries, safe failure persistence, and initial report revision creation remain Day 9.
- Controlled LaTeX rendering, artifact storage, revision edits, regeneration, and authorized downloads remain Day 10.

---

## Day 9 — Person A

### Done

- Added a strict versioned parser for immutable Day 8 report snapshots and a configurable structured-output provider boundary.
- Added a deterministic fake provider for local development and tests. Production rejects the fake provider.
- Replaced the HTTPS/Gemini-compatible provider with authenticated local Codex CLI inference using strict JSON-schema output, ephemeral child processes, read-only sandboxing, process deadlines, byte bounds, request-local identifier aliases, grounded validation, and one repair attempt.
- Validated generated content with the frozen shared report schema and exact repository/contributor membership from the immutable snapshot; unknown, duplicate, missing, and cross-repository identifiers fail validation.
- Added the `report-generation` BullMQ consumer for only `generate-report` jobs carrying a bounded `{ reportId }` reference.
- Added bounded provider/schema retries and a closed `Report generation failed.` terminal error that does not persist provider details.
- Created exactly one initial editable `ai` revision and mirrored it to `aiOutput`; idempotent reprocessing does not create another revision.
- Kept generated reports in `processing` with `completedAt = null`; only Day 10 may transition to `completed` after storing a downloadable artifact.
- Started the report and GitHub activity consumers from the worker entrypoint and closed them in reverse order.

### Configuration

- `REPORT_LLM_PROVIDER=fake|codex` (`fake` is forbidden in production).
- `REPORT_CODEX_COMMAND` defaults to `codex`; production images pin the CLI version.
- `REPORT_CODEX_MODEL` defaults to `gpt-5.6-sol`; `REPORT_CODEX_TIMEOUT_MS` is bounded to 1–75 seconds so the maximum two CLI calls remain below the 180-second report lease.
- Production mounts a dedicated authenticated CLI home through `TRACE_CODEX_HOME`.
- The API queue owns the fixed three-delivery retry budget. Each delivery permits one initial Codex call and at most one schema/grounding repair call.
- `REPORT_WORKER_CONCURRENCY` is bounded to 1–16 (default 2).
- Queue name is frozen as `report-generation` on both API producer and worker consumer.
- A short database claim stores a renewable processing token and expiry; provider network I/O occurs outside transactions, and a fenced transaction persists only the owning token's result.
- Schema/transient provider retries are bounded inside the processor. BullMQ uses three backed-off attempts only for sanitized infrastructure/job failures; permanent malformed jobs are unrecoverable, retained failed jobs are retried, and retained completed jobs are replaced when reconciliation still finds no revision.
- Codex runs through direct argv and stdin with disabled agent tools, a sanitized environment, bounded prompt/output files, and strict schema/grounding validation.

### Deferred by plan

- No arbitrary LaTeX, compilation, storage, artifact, download, revision-edit endpoint, regeneration, or `completed` transition is included; those remain Day 10.

---

## Day 10 — Person A

### Done

- Added deterministic fixed-template LaTeX rendering of frozen structured report revisions with exact snapshot repository/contributor correspondence, complete TeX metacharacter escaping, control-character rejection, and a 2 MiB expanded UTF-8 source bound. The exact first-render source is frozen on the revision and reused with any already persisted immutable objects, so same-revision regeneration remains stable across renderer/compiler deployments.
- Added a pinned XeLaTeX image and direct-argv Docker compiler boundary with no network or shell escape, read-only root, dropped capabilities, no-new-privileges, non-root execution, fixed entrypoint/paths, bounded CPU/memory/PIDs/time, 32 MiB intermediate and 64 MiB temporary `tmpfs` mounts, a fixed reproducible build epoch, bounded structural PDF parsing, orphan-container termination, and deterministic host-temp cleanup.
- Added shared filesystem artifact storage with restrictive owner/report/revision/generation/attempt keys, traversal and intermediate/final symlink rejection, no-follow file handles with pre/post `fstat` verification, bounded reads, killable child-process write boundaries, atomic idempotent immutable objects, and explicit production persistent-volume configuration. Generation/attempt-scoped objects are staged outside database transactions; sibling failures trigger shared cancellation and full settlement before only a still-current revision/generation/lease may atomically activate artifacts.
- Added authoritative `currentRevisionId`, monotonic render generations, durable render obligations, independent bounded initial/render publication batches with pre-I/O attempt-clock rotation, database-clock processing leases longer than the maximum compiler timeout, and exact current-revision/generation/lease fences. Failed publication cohorts cannot starve later obligations, and stale or expired workers cannot activate artifacts or silently consume failed jobs.
- Backfilled pre-Day-10 structured processing reports into render obligations and enforced current-revision ownership while preserving ordinary report/revision deletion cascades.
- Enforced non-null artifact revision ownership, one artifact per report/revision/kind, positive bounded sizes, and lowercase SHA-256 checksums at the database layer.
- Added owner-only, CSRF-protected revision update and regeneration routes. Manual edits create immutable sparse-prose revisions; regeneration preserves current content and rerenders it rather than invoking the narrative provider.
- Added owner-only current-artifact downloads that authorize through report relationships, reject foreign artifact IDs, perform bounded storage reads, and verify exact size and SHA-256 before streaming with private/no-store headers.
- Kept lifecycle output truthful: incomplete reports hide historical artifacts, terminal compilation errors remain failed under duplicate/redelivered jobs until an owner requests a new generation, transient storage failures retain a reconciled processing obligation, and only successful object persistence plus atomic database finalization marks a report completed.

### Configuration

- For local development, build `trace-latex:local` with `docker build --tag trace-latex:local infrastructure/latex`. Exercise an exact staged compiler candidate with `pnpm test:latex:docker`; the command rebuilds and tags the image with the current staged tree and passes that exact tag to both real-container tests.
- `NODE_ENV` must be explicitly `development`, `test`, or `production`; missing or unknown modes fail closed before compiler or storage defaults are considered.
- `REPORT_LATEX_IMAGE` is required as an immutable `@sha256:<digest>` image reference in production and defaults to `trace-latex:local` only in explicit non-production modes.
- `REPORT_LATEX_TIMEOUT_MS` is bounded to 5,000–120,000 ms (default 30,000).
- `REPORT_STORAGE_DRIVER=filesystem` is currently the only accepted adapter.
- `REPORT_STORAGE_ROOT` must be an explicit absolute path in production and must be mounted on persistent shared storage visible to API and worker processes.

### Verification boundary

- Renderer, compiler-boundary, real Docker PDF compilation, storage, worker lifecycle/fencing, revision concurrency, regeneration, CSRF, owner isolation, and checksum-verified download tests cover the Day 10 behavior.
- Production never falls back to fake rendering, fake storage, or the deterministic report provider.

### Formal joint gate closure — 2026-08-17

- Integrated the supplied approved theme as the tracked controlled template at `apps/worker/src/latex/templates/trace-report-theme.tex`; the renderer now loads four fixed structural markers from that asset, validates each marker appears exactly once, escapes all inserted data, rejects residual markers, and enforces a 128 KiB template bound.
- Added build-time asset copying and byte-for-byte verification so the compiled worker loads the same reviewed template from `dist/src/latex/templates` rather than falling back to an embedded or runtime-provided template.
- TDD exposed and fixed a real empty-accomplishments edge case: the deterministic provider may validly return an empty list, while an empty LaTeX `itemize` fails compilation. The renderer now omits that box, with focused and real-Docker regression coverage.
- Ran the missing authenticated integration smoke on exact `origin/main` base `329ec3c`: browser report creation → API → isolated PostgreSQL/Redis → report queue/worker → controlled template → sandboxed XeLaTeX → browser revision save → regeneration → stale-revision rejection → checksum-verified PDF download/open.
- Final live result: completed revision 2, real 20,321-byte four-page PDF, exact SHA-256 match, and stale revision rejected with HTTP `409 REPORT_REVISION_CONFLICT`. The browser visibly showed `COMPLETED`, revision-2 `report.tex` and `report.pdf` artifacts, enabled regeneration/download actions, and no clipping or horizontal overflow.
- Day 10's owner edit/regenerate/real-PDF/download gate and the Person A/Person B joint operational gate are formally complete. Live GitHub-provider acceptance remains a separate later-plan boundary.

---

## Day 11 — Person A

### Done

- Completed the backend endpoint authorization/CSRF/authenticity/rate-limit matrix in `docs/backend-security.md`; no endpoint treats frontend visibility as authority.
- Hardened HTTP handling with Helmet, JSON-only general API parsing, conservative caller request-ID validation, generic 5xx responses, and redacted infrastructure/provider logging.
- Required explicit `NODE_ENV=development|test|production`; missing and unknown deployment modes fail closed.
- Added composed Redis-backed per-user, trusted direct-address, and deployment-wide hourly budgets for report creation, revision, regeneration, and repository synchronization. Report create, revision-save, and regeneration UIs preserve `RATE_LIMITED` with explicit wait guidance and preserve permanent `CSRF_INVALID` failures with page-refresh/session-recovery guidance.
- Bound repository/dashboard query inputs, signed repository cursors to caller and query context, and made inaccessible repository filters indistinguishable `404` responses.
- Bounded GitHub response bodies, repository page counts, tokens, and projected identity/repository fields.
- Revalidated live GitHub installation, repository, account, user, access, tracking authority, exact 40- or 64-character object IDs, and every nested commit field before webhook publication and again during worker persistence. Activity contracts and frozen report evidence enforce the same exact object-ID formats. Every pending PostgreSQL row remains an owed deterministic publication so Redis loss is repaired. Fenced attempt clocks rotate rejecting or hanging poison rows fairly before a second delivery/authority lock and revalidation around a bounded queue mutation in an expiring transaction. Queue add/retry mutations run in concurrency-capped helper processes that resolve BullMQ from the API package, are killed and reaped before abort settlement, and are all settled with publisher reconciliation during shutdown; revoked work becomes terminal and canonical activity cannot be created after revocation.
- Moved immutable report-object writes outside database transactions onto report/revision/generation/token-scoped attempt keys under an abort deadline shorter than the lease. Sibling writes share cancellation, are all settled after any failure, and filesystem mutation runs in killable child-process boundaries rather than relying on partial syscall cancellation. Final activation reacquires the report lock and requires the exact live token/revision/generation lease; expired work may leave only unreachable staged objects and cannot create active artifact rows or complete a report.
- Bounded report-detail artifact reads to the current revision and serialized the detail snapshot with report lifecycle mutation.
- Added durable audit rows for GitHub connection/install/disconnect, repository synchronization/tracking, and report create/revision/regeneration mutations.
- Minimized Codex-provider disclosure by replacing database IDs, activity IDs, and commit SHAs with request-local aliases. Private repository names, contributor identities, timestamps, activity types, aggregate facts, and commit messages remain explicit provider prose inputs.
- Upgraded both Vitest consumers and pinned patched Vite `6.4.3`; full and production lockfile audits report no known vulnerabilities.

### Verification

- Workspace package tests passed sequentially; web: 152/152, worker: 92 passed with two intentional Docker-only skips, shared: 25/25, report storage: 5/5.
- PostgreSQL database integration and the complete monorepo test command passed against disposable databases.
- API integration on isolated Redis: 11 suites, 84/84 passed, including retained failed webhook-job recovery, hard helper-process termination, shutdown settlement, and cwd-independent built publication.
- Focused worker authority/artifact integration is included in the passing 92-test worker gate.
- Workspace lint, strict TypeScript, and production build passed.
- Real Docker XeLaTeX acceptance: 2/2 passed.
- Integrated desktop/mobile Playwright: 62/62 passed.
- Full and production `pnpm audit --audit-level=low`: no known vulnerabilities.

### Residual risks

- Configured LLM use is an operator opt-in and intentionally discloses the documented prose inputs to the selected provider; provider contractual retention, region, and deletion guarantees are operational responsibilities.
- Burst rate limits are not lifetime storage quotas. Retention, account quotas, audit retention, and operational alerting remain production policy work.
- Live GitHub/LLM credentials were not used during acceptance; controlled adapters cover their bounded and fail-closed contracts.
- Filesystem report storage requires a persistent shared production volume; multi-host object storage is not claimed.
- Password-reset delivery remains fail-closed until an approved bounded delivery provider is configured.


## Day 13 — Person A

### Done

- Added non-root multi-stage API and worker images plus a dedicated non-root migration target with OpenSSL-compatible Prisma runtime packaging.
- Added backend-only production-like Compose with digest-pinned PostgreSQL/Redis, required immutable application images, internal data networking, API/worker egress, hardened migration gating, health/readiness, read-only filesystems, dropped capabilities, bounded stop windows, persistent report storage, and isolated LaTeX compilation.
- Added a fail-closed generated-Prisma payload copier because `pnpm deploy` omits `.prisma/client` from deployed workspace bundles; the deployment contract and live container startup prove the repair.
- Added a host-shared absolute `REPORT_LATEX_WORK_ROOT` contract so a containerized worker can provide paths visible to the host Docker daemon.
- Added a production JSON logger controlled by `LOG_LEVEL`; sanitized request events contain correlation ID, method, path without query, status, bounded duration, and a completed/aborted outcome exactly once.
- Propagated one absolute worker shutdown deadline into both concurrently closing BullMQ consumers and resource cleanup, with a bounded forced-cleanup reserve inside that deadline; the production container grace period exceeds the complete application budget.
- Added executable backend smoke automation, immutable-image validation, backend operations/rollback documentation, and GitHub App setup/rotation documentation.
- Pinned transitive `deepmerge-ts` to patched `8.0.0` after hosted production audit surfaced `GHSA-ggr8-5vv4-36mx`; Prisma generate/validate and migration packaging remain green, and both production/full audits report no known vulnerabilities.
- Changed no root README, `apps/web/**`, `packages/ui/**`, frontend docs, or Person B handoff path.

### Contracts published or changed

- Endpoint/schema: no API endpoint or database schema change; `/health` and `/ready` behavior is unchanged and now used as deployment gates.
- Contract version: Day 13 backend deployment contract v1 (`pnpm test:deployment`, `pnpm smoke:backend`).
- Backward-compatible impact: additive deployment, logging, and worker configuration behavior; bare-host development continues to default LaTeX work files to the OS temporary directory.
- Fixture path: `infrastructure/test/deployment-contract.test.mjs`; live workflow: `infrastructure/scripts/smoke-backend.sh`.

### Database/migrations

- Migration: no new migration; the migration image applied all 18 existing migrations from zero.
- Data implications: PostgreSQL and report-artifact volumes persist across ordinary Compose restarts; rollback remains forward-fix or verified pre-deploy backup restoration, never improvised down SQL.

### Configuration

- New/changed environment variables: `REPORT_LATEX_WORK_ROOT` is optional outside production and required as an absolute host-shared path in production; `WORKER_SHUTDOWN_TIMEOUT_MS` defaults to 210 seconds; `DOCKER_SOCKET` selects the host socket mounted into the worker.
- Production Compose also requires externally supplied database, session, GitHub App, report-provider, immutable API/migration/worker/compiler images, Docker-group, and host work-root settings documented in `docs/backend-operations.md`; no credentials or concrete production values are committed.

### Tests and builds actually run

- Command: `pnpm smoke:backend`.
- Result: `BACKEND_SMOKE_PASS` on a fresh Compose project; immutable local image IDs, all 18 migrations in the hardened one-shot container, production API/worker startup, `/health` and `/ready`, UID `1000`, Docker client/socket access, real 3,729-byte PDF compile, active webhook/report queue drain, bounded SIGTERM stop, and cleanup passed.
- Command: `bash /tmp/trace-person-a-day13-acceptance.sh`.
- Result: `DAY13_ACCEPTANCE_PASS` on base `68b70772ffffbf11b9762d1749a88546471f672b`; 340 workspace tests were collected (338 passed and two intentional Docker-only worker skips), database integration 10/10, API integration 88/88, lint, typecheck, 14-route production build, full and production dependency audits with no known vulnerabilities, real Docker/XeLaTeX 2/2, Playwright desktop/mobile 68/68, diff-check, unchanged working-diff fingerprint, and disposable-service cleanup.
- Logs: `/tmp/trace-day13-acceptance-1784000-logs`.
- Post-review remediation: the reported missing migration CLI was disproven against the exact artifact and built migration image (`prisma 6.19.3`); `pnpm test:deployment` now includes an executable production-bundle regression and passes 6/6. A genuine sequential shutdown-budget finding was fixed with one coordinator deadline, concurrent consumer closure, remaining-time resource cleanup, and an in-budget forced-cleanup reserve. Focused worker lifecycle/queue tests passed 31/31 against disposable Redis, the exhausted-deadline regression passed, worker lint/typecheck passed, fresh full acceptance passed, and a fresh production-like backend smoke passed the active-drain and bounded-stop gates. The initial immutable commit received a clean exact-tree review; the later hosted-audit dependency remediation was rerun as a separate child candidate for fresh review.

### Person B integration notes

- No same-day implementation dependency: Person B Day 13 frontend documentation/polish can proceed independently.
- Mock/fixture path: none required; Person B continues to own `docs/frontend-setup.md`, `docs/user-guide.md`, frontend code, and frontend tests.
- Ownership: this branch contains zero Person B-owned frontend/UI changes.

### Risks

- Docker socket access is root-equivalent on the host. Restrict worker deployment/admin access and dedicate the Docker host or replace the socket boundary before stronger multi-tenant operation.
- `REPORT_LATEX_WORK_ROOT` is a host bind path and must exist with UID `1000` write access at the identical container path.
- Automated acceptance proves local Codex CLI startup; authenticated model inference, live GitHub OAuth/App installation/webhook delivery, and production infrastructure/backup restoration remain environment-specific release gates.
- Nest may report API exit `143` after completing SIGTERM shutdown hooks; forced exit `137` or a grace-period timeout remains a failure.

### Next-day joint gate

- READY.
- Reason: Day 13 backend deployment/operations behavior, documentation, fresh migration, health/readiness, real compiler execution, shutdown, full repository acceptance, and ownership boundaries are proven; external-provider and production-operational acceptance remain explicit Day 14/release gates.
---

## Day 14 — Person A

### Done

- Completed the final backend definition-of-done matrix against the integrated Person A + Person B Day 13 base `0ffbf32914be8ebe7c0abf4a79d8dba04f033278` without adding product scope or changing frontend/UI files.
- Found and fixed a clean-checkout QA defect test-first: `pnpm test:coverage:backend` previously depended on warm generated Prisma/internal-library declarations. The root command now generates Prisma, runs the same five-package internal-library build used by hosted CI, and then runs API/worker coverage; a deployment contract prevents ordering regression.
- Extended the actual CSRF-protected GitHub disconnect integration scenario to prove contributor, push, commit, commit-file, generic activity, repository membership, and immutable report input history all remain present while tracking authority is disabled. Production disconnect behavior was already non-destructive, so no production code changed.
- Pinned all six GitHub Action uses to reviewed full commit SHAs rather than mutable `v4` tags.
- Upgraded the pinned pnpm 10 toolchain from `10.15.1` to `10.34.5` across root metadata, hosted CI, and both production Docker build stages; enabled a seven-day minimum release age, no-downgrade trust policy, and exotic transitive dependency blocking. Frozen install passed without changing the lockfile.
- Ran dependency, secret, static-analysis, and misconfiguration scanners with digest-pinned Gitleaks `8.28.0`, Semgrep `1.136.0`, and Trivy `0.66.0` containers. The final tracked tree has zero undispositioned blocker/high/medium scanner findings.
- Changed no endpoint contract, shared DTO, database schema, migration, API/worker production behavior, `apps/web/**`, `packages/ui/**`, frontend documentation, Person B handoff, or root README.

### Contracts published or changed

- Endpoint/schema: none.
- Contract version: unchanged.
- Backward-compatible impact: QA/release tooling only; the existing disconnect response and retained-history behavior are now covered more completely.
- Fixture path: existing integration fixtures; the direct disconnect history proof is in `apps/api/test/github.integration.spec.ts`.

### Database/migrations

- Migration: none.
- Data implications: none.
- All 18 migrations apply from an empty PostgreSQL database; deterministic seed runs with its explicit `ALLOW_DEMO_SEED=true` safety gate.

### Configuration

- Root package manager: `pnpm@10.34.5`.
- `pnpm-workspace.yaml`: `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, and `blockExoticSubdeps: true`.
- The maturity policy has one version-specific exception, `@napi-rs/wasm-runtime@1.2.3`, because that version was already locked five days after publication and pnpm's legacy deployment-artifact resolver otherwise rejected it. The release contract forbids broadening this to a package-wide wildcard.
- CI action revisions:
  - `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
  - `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
  - `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1`
- `apps/api/Dockerfile` and `apps/worker/Dockerfile` activate pnpm `10.34.5`, matching root and hosted CI policy enforcement.
- No application environment variable changed.

### Tests and builds actually run

- Clean TDD RED: the new coverage-order contract failed because `test:coverage:backend` did not build internal libraries. GREEN: the focused contract and `pnpm build:libraries` passed.
- Strengthened TDD RED: the contract then failed because the referenced root `build:libraries` command did not exist. GREEN: the canonical five-package command was added and executed successfully.
- Independent candidate-2 review reproduced one remaining medium clean-checkout gap: `build:libraries` still required a generated Prisma client. RED/GREEN remediation made `test:coverage:backend` execute `db:generate` before the library build and strengthened the contract to require the exact sequence.
- Candidate-3 production smoke exposed stale pnpm `10.15.1` pins in both production Dockerfiles. A focused RED/GREEN deployment contract now requires `10.34.5` in root metadata, hosted CI, API image builds, and worker image builds.
- Security TDD RED: the release automation contract failed on mutable `actions/checkout@v4`. GREEN: all six action references, pnpm version, and workspace policy assertions passed.
- First immutable candidate acceptance correctly failed when pnpm `10.34.5` applied the seven-day maturity policy while resolving the migration deployment artifact. A focused RED/GREEN contract added the exact locked-version exclusion above; the deployed artifact then executed Prisma CLI `6.19.3` successfully.
- Frozen install: `pnpm 10.34.5`, no lockfile mutation.
- Focused real disconnect history gate: 1/1 passed against disposable PostgreSQL/Redis after all 18 migrations and deterministic seed.
- Backend coverage against disposable PostgreSQL/Redis:
  - API: 18 suites, 108/108; 89.19% statements, 77.54% branches, 89.97% functions, 93.24% lines.
  - Worker: 13 suites passed with one Docker-only suite skipped; 98 passed and two skipped; 80.88% statements, 73.59% branches, 79.37% functions, 86.91% lines.
  - The intentionally lower parent-process coverage in `latex-compiler.ts` remains exercised by the separate real-container gate.
- Deployment contracts: 8/8, including executable Prisma CLI packaging, generated client payload, immutable images, non-root runtime/Compose, pinned automation, clean coverage prebuild, and operations entrypoints.
- Complete exact-tree acceptance: frozen install; 18 migrations; deterministic seed; 167 workspace tests collected, 165 passed and two intentional Docker-only skips; database integration 10/10; API integration 88/88; lint; strict typecheck; 14-route production build; full and production dependency audits; real Docker/XeLaTeX 2/2; standard Playwright 68/68; credential-free mock/axe Playwright 2/2; clean diff/ownership checks.
- Production-like backend smoke: migration image, API/worker startup, `/health`, `/ready`, UID 1000, real PDF compilation, active webhook/report queue drain, bounded SIGTERM shutdown, and run-token cleanup passed.
- Scanner results on the materialized tracked release tree:
  - Gitleaks: one inherited false positive in `docs/plans/PERSON_B_IMPLEMENTATION_PLAN.md:326`; the line is ordinary registration-form prose with no credential/token/assignment and was not suppressed or edited across ownership boundaries. Zero real leaks.
  - Semgrep TypeScript + OWASP rules: initial nine findings were six mutable CI action tags and three missing pnpm policies; all nine were remediated. Final undispositioned blocker/high/medium findings: zero.
  - Trivy filesystem vulnerability/misconfiguration/secret scan at HIGH/CRITICAL: zero findings.
  - `pnpm audit --prod` and full `pnpm audit`: no known vulnerabilities.
- Evidence logs: `/tmp/trace-day14-coverage-day14-coverage-2450285-1787011837.log`, `/tmp/trace-day14-scans-final/`, and the final acceptance log directory reported by the release harness.

### Person B integration notes

- No same-day implementation dependency and no Person B-owned file changed.
- Frontend behavior, shared HTTP contracts, fixtures, and browser routes remain unchanged.
- `docs/frontend-setup.md` already permits a compatible pnpm 10 release; no frontend documentation edit is required for pnpm `10.34.5`.

### Risks

- Live GitHub OAuth, App installation ownership, and provider webhook delivery require real provider credentials and remain an external operational acceptance gate.
- A real Codex response plus provider retention/region/deletion guarantees require operator credentials and policy acceptance; deterministic fake and bounded Codex-provider behavior are repository-tested.
- Production backup restoration, secret injection, networking, persistent report volume permissions, and target-platform Docker/socket policy require the actual deployment environment.
- Password-reset delivery remains intentionally fail-closed until an approved bounded delivery provider is configured.
- Docker socket access remains host-root-equivalent; restrict deployment access or replace that boundary before stronger multi-tenant operation.
- Gitleaks' inherited plan-prose false positive is retained with an explicit line-level disposition rather than a broad allowlist.

### Next-day joint gate

- READY for repository-local Person A definition of done.
- Reason: all core backend lifecycle, authorization, persistence, queue, report, controlled-rendering, real-image, build, audit, scanner, and production-like smoke gates are objectively covered. External-provider and target-production operations are explicitly not represented as repository-local proof.

