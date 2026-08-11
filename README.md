# Trace Planning Package

Trace is an on-demand engineering activity and reporting system that combines authorized GitHub activity, opt-in local Git observations, repository context, and editable LaTeX/PDF reports.

The repository now has its Phase 0 pnpm/TypeScript/Vitest baseline. Application features are developed on short-lived branches and shared contracts remain drafts until both developers approve them.

## Read in this order

1. [`TRACE_MASTER_PLAN.md`](./TRACE_MASTER_PLAN.md) — authoritative scope, architecture, shared contracts, phases, testing, risks, and definition of done.
2. [`MURTAZA_PLAN.md`](./MURTAZA_PLAN.md) — Murtaza's web platform, database, GitHub App, ingestion, and integration responsibilities.
3. [`ALI_PLAN.md`](./ALI_PLAN.md) — Ali's CLI, report experience, AI synthesis, LaTeX, and frontend responsibilities.

If an individual plan conflicts with the master plan, the master plan wins until both developers explicitly update the decision together.

## Planning assumptions

- Team: Murtaza and Ali, both fresh graduates/new hires.
- Baseline duration: 15 working days, including integration and demo preparation.
- Tools and services must be free or open source for the MVP.
- GitHub personal accounts and GitHub organizations are both supported.
- A shared company GitHub account is treated as one opaque, reportable GitHub identity.
- GitHub App installations provide remote repository access.
- The opt-in Trace CLI observes staged changes and local commits while its explicit `trace start` watcher is active.
- Reports are generated only when requested.
- The final report is editable LaTeX with `.tex` and PDF downloads.
- The report theme will be implemented after the provided LaTeX baseline is received.

## First team meeting

Before writing code, spend 60–90 minutes together and complete these actions:

1. Read the master plan aloud and resolve unclear terms.
2. Confirm the presentation date and adjust the schedule without silently adding scope.
3. Decide who acts as repository maintainer; default: Murtaza.
4. Create the GitHub repository and protect `main`.
5. Add both collaborators and confirm each can create branches and pull requests.
6. Create the free Supabase project and development GitHub App together.
7. Record environment-variable names only; never commit values.
8. Agree that shared contracts and fixtures require both developers' review.

## Daily rhythm

- **Start of day — 10 minutes:** state yesterday's result, today's goal, and blocker.
- **Midday integration — 15 minutes:** pull `main`, run checks, resolve contract drift.
- **End of day — 20 minutes:** demo working behavior to each other and merge only green pull requests.

Use short-lived branches and small commits. Do not keep separate long-running “Murtaza” and “Ali” branches.

## Scope-change rule

A new feature may enter the MVP only by removing work of equal or greater effort. Record the exchange in the master plan before implementation.

## Implementation task log

This section is append-only. Every completed task or block records its plan reference, outcome, problems, verification, files, and next dependency.

### Day 1 — Block 1: Baseline tooling

**Status:** Implemented on `feat/cli-foundation`.

**Done**

- Configured pnpm workspaces, TypeScript project references, Prettier, ESLint, Vitest, and GitHub Actions CI.
- Added environment-variable names without values.
- Added the contracts package shell.

**Problems and resolutions**

- ESLint initially had no TypeScript target and reported that every file was ignored. The first contract test supplied a real target; all gates now pass.
- pnpm existed only in the Hermes tool path. A Corepack shim was exposed through `~/.local/bin` so normal terminals can run it without `sudo`.

**Verification:** format, lint, typecheck, tests, build, and GitHub CI passed.

**Files**

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `.prettierignore`
- `.prettierrc.json`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.json`
- `packages/contracts/package.json`
- `packages/contracts/tsconfig.json`
- `README.md`

### Day 1 — Block 2: Draft shared CLI event envelope

**Status:** Implemented as a draft; both developers still need to approve the shared contract before integration.

**Done**

- Added the version-1 Zod event envelope.
- Restricted event types to `STAGED_SNAPSHOT`, `LOCAL_COMMIT`, and `PUSH_ATTEMPT`.
- Validated UUIDs, timestamps, optional 40-character Git SHAs, and required repository/device/workspace fields.

**Problems and resolutions**

- Detailed payload variants, byte limits, batch acknowledgements, discard representation, and secret-redaction responses are not frozen yet. They remain explicit shared decisions rather than client-only assumptions.

**Verification:** 3 contract tests passed.

**Files**

- `packages/contracts/src/cli-events.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/tests/cli-events.test.ts`

### Day 2 — Task 2.1: CLI command shell

**Status:** Foundation behavior implemented; commands that depend on later tasks fail safely with guidance.

**Done**

- Added `login`, `init`, `status`, `start`, `stop`, `remove`, and `doctor` command entries.
- Added help text explaining collected and excluded data.
- Added fresh-install status output that clearly reports an inactive watcher and empty queue.
- Added black-box subprocess tests and a buildable CLI executable.

**Problems and resolutions**

- Initial status guidance did not contain the promised direct `trace start` instruction. Production wording was corrected without weakening the test.
- Real authentication, repository binding, watcher control, cleanup, and diagnostics are intentionally not claimed as implemented yet.

**Verification:** built CLI help/status executed successfully; 2 CLI black-box tests passed.

**Files**

- `apps/cli/package.json`
- `apps/cli/tsconfig.json`
- `apps/cli/src/index.ts`
- `apps/cli/src/commands/doctor.ts`
- `apps/cli/src/commands/init.ts`
- `apps/cli/src/commands/login.ts`
- `apps/cli/src/commands/remove.ts`
- `apps/cli/src/commands/start.ts`
- `apps/cli/src/commands/status.ts`
- `apps/cli/src/commands/stop.ts`
- `apps/cli/src/commands/unavailable.ts`
- `apps/cli/tests/commands/shell.test.ts`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`

### Day 2 — Task 2.2: Durable local event queue

**Status:** Internal queue implemented; watcher and upload transport are not connected yet.

**Done**

- Added one immutable JSON event file per UUID with owner-only permissions.
- Added pending, accepted, and dead-letter states.
- Preserved event IDs and content across process restarts and retries.
- Stored useful dead-letter reasons separately from immutable evidence.
- Rejected reused UUIDs carrying different content.

**Problems and resolutions**

- A concurrency regression proved that two processes could overwrite conflicting content under the same UUID. The final implementation uses an atomic no-replace filesystem operation so one writer succeeds and the conflict is rejected.

**Verification:** 6 queue tests passed; complete suite passed with 11 tests. Format, lint, typecheck, and build also passed.

**Files**

- `apps/cli/src/queue/event-store.ts`
- `apps/cli/tests/queue/event-store.test.ts`

### Day 2 — Task 2.3: Fixture-backed report UI

**Status:** First browser-visible report experience implemented and verified locally.

**Done**

- Established the shared Next.js 16, React 19, and Tailwind CSS web shell with pinned dependency versions.
- Added a deterministic report fixture shared by the page and component tests.
- Added a report-scope form with date, account, repository, and privacy controls.
- Added a responsive evidence report grouped by account and repository.
- Displayed all required lifecycle labels: Work in progress, Committed locally, Pushed to GitHub, and Merged.
- Kept pusher and commit-author attribution separate.
- Added expandable evidence, changed-path disclosures, and clear generating, empty, and error states.
- Added a visible fixture warning so demo data cannot be mistaken for live GitHub data.

**Problems and resolutions**

- Port 3000 was already occupied by CoachConnect. Trace was started on port 3100 without stopping or changing the other application.
- Generated `.next` files were initially scanned by Prettier and ESLint. `.next` was added to the formatter, linter, and Git ignore rules.
- The new fixtures package was initially outside ESLint's TypeScript project graph. A package `tsconfig.json` and root project reference fixed the boundary without disabling source linting.
- The browser automation click did not submit the native form, although its DOM action and method were correct. A real `requestSubmit()` navigation verified the complete scope-form-to-report route.

**Verification:** 2 focused report UI tests passed; the complete suite passed with 13 tests. Format, lint, typecheck, and the optimized Next.js production build passed. Browser verification confirmed HTTP 200, correct report content, working scope-form navigation, readable hierarchy, and no clipping or overlap at desktop size.

**Files**

- `.gitignore`
- `.prettierignore`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/next-env.d.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/reports/[id]/page.tsx`
- `apps/web/app/reports/new/page.tsx`
- `apps/web/components/reports/report-view.tsx`
- `apps/web/tests/reports/report-view.test.tsx`
- `packages/fixtures/package.json`
- `packages/fixtures/tsconfig.json`
- `packages/fixtures/reports/demo.ts`
- `README.md`

### Next planned work

1. Connect `trace status` to actual queue counts and standard Linux data/config paths.
2. Add fake batch transport with independent acknowledgements.
3. Replace report fixture inputs with shared server-backed report facts after the integration contract is approved.
