# Backend security review

This document records the Day 11 backend security boundary. Server-side identity, ownership, and lifecycle predicates are authoritative; frontend route visibility is never authorization.

## Endpoint authorization matrix

| Method and path | Authentication | CSRF / authenticity | Server-side authority and bounds |
|---|---|---|---|
| `GET /health` | Public | Read-only | Fixed liveness response; no dependency or secret details. |
| `GET /ready` | Public | Read-only | Bounded PostgreSQL/Redis readiness; fixed safe failure response. |
| `POST /api/v1/auth/register` | Public | JSON-only request and direct-address rate limit | Strict identity/password schema; case-insensitive database uniqueness; Argon2id; session cookie only. |
| `POST /api/v1/auth/login` | Public | JSON-only request; direct-address and normalized-account rate limits | Generic credential failure; disabled users rejected; session issuance serialized with password changes. |
| `GET /api/v1/auth/me` | Session | Read-only | Live, unrevoked, unexpired session and enabled user required. |
| `POST /api/v1/auth/logout` | Session | `X-CSRF-Token` | Revokes only the current session and expires the cookie. |
| `POST /api/v1/auth/password/forgot` | Public | JSON-only request; address and normalized-identifier limits | Non-enumerating bounded response; renewable per-user issuance lock; no raw token persistence. |
| `POST /api/v1/auth/password/reset` | Public capability | JSON-only request; address and token-digest limits | Atomic single-use token consume, password rotation, and session revocation. |
| `POST /api/v1/github/connect` | Session | `X-CSRF-Token`; exact-session single-use OAuth state; user/address limits | Returns a backend-generated provider URL; persists no provider token. |
| `GET /api/v1/github/callback` | State-bound session | Exact purpose/session state consumed once before provider work | Provider identity is linked only after validated callback and user-scoped provider response. |
| `POST /api/v1/github/installation` | Session | `X-CSRF-Token`; exact-session installation state; user/address limits | Starts installation setup without treating a browser installation ID as ownership. |
| `GET /api/v1/github/installation/callback` | State-bound session | Exact purpose/session state consumed once | Fresh user-scoped provider grant must authorize the exact installation before persistence. |
| `GET /api/v1/github/status` | Session | Read-only | Resolves only the caller's account and installation state. |
| `DELETE /api/v1/github/connection` | Session | `X-CSRF-Token` | Disconnects only the caller; retained history does not remain current provider authority. |
| `GET /api/v1/repositories` | Session | Read-only | Caller `UserRepository` membership; strict search and cursor pagination bounds. |
| `GET /api/v1/repositories/:id` | Session | Read-only | Foreign/inaccessible identifiers return indistinguishable not-found responses. |
| `POST /api/v1/repositories/:id/tracking` | Session | `X-CSRF-Token` | Idempotent caller-membership update; current access required. |
| `DELETE /api/v1/repositories/:id/tracking` | Session | `X-CSRF-Token` | Idempotent caller-membership update; no global repository mutation. |
| `POST /api/v1/repositories/sync` | Session | `X-CSRF-Token`; 30/hour/user, 150/hour/address, 1,500/hour/deployment | Current linked installation required; stable provider IDs and generation/global-claim fences prevent stale ownership transfer. |
| `POST /api/v1/webhooks/github` | Public provider boundary | HMAC-SHA256 over exact raw bytes | `push` only; canonical delivery UUID; 256 KiB raw-body bound; current installation/repository authority resolved server-side. |
| `GET /api/v1/activity` | Session | Read-only | Caller membership and visibility window; filter-bound signed cursor; bounded filters/page size. |
| `GET /api/v1/dashboard` | Session | Read-only | Caller memberships only; date/timezone/repository bounds; no foreign pending-work disclosure. |
| `GET /api/v1/repositories/:id/activity` | Session | Read-only | Foreign repositories return indistinguishable not-found responses; signed bounded pagination. |
| `POST /api/v1/reports` | Session | `X-CSRF-Token`; 20/hour/user, 100/hour/address, 1,000/hour/deployment | Caller-owned immutable fact snapshot; strict date/timezone schema; one report per caller/date. |
| `GET /api/v1/reports` | Session | Read-only | Caller-owned rows only; status and signed cursor bounds. |
| `GET /api/v1/reports/:id` | Session | Read-only | Caller ownership in the query; foreign report is indistinguishable not-found. |
| `PUT /api/v1/reports/:id/revision` | Session | `X-CSRF-Token`; 60/hour/user, 300/hour/address, 3,000/hour/deployment | Caller ownership, expected revision, editable lifecycle, bounded prose, and immutable revision history. |
| `POST /api/v1/reports/:id/regenerate` | Session | `X-CSRF-Token`; 20/hour/user, 100/hour/address, 1,000/hour/deployment | Caller ownership and expected revision; explicit generation increment; frozen same-revision LaTeX source. |
| `GET /api/v1/reports/:id/download` | Session | Read-only | Opaque artifact ID beneath caller-owned report/revision; stored size and checksum verified before streaming. |

## Cross-cutting enforcement

- **Transport:** Helmet security headers apply to public, error, and authenticated responses. Credentialed CORS names one configured frontend origin; no wildcard origin is used.
- **Request parsing:** API mutations accept JSON, while the GitHub webhook alone receives bounded raw `application/json` bytes. URL-encoded form parsing is deliberately disabled to prevent simple cross-site credential mutations from bypassing CORS preflight.
- **Sessions and CSRF:** Opaque session credentials are HTTP-only cookie values and keyed hashes at rest. Authenticated mutations require the separately returned CSRF token. Cookies are `SameSite=Lax`, API-path scoped, and `Secure` in production.
- **Ownership:** Actor IDs come only from live sessions. Repository, activity, report, revision, and artifact queries include caller ownership; foreign resources use the same not-found behavior as absent resources.
- **State and concurrency:** OAuth/install states are random, purpose-specific, exact-session-bound, expiring, and single-use. Repository synchronization, webhook delivery, queue publication, report generation, revision, and artifact completion use database-backed idempotency or generation/lease fences. Every pending PostgreSQL webhook row remains an owed deterministic publication so Redis job loss is repaired. Reconciliation commits fenced attempt clocks for the selected cohort before queue I/O so poison rows rotate behind later obligations; publication locks and revalidates the exact delivery and authority rows again around a one-second queue wait inside an expiring transaction, serializing publication with revocation without allowing one hung enqueue to retain locks or stall future intervals. The worker revalidates authority again, and revoked work becomes terminal without canonical activity writes. Report artifact publication renews exact ownership before storage and requires the renewed lease to remain live at final activation.
- **Input and query bounds:** Global JSON/raw payload limits, strict schemas, bounded identifiers, 2,048-character opaque cursors, page-size maxima, timezone validation, and bounded webhook fields constrain allocation and query work.
- **LLM privacy:** The configured provider is an explicit deployment opt-in. It receives bounded aggregate facts, private repository names, contributor display identities, timestamps, activity types, and exact commit messages needed for report prose. Stable database IDs, activity IDs, and commit SHAs are replaced with request-local aliases before transmission; repository/contributor aliases are restored only after parsing. Provider configuration fails closed; raw credentials and provider responses are not persisted or returned.
- **LaTeX and artifacts:** Untrusted text is escaped and bounded. Compilation uses immutable production images, fixed UID/GID `65532:65532`, no network, no shell escape, resource/time bounds, structural PDF validation, and deterministic normalization. Artifact keys are owner/report/revision/generation/attempt scoped. Immutable writes run outside database transactions in killable child-process boundaries; a fast failure aborts sibling work and every write settles before lease ownership is released. Only a still-current fenced generation is activated. Storage reads are bounded, no-follow, nonblocking, and checksum-verified.
- **Logging, audit, and secrets:** Client 5xx responses are generic. Unhandled and queue-publication logs record request/operation correlation and error type, never arbitrary exception messages or stacks. GitHub link/install/disconnect, repository synchronization/tracking, and report create/revision/regeneration mutations write durable audit rows in the authoritative transaction. Runtime secrets come from validated environment configuration and are never committed or returned.
- **Dependencies:** Both full-lockfile and production dependency audits are required at the Day 11 gate. The test toolchain is pinned to patched Vitest/Vite versions. Missing optional providers fail closed at their feature boundary without disabling liveness.

## Day 11 verification evidence

- All workspace package tests passed; worker reported 83 passed and two intentional Docker-only skips.
- `pnpm --filter @trace/database test:integration`: 10/10 PostgreSQL migration, constraint, and seed tests passed.
- `pnpm --filter @trace/api test:integration` against isolated Redis DB 13: 10 suites and 77/77 tests passed.
- Focused authority/artifact worker integration: 24/24 tests passed.
- `pnpm lint`, `pnpm typecheck`, and `NODE_ENV=production pnpm build`: passed for every workspace package and the optimized Next.js build.
- `pnpm audit --audit-level=low` and `pnpm audit --prod --audit-level=low`: no known vulnerabilities.
- `pnpm test:latex:docker`: 2/2 real sandboxed XeLaTeX acceptance tests passed, including forced-timeout cleanup.
- `pnpm --filter @trace/web test:e2e`: 62/62 desktop/mobile Playwright tests passed on the integrated Day 10/11 tree.

## Residual risks and explicit non-claims

- Live GitHub and configured LLM calls are not required for this security review and no production credentials are used. Provider adapters and fail-closed configuration are covered with controlled test doubles; a live-provider smoke test remains an operations task.
- Configured LLM report generation intentionally discloses the prose inputs named above to the selected provider. Operators remain responsible for provider contracts, geographic processing, retention, and deletion policy; request-local aliases reduce unnecessary identifiers but do not anonymize repository names, contributor names, or commit messages.
- Password-reset token generation and consumption are implemented, but user-facing delivery remains unavailable until an approved bounded delivery provider is configured. The endpoint fails closed rather than claiming delivery.
- Filesystem artifact storage requires a persistent shared production volume. Multi-host object storage is not claimed.
- Composed user/address/deployment operation budgets bound hourly paid work but are not lifetime storage quotas. Report/revision/artifact retention, account-wide quotas, audit-log retention, and operational alerting remain production policy work; current database and storage growth must be monitored.
- Opt-in local CLI ingestion is deferred and no repository membership is treated as authority for future local activity.
- Dependency audit, staged Gitleaks, materialized-tree Semgrep, and Trivy vulnerability/secret/misconfiguration scans are run against the release snapshot. Additional scanners remain defense-in-depth and are not substituted for adversarial integration tests or source review.
