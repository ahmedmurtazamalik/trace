# Trace Frontend Setup

## Scope

This document covers the Person B-owned frontend only. Day 1 uses deterministic illustrative data and does not connect to the Trace API, GitHub, PostgreSQL, Redis, or report services.

## Prerequisites

- Node.js 20 or newer
- pnpm 10 or newer

## Install

From the repository root:

```bash
pnpm install --filter @trace/ui --filter @trace/web --lockfile=false
```

The integration owner manages the root lockfile at the daily merge gate.

## Configure

Copy the frontend-only example file when API work begins:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Day 1 does not call this API origin. Never place backend secrets in a `NEXT_PUBLIC_*` variable.

## Run locally

```bash
pnpm --filter @trace/web dev
```

Open `http://localhost:3000/dashboard`. If port 3000 is occupied, use:

```bash
pnpm --filter @trace/web dev --port 3100
```

## Test and build

```bash
pnpm --filter @trace/ui test
pnpm --filter @trace/ui typecheck
pnpm --filter @trace/web test
pnpm --filter @trace/web lint
pnpm --filter @trace/web typecheck
pnpm --filter @trace/web build
pnpm --filter @trace/web test:e2e
```

Playwright starts an isolated Trace server on port 3100 and verifies desktop and mobile route shells plus keyboard skip navigation.

## Day 1 routes

- `/dashboard`
- `/repositories`
- `/activity`
- `/reports`
- `/github`
- `/settings`
- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`

The authenticated pages are frontend shells, not protected routes yet. Authentication behavior begins on Day 2 after the auth contract is frozen.

## Mock data

Illustrative data comes from `apps/web/src/mocks/fixtures/workspace.ts`. It is visibly disclosed in the interface. MSW handlers are configured in `apps/web/src/mocks/handlers/index.ts`; no real backend is required for Day 1.
