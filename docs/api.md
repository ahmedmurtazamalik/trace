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

## Frozen authentication contract for Day 2

Schemas, inferred TypeScript types, and the closed auth error-code enum live in `packages/shared/src/auth.ts`. JSON request/response fixtures live in `packages/shared/test/fixtures/auth/`.

| Method | Path | Success | Request | Success response | Documented errors |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | `201` | `RegisterRequest` | `AuthSessionResponse` | `400 VALIDATION_ERROR`; `409 USERNAME_TAKEN`; `409 EMAIL_TAKEN`; `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/login` | `200` | `LoginRequest` | `AuthSessionResponse` | `400 VALIDATION_ERROR`; `401 INVALID_CREDENTIALS`; `403 ACCOUNT_DISABLED`; `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/logout` | `200` | none | `{ "success": true }` | `401 UNAUTHENTICATED`; `403 CSRF_INVALID` |
| `GET` | `/api/v1/auth/me` | `200` | none | `AuthSessionResponse` | `401 UNAUTHENTICATED` |
| `POST` | `/api/v1/auth/password/forgot` | `202` | `ForgotPasswordRequest` | `ForgotPasswordResponse` | `400 VALIDATION_ERROR`; `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/password/reset` | `200` | `ResetPasswordRequest` | `{ "success": true }` | `400 VALIDATION_ERROR`; `400 INVALID_OR_EXPIRED_RESET_TOKEN`; `429 RATE_LIMITED` |

`AuthSessionResponse` contains public user data plus a CSRF token. It never contains a session token or password material. Registration and login establish the session through a secure HTTP-only cookie in Day 2.

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

Login uses `{ "username": "alice.dev", "password": "correct-horse-battery-staple" }` and returns the same `AuthSessionResponse`. `GET /auth/me` also returns `AuthSessionResponse`. Logout returns `{ "success": true }`.

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

## Provisional later-day contracts

`packages/shared` also contains provisional schemas for GitHub connection status, repositories, activity, pagination, and reports. These preserve current compatibility decisions—generic activity `source`, generic activity `type`, opaque IDs, and valid report statuses—but are not frozen until their scheduled backend day.
