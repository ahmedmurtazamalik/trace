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

The schemas and inferred TypeScript types live in `packages/shared/src/auth.ts`. JSON fixtures live in `packages/shared/test/fixtures/auth/`.

| Method | Path | Request | Success response |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | `RegisterRequest` | `AuthSessionResponse` |
| `POST` | `/api/v1/auth/login` | `LoginRequest` | `AuthSessionResponse` |
| `POST` | `/api/v1/auth/logout` | none | `{ "success": true }` |
| `GET` | `/api/v1/auth/me` | none | `AuthSessionResponse` |
| `POST` | `/api/v1/auth/forgot-password` | `ForgotPasswordRequest` | `{ "accepted": true }` |
| `POST` | `/api/v1/auth/reset-password` | `ResetPasswordRequest` | `{ "success": true }` |

`AuthSessionResponse` contains public user data plus a CSRF token. It does not contain a session token or password material. Registration and login establish the session through a cookie in Day 2.

The forgot-password response is intentionally non-enumerating: known and unknown identifiers receive the same accepted response.

## Provisional later-day contracts

`packages/shared` also contains provisional schemas for GitHub connection status, repositories, activity, pagination, and reports. These preserve current compatibility decisions—generic activity `source`, generic activity `type`, opaque IDs, and valid report statuses—but are not frozen until their scheduled backend day.
