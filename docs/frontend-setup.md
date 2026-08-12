# Trace Frontend Setup

## Scope

This document covers the Person B-owned Next.js frontend in `apps/web` and shared visual primitives in `packages/ui`.

Day 2 implements authentication UI against the frozen schemas and fixtures in `packages/shared/src/auth.ts` and `packages/shared/test/fixtures/auth/`. Person B does not edit those contracts.

## Prerequisites

- Node.js 20 or newer
- pnpm 10 or newer
- For live API testing: Person A's API, PostgreSQL, and Redis services

## Install

From the repository root:

```bash
pnpm install --filter @trace/ui --filter @trace/shared --filter @trace/web --lockfile=false
```

The integration owner manages the root lockfile at the daily merge gate.

## Configure

```bash
cp apps/web/.env.example apps/web/.env.local
```

`NEXT_PUBLIC_API_ORIGIN` is the browser-visible API origin. The default example is:

```dotenv
NEXT_PUBLIC_API_ORIGIN=http://localhost:3001
```

Never place backend secrets, session credentials, CSRF secrets, database URLs, or provider tokens in a `NEXT_PUBLIC_*` variable.

## Run locally

```bash
pnpm --filter @trace/web dev
```

Open `http://localhost:3000/login`. If port 3000 is occupied:

```bash
pnpm --filter @trace/web dev --hostname 0.0.0.0 --port 3100
```

Then open `http://localhost:3100/login` on the host computer.

## Day 2 authentication model

- Registration/login establish an opaque session in the API's HTTP-only `trace_session` cookie.
- Every auth request uses `credentials: "include"`.
- Browser code never reads or stores the session token.
- Public user data and the current CSRF token are held only in React memory.
- `GET /api/v1/auth/me` bootstraps session state after a reload.
- Logout sends CSRF only through the canonical `x-csrf-token` header and sends no body.
- Protected pages do not render until session bootstrap succeeds.
- Anonymous users return only to validated local paths after login; external/open-redirect values are rejected.
- Forgot-password always displays the same non-enumerating success message.

## Routes

Public authentication routes:

- `/login`
- `/register`
- `/forgot-password`
- `/reset-password?token=<opaque-token>`

Protected workspace routes:

- `/dashboard`
- `/repositories`
- `/activity`
- `/reports`
- `/github`
- `/settings`

## Test strategy

Unit/component tests use injected deterministic adapters or mocked `fetch`. Browser tests intercept the frozen HTTP endpoints with Playwright route handlers. They do not require live PostgreSQL, Redis, email delivery, or a real user account.

```bash
pnpm --filter @trace/ui test
pnpm --filter @trace/ui typecheck
pnpm --filter @trace/web test
pnpm --filter @trace/web lint
pnpm --filter @trace/web typecheck
pnpm --filter @trace/web build
pnpm --filter @trace/web test:e2e
```

Playwright starts a fresh non-reused Trace server on port 3100 and verifies desktop Chrome and Pixel 5 behavior, including authentication success/error paths, recovery privacy, protected return paths, CSRF logout, responsive route shells, and keyboard skip navigation.

## Live-backend limitations

- The frontend client is wired to the real Day 2 endpoints, but deterministic browser tests use HTTP interception.
- Live registration/login require the backend's PostgreSQL, Redis, and security configuration.
- Person A's API documentation states that non-test forgot-password requests return `503 SERVICE_UNAVAILABLE` until a bounded outbound delivery provider is configured. The UI renders that as a safe temporary-unavailability message.
- A joint live smoke test should be repeated after the integration environment is running.
