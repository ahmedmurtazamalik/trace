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

## Frozen GitHub connection contract for Day 3

Day 2 freezes the browser/backend handoff only. No GitHub controller, OAuth exchange, GitHub App installation behavior, or repository synchronization is implemented on this branch.

Schemas and types live in `packages/shared/src/github.ts`; frozen fixtures live under `packages/shared/test/fixtures/github/`.

| Method | Path | Success | Request | Success behavior | Documented errors |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/github/connect` | `200` | authenticated session; no body | `GithubConnectResponse` containing a backend-generated HTTPS `github.com` authorization URL; the same operation is used when reconnecting | `401 UNAUTHENTICATED`; `429 RATE_LIMITED` |
| `GET` | `/api/v1/github/callback?code=...&state=...` or `?error=access_denied&state=...` | `302` | success or provider-denial `GithubCallbackQuery`; browser session cookie | Redirect to the configured frontend GitHub settings route with a closed `GithubCallbackResult` query result | `GITHUB_STATE_INVALID`; `GITHUB_CALLBACK_FAILED` are converted to safe closed callback results, never raw provider text |
| `GET` | `/api/v1/github/status` | `200` | authenticated session | `GithubConnectionStatus` | `401 UNAUTHENTICATED` |
| `DELETE` | `/api/v1/github/connection` | `200` | authenticated session + `X-CSRF-Token`; no body | `GithubDisconnectResponse` with `historyRetained: true` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID`; `409 GITHUB_NOT_CONNECTED` |

`GithubConnectionStatus` deliberately separates:

1. **Trace account connection:** `DISCONNECTED`, `CONNECTED`, or `RECONNECT_REQUIRED`, with the linked GitHub user when known.
2. **GitHub App installation authorization:** `NOT_INSTALLED`, `ACTIVE`, or `SUSPENDED`, with the personal/organization installation owner when known.

Disconnect never deletes historical activity. The frontend may show local `connecting`/`redirecting` progress, but must render callback and provider failures only through the closed result/reason enums. Installation tokens, OAuth tokens, state values, and raw provider errors never appear in these DTOs.

The frozen contract fixtures cover connected, disconnected, reconnect-required plus suspended installation, callback success/provider-denial query variants, safe callback results, connect URL/state consistency, and disconnect history retention.

## Provisional later-day contracts

Repository, activity, pagination, and report schemas remain provisional. They preserve current compatibility decisions—generic activity `source`, generic activity `type`, opaque IDs, and valid report statuses—but are not frozen until their scheduled backend day.
