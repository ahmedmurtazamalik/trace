# Trace API contracts

## Conventions

- Product endpoints are versioned under `/api/v1`.
- Trace username/password identity is primary. GitHub is an integration, never the Trace login identity.
- Authenticated browser sessions will use secure HTTP-only cookies; tokens are not returned in response bodies.
- IDs are opaque strings at API boundaries.
- Timestamps are ISO 8601 UTC strings.
- Error responses use a stable envelope:

```json
{
  "code": "NOT_FOUND",
  "message": "Cannot GET /api/v1/example",
  "requestId": "opaque-request-id"
}
```

Validation errors may additionally include `fieldErrors`, keyed by field name. Internal exception details, SQL errors, credentials, and dependency error text are never returned.

## Day 1 operational endpoints

### `GET /health`

Process liveness. This endpoint does not query dependencies.

```json
{
  "status": "ok",
  "service": "trace-api"
}
```

### `GET /ready`

Checks PostgreSQL with `SELECT 1` and Redis with `PING`.

Healthy response:

```json
{
  "status": "ready",
  "dependencies": {
    "postgres": "up",
    "redis": "up"
  }
}
```

If a required dependency is unavailable, the endpoint returns HTTP `503` through the centralized error envelope without exposing the underlying connection error.

## Implemented authentication API

Schemas, inferred TypeScript types, and the closed auth error-code enum live in `packages/shared/src/auth.ts`. JSON request/response fixtures live in `packages/shared/test/fixtures/auth/`.

| Method | Path | Success | Request | Success response | Documented errors |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | `201` | `RegisterRequest` | `AuthSessionResponse` | `400 VALIDATION_ERROR`; `409 USERNAME_TAKEN`; `409 EMAIL_TAKEN`; `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/login` | `200` | `LoginRequest` | `AuthSessionResponse` | `400 VALIDATION_ERROR`; `401 INVALID_CREDENTIALS`; `403 ACCOUNT_DISABLED`; `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/logout` | `200` | header `X-CSRF-Token: <csrfToken>`; no body | `{ "success": true }` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID` |
| `GET` | `/api/v1/auth/me` | `200` | none | `AuthSessionResponse` | `401 UNAUTHENTICATED` |
| `POST` | `/api/v1/auth/password/forgot` | `202` | `ForgotPasswordRequest` | `ForgotPasswordResponse` | `400 VALIDATION_ERROR`; `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/password/reset` | `200` | `ResetPasswordRequest` | `{ "success": true }` | `400 VALIDATION_ERROR`; `400 INVALID_OR_EXPIRED_RESET_TOKEN`; `429 RATE_LIMITED` |

Any authentication endpoint may return `503 SERVICE_UNAVAILABLE` when required security configuration or Redis-backed abuse controls are unavailable; authentication fails closed in that state.

`AuthSessionResponse` contains public user data plus a CSRF token. It never contains a session token or password material. Registration and login establish the session through a secure HTTP-only cookie in Day 2. Clients submit the returned token on every state-changing authenticated request in the `X-CSRF-Token` HTTP header (canonical lowercase contract constant: `csrfHeaderName = "x-csrf-token"`). The token is not sent in a request body or a separate cookie.

### Endpoint examples

Register:

```json
{
  "request": {
    "username": "alice.dev",
    "displayName": "Alice Developer",
    "email": "alice@example.com",
    "password": "correct-horse-battery-staple"
  },
  "response": {
    "user": {
      "id": "usr_01HXYZ",
      "username": "alice.dev",
      "displayName": "Alice Developer",
      "email": "alice@example.com",
      "createdAt": "2026-08-11T12:00:00.000Z"
    },
    "csrfToken": "csrf_opaque_value"
  }
}
```

Login uses `{ "username": "alice.dev", "password": "correct-horse-battery-staple" }` and returns the same `AuthSessionResponse`. `GET /auth/me` also returns `AuthSessionResponse`. Logout sends `X-CSRF-Token: csrf_opaque_value` with no body and returns `{ "success": true }`.

Password forgot is intentionally non-enumerating. Known and unknown identifiers receive the same `202` response:

```json
{
  "request": { "identifier": "alice@example.com" },
  "response": {
    "message": "If the account exists, password reset instructions have been sent."
  }
}
```

Password reset:

```json
{
  "request": {
    "token": "opaque-reset-token",
    "password": "correct-horse-battery-staple"
  },
  "response": { "success": true }
}
```

All failures use the common envelope. Example:

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "The supplied credentials are invalid.",
  "requestId": "request-123"
}
```

Request and success-response fixtures for all six auth endpoints are validated by `packages/shared/test/auth.spec.ts`.

### Session and reset semantics

- Registration and login set `trace_session` as an opaque HTTP-only cookie with `SameSite=Lax`, path `/api/v1`, a seven-day maximum age, and `Secure` in production.
- Only keyed session-token hashes and CSRF-token hashes are persisted. `GET /auth/me` deterministically reissues the CSRF token from the HTTP-only session credential.
- Disabled, revoked, and expired sessions are rejected. Password reset revokes every active session and consumes all outstanding reset tokens.
- Trace usernames and optional emails are owned case-insensitively, enforced by PostgreSQL functional unique indexes as well as API checks.
- Registration, login, forgot-password, and reset-password are protected by Redis-backed direct-address and normalized-principal rate limits. The API does not trust `X-Forwarded-For` unless deployment architecture is changed and reviewed later.
- Reset tokens are opaque, single-use, expire after 30 minutes, and are stored only as SHA-256 hashes. Forgot-password uses a bounded public response window while eligible-account issuance continues asynchronously behind a renewable per-user Redis lock. Each issuer snapshots prior token IDs under a PostgreSQL user-row lock and can retire only that snapshot, so an older issuer cannot invalidate a newer delivery even across Redis lease loss. A failed replacement preserves the prior token; only successful delivery consumes older tokens. The endpoint calls an injectable delivery boundary. Because choosing an outbound provider is outside Day 2, non-test deployments return `503 SERVICE_UNAVAILABLE` for all forgot-password identifiers until a bounded provider is bound; they never silently persist a replacement through a no-op adapter.

## Implemented GitHub connection contract

Day 3 implements the browser/backend GitHub connection handoff. Schemas and types live in `packages/shared/src/github.ts`; frozen fixtures live under `packages/shared/test/fixtures/github/`.

| Method | Path | Success | Request | Success behavior | Documented errors |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/github/connect` | `200` | authenticated session; no body | `GithubConnectResponse` containing a backend-generated HTTPS `github.com` authorization URL; the same operation is used when reconnecting | `401 UNAUTHENTICATED`; `429 RATE_LIMITED` |
| `GET` | `/api/v1/github/callback?code=...&state=...` or `?error=access_denied&state=...` | `302` | success or provider-denial `GithubCallbackQuery`; browser session cookie | Redirect to the configured frontend GitHub settings route with a closed `GithubCallbackResult` query result | `GITHUB_STATE_INVALID`; `GITHUB_CALLBACK_FAILED` are converted to safe closed callback results, never raw provider text |
| `GET` | `/api/v1/github/installation` | `200` | authenticated connected session; no body | `GithubInstallationStartResponse` containing a state-bound `github.com/apps/.../installations/new` URL | `401 UNAUTHENTICATED`; `409 GITHUB_RECONNECT_REQUIRED`; `429 RATE_LIMITED` |
| `GET` | `/api/v1/github/installation/callback?installation_id=...&setup_action=...&state=...` | `302` | validated App setup callback; initiating browser session cookie | verifies the installation exists for the App, stores its ID only in a new exact-session state, and redirects through GitHub OAuth for user-scoped ownership verification | state/session/provider failures become closed callback results |
| `GET` | `/api/v1/github/status` | `200` | authenticated session | `GithubConnectionStatus` | `401 UNAUTHENTICATED` |
| `DELETE` | `/api/v1/github/connection` | `200` | authenticated session + `X-CSRF-Token`; no body | `GithubDisconnectResponse` with `historyRetained: true` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID`; `409 GITHUB_NOT_CONNECTED` |

`GithubConnectionStatus` deliberately separates:

1. **Trace account connection:** `DISCONNECTED`, `CONNECTED`, or `RECONNECT_REQUIRED`, with the linked GitHub user when known.
2. **GitHub App installation authorization:** `NOT_INSTALLED`, `ACTIVE`, or `SUSPENDED`, with the personal/organization installation owner when known.

Disconnect never deletes historical activity. The frontend may show local `connecting`/`redirecting` progress, but must render callback and provider failures only through the closed result/reason enums. Installation tokens, OAuth tokens, state values, and raw provider errors never appear in these DTOs.

The contract fixtures cover connected, disconnected, reconnect-required plus suspended installation, callback success/provider-denial query variants, safe callback results, connect URL/state consistency, and disconnect history retention.

OAuth, installation setup, and installation ownership verification use separate random states stored only as SHA-256 digests. Each state is bound to the exact initiating live Trace session, expires after 10 minutes, has a fixed purpose, and is consumed once before provider work. A setup callback's browser-controlled numeric installation ID is never sufficient for persistence: a fresh ephemeral user OAuth grant must show that the already-linked GitHub user can access that exact installation through GitHub's user-scoped installation endpoint. Account and installation persistence runs atomically under the Trace user row lock. A GitHub account or installation already linked to another Trace account is not reassigned. Connect/install starts are Redis-rate-limited by direct socket address first and user second and fail closed if Redis is unavailable.

`GITHUB_CALLBACK_URL` is the public callback URL registered with GitHub. Missing provider credentials leave liveness and unrelated APIs available; GitHub connect fails closed with `503 SERVICE_UNAVAILABLE`. Day 3 stores no OAuth or installation token and returns no provider credential, app private key, webhook secret, or raw provider error.

## Implemented Day 4 repository API

Repository contracts live in `packages/shared/src/repositories.ts`; fixtures live under `packages/shared/test/fixtures/repositories/`.

| Method | Path | Success | Request | Success response | Documented errors |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/repositories/sync` | `200` | authenticated session + `X-CSRF-Token`; no body | `{ "accessibleRepositoryCount": number }` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID`; `409 GITHUB_INSTALLATION_REQUIRED`; `409 GITHUB_INSTALLATION_SUSPENDED`; `503 SERVICE_UNAVAILABLE` |
| `GET` | `/api/v1/repositories` | `200` | authenticated session; `RepositoryListQuery` | `RepositoryListResponse` | `400 VALIDATION_ERROR`; `401 UNAUTHENTICATED` |
| `GET` | `/api/v1/repositories/:id` | `200` | authenticated session | `RepositoryDetailResponse` | `401 UNAUTHENTICATED`; `404 REPOSITORY_NOT_FOUND` |
| `POST` | `/api/v1/repositories/:id/tracking` | `200` | authenticated session + `X-CSRF-Token`; no body | `RepositoryTrackingResponse` with `trackingEnabled: true` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID`; `404 REPOSITORY_NOT_FOUND`; `409 REPOSITORY_ACCESS_REMOVED` |
| `DELETE` | `/api/v1/repositories/:id/tracking` | `200` | authenticated session + `X-CSRF-Token`; no body | `RepositoryTrackingResponse` with `trackingEnabled: false` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID`; `404 REPOSITORY_NOT_FOUND` |

Repository synchronization uses an ephemeral installation token entirely inside `@trace/github`; provider credentials and tokens never enter DTOs, logs, or persistence. All GitHub pages are fetched before one database reconciliation. Each synchronization reserves an installation-local generation and a database-global claim sequence before provider I/O. Publication requires the generation to remain current, locks affected stable repository IDs in deterministic order, and accepts only claims newer than each repository's last published sequence. This prevents both slower same-installation snapshots and older cross-installation snapshots from overwriting a newer transfer or access-removal decision. Repositories are upserted by stable GitHub repository ID, metadata and installation ownership are refreshed, and each authorized repository receives an idempotent per-user `UserRepository` association defaulting to tracking off. The synchronization response count reflects only repository claims accepted by the authoritative reconciliation; stale fenced claims are not reported as accessible. Existing per-user tracking state is never reset by synchronization.

Repositories omitted from a successful current synchronization are retained for historical activity and marked with global and per-user `accessRemovedAt` cutoffs. They remain visible to their owning Trace user with `accessible: false`; summaries include only activity at or before that user's cutoff, preventing later transferred-repository activity from leaking to a former owner. Enabling tracking fails closed, while disabling remains available. A disconnected account or suspended installation is also inaccessible. Tracking state always belongs to `UserRepository`, never the global repository row.

List results are ordered by `fullName` then opaque repository ID. Cursors are opaque server values bound to that ordering and the active search filter. Search is trimmed and case-insensitive across owner, name, and full name. `lastActivityAt` is the newest stored activity timestamp; `contributorCount` is the distinct count of non-null stored contributors. Reads and mutations require an existing user/repository association and do not expose another user's repository membership.

## Day 7 Activity API and frozen dashboard contract

The frontend-consumable activity and dashboard boundary is frozen in `packages/shared/src/activity.ts` and `packages/shared/src/dashboard.ts`; validated fixtures live under `packages/shared/test/fixtures/activity/` and `packages/shared/test/fixtures/dashboard/`. Day 7 implements the two activity routes against canonical PostgreSQL events. Dashboard implementation remains outside Person A's reviewed Day 7 task and is not claimed here.

Activity routes are:

- `GET /api/v1/activity` using `ActivityListQuery` and `ActivityListResponse`.
- `GET /api/v1/repositories/:id/activity` using the same filter and response schemas, with repository ownership enforced by the server.
- `GET /api/v1/dashboard` remains a frozen future boundary using `DashboardQuery` and `DashboardResponse`.

Activity filters include optional ISO date, IANA timezone (default `UTC`), repository, contributor, source, type, cursor, and bounded limit. A supplied date denotes the half-open calendar interval `[00:00, next 00:00)` in the supplied IANA timezone; the API converts that interval to UTC before querying. Invalid dates, timezones, filters, limits, and cursors fail with `400 VALIDATION_ERROR`. Results use a stable opaque cursor ordered by `occurredAt` descending then opaque activity ID descending.

Both activity routes require an authenticated Trace session. Authorization is derived only from the caller's `UserRepository` rows. The global route returns events from associated repositories; the repository route returns `404 REPOSITORY_NOT_FOUND` without disclosing whether an unassociated repository exists. Tracking disablement, GitHub disconnection, installation suspension, or provider access removal does not erase historical activity. When the caller's repository access has ended, only events with `occurredAt <= accessRemovedAt` remain visible; later transferred-repository activity is excluded.

The opaque versioned cursor contains the final `(occurredAt, id)` position, is HMAC-signed with a domain-separated server secret, and is bound to the authenticated user plus the complete normalized filter set, including route repository, date, timezone, source, type, contributor, and limit. Modified, non-canonical, cross-user, or cross-query cursors fail validation. Day boundaries are calendar-correct across 23-hour and 25-hour daylight-saving transitions rather than fixed 24-hour windows; civil dates skipped by timezone transitions fail validation instead of silently returning an empty interval. Nullable event metadata is independently bounded and validated before projection; malformed optional facts become `null`, unsafe/non-HTTPS links are excluded, invalid source/type rows fail closed, and arbitrary stored metadata is never returned.

The closed sources are `github | cli`; the closed activity types are `commit | push | pull_request | working_tree_snapshot | staged_change | untracked_file | local_commit`. Each item contains repository context, an optional contributor who need not have a Trace account, generic source/type, timestamp, and strict nullable factual display fields (`sha`, message, branch, files changed, additions, deletions, and optional evidence URL). Provider credentials, webhook internals, raw patches, and arbitrary metadata are excluded.

Dashboard responses contain the requested date/timezone, a truthful state (`READY`, `GITHUB_NOT_CONNECTED`, `NO_TRACKED_REPOSITORIES`, `NO_ACTIVITY`, or `PARTIAL`), deterministic non-negative metrics, and at most 20 canonical recent activity items. No productivity score, inferred effort, ranking, or model-generated metric is part of the contract.

## Day 5 GitHub webhook acceptance

`POST /api/v1/webhooks/github` is the server-to-server GitHub App webhook endpoint. It accepts only `application/json` push deliveries with these required headers:

- `X-GitHub-Event: push`
- `X-GitHub-Delivery: <canonical lowercase UUID>`
- `X-Hub-Signature-256: sha256=<64 lowercase hex characters>`

The endpoint establishes a bounded request correlation ID before body parsing, then reads at most 256 KiB into a raw buffer. It verifies the HMAC-SHA256 signature over those exact bytes with a timing-safe comparison before decoding JSON. The signed push envelope then validates bounded ref, SHA, installation, stable repository ID, repository full name, sender, and every nested commit field (IDs, messages, timestamps, URLs, authors, and added/removed/modified path arrays). Missing/malformed headers or schema return `400`; invalid signatures return `401`; oversized bodies return `413 WEBHOOK_PAYLOAD_TOO_LARGE` with the same request ID. General API JSON remains limited to 1 MiB and URL-encoded bodies to 64 KiB.

A valid push is authorized from current server state using the stable GitHub installation and repository IDs. The installation must be active, its account linked, the repository currently assigned to it with provider access intact, and at least one enabled Trace user membership must have current access and tracking enabled. Valid but wholly untracked, suspended, disconnected, removed-access, or disabled-user deliveries return `202 { "accepted": false, "reason": "untracked" }` without persistence or queueing so GitHub does not retry irrelevant deliveries.

Accepted pushes return `202 { "accepted": true }`. A PostgreSQL advisory transaction lock serializes the canonical delivery UUID. The unique delivery row stores the bounded validated JSON payload and its SHA-256 digest; duplicate IDs are accepted only when event, digest, installation ID, and repository ID match exactly. Current authorization is revalidated even for retries. Conflicting reuse returns `409 WEBHOOK_DELIVERY_CONFLICT`.

The API publishes one BullMQ job named `process-github-webhook`, using deterministic ID `github-webhook-<delivery-row-id>`, five bounded exponential-backoff attempts, and `{ "deliveryId": "<delivery-row-id>" }` as its entire Redis payload. PostgreSQL is the durable source of both the validated payload and the queue-publication obligation: `publishedAt = null` marks an accepted pending delivery still owed to Redis. The request performs a bounded best-effort publish, while an independent startup/periodic reconciler publishes owed rows and marks them only after deterministic `queue.add` succeeds. This closes the PostgreSQL-to-Redis gap even if GitHub never retries or authority is later revoked. A crash after Redis succeeds but before the marker update is safe because the next pass uses the same deterministic job ID. Rows already in `processing`, `completed`, or `failed` are never selected for publication.

`apps/worker/src/queues/github/github-webhook.worker.ts` and `apps/worker/src/runtime.ts` provide the Day 5 worker lifecycle boundary with Redis readiness, concurrency restricted to 1–32, bounded durable-reference validation, monitored fatal run-loop completion, SIGINT/SIGTERM handling, and graceful-then-forced deadline-bounded close. Terminal-failure recording is attempted once and recorder failures are contained; BullMQ stores only the stable `WEBHOOK_PROCESSING_FAILED` reason and never retains raw processor or observability exception text. A fatal run loop marks the process failed and initiates the same idempotent stop path. The executable fails closed until Day 6 supplies a real processor, so it cannot acknowledge jobs through a placeholder consumer.

## Frozen Day 8–10 report contract

The report protocol is frozen in `packages/shared/src/reports.ts`; validated list/detail fixtures live under `packages/shared/test/fixtures/reports/`. Day 7 freezes DTOs and lifecycle semantics only. Report API handlers, aggregation, queueing, AI, revision persistence, LaTeX, artifact storage, and download streaming remain Days 8–10.

Canonical routes for those days are:

- `POST /api/v1/reports` with `ReportCreateRequest`, returning `ReportCreateResponse`.
- `GET /api/v1/reports` with `ReportListQuery`, returning `ReportListResponse`.
- `GET /api/v1/reports/:id`, returning `ReportDetailResponse`.
- `PUT /api/v1/reports/:id/revision` with `ReportRevisionUpdateRequest`, returning `ReportRevisionUpdateResponse`.
- `POST /api/v1/reports/:id/regenerate` with `ReportRegenerationRequest`, returning `ReportRegenerationResponse`.
- `GET /api/v1/reports/:id/download?artifactId=...` with `ReportDownloadQuery`; the successful response is the authorized artifact byte stream, not JSON.

Create accepts one ISO report date and an IANA timezone. List pagination is bounded and may filter by the closed lifecycle statuses `pending | processing | completed | failed`. `pending` and `processing` reports have no completion timestamp or downloadable PDF. `failed` reports expose only a bounded safe error message. `completed` reports require a completion timestamp, revisioned structured content, and a current PDF artifact stored successfully.

Report facts are server-owned non-negative counts and cannot be submitted through edit requests. Editable content is a strict bounded sparse `prosePatch` only: executive summary, repository summaries, contributor summaries, and accomplishment strings keyed by opaque repository/contributor IDs. Omitted sections remain unchanged; explicit empty repository/contributor patch arrays, duplicate IDs, and nested ID-only patches that change no prose are rejected. The server must verify every submitted repository and contributor ID against the current revision and reject unknown IDs or reassignment; only prose values may change. Arbitrary LaTeX, HTML extensions, model-controlled metrics, storage paths, repository names as authority, and unknown fields are rejected. Update and regeneration requests carry `expectedRevision`; stale writes must return `REPORT_REVISION_CONFLICT` and cannot silently overwrite newer or manual content. The closed report error vocabulary also covers not found, duplicate date, non-editable state, missing artifact, and generation unavailability.

Artifact DTOs expose only bounded safe display/download metadata: a report-unique opaque ID, report revision, closed kind, basename, closed content type, bounded size, and SHA-256 checksum. Duplicate artifact IDs within one report are invalid. Clients select an artifact by its ID on the enclosing report's authorized download route; redundant client-provided storage URLs, storage keys, and filesystem paths are never part of the contract. The frozen contract includes PDF and optional `.tex` artifact kinds; `.tex` may only be downloaded if safely produced and is never an arbitrary browser/server editor input.
