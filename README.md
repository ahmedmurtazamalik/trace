# Trace Planning Package

Trace is an on-demand engineering activity and reporting system that combines authorized GitHub activity, opt-in local Git observations, repository context, and editable LaTeX/PDF reports.

The repository now has its Phase 0 pnpm/TypeScript/Vitest baseline. Application features are developed on short-lived branches and shared contracts remain drafts until both developers approve them.

## Read in this order

1. [`TRACE_MASTER_PLAN.md`](./TRACE_MASTER_PLAN.md) — authoritative scope, architecture, shared contracts, phases, testing, risks, and definition of done.
2. [`MURTAZA_PLAN.md`](./MURTAZA_PLAN.md) — Murtaza's web platform, database, GitHub App, ingestion, and integration responsibilities.
3. [`ALI_PLAN.md`](./ALI_PLAN.md) — Ali's CLI, report experience, AI synthesis, LaTeX, and frontend responsibilities.

If an individual plan conflicts with the master plan, the master plan wins until both developers explicitly update the decision together.

## Tools and schemas

### Implemented toolchain

| Area                                  | Tool                       | Current version or role                              |
| ------------------------------------- | -------------------------- | ---------------------------------------------------- |
| Runtime                               | Node.js                    | `>=22.13.0`                                          |
| Monorepo/package manager              | pnpm workspaces            | `10.15.1`                                            |
| Language                              | TypeScript                 | `5.9.x`                                              |
| Runtime validation                    | Zod                        | Shared CLI contract validation                       |
| Unit/contract/browser-component tests | Vitest                     | `3.x`                                                |
| UI component tests                    | Testing Library + jsdom    | `16.3.0` + `26.1.0`                                  |
| Web application                       | Next.js                    | `16.2.6`                                             |
| UI runtime                            | React + React DOM          | `19.2.6`                                             |
| Styling                               | Tailwind CSS + PostCSS     | `4.2.1` + `8.5.6`                                    |
| Linting                               | ESLint + typescript-eslint | `9.x` + `8.x`                                        |
| Formatting                            | Prettier                   | `3.x`                                                |
| CI                                    | GitHub Actions             | Format, lint, typecheck, tests, and production build |

### Planned tools not integrated yet

The 15-day master plan also calls for Auth.js, a GitHub App with Octokit, Supabase PostgreSQL with Prisma, Gemini structured output, isolated Tectonic LaTeX compilation, and Docker Compose. Their presence in the plan does not mean they are already implemented.

### Implemented schemas and state models

#### CLI event envelope — schema version 1

Source: `packages/contracts/src/cli-events.ts`

| Field                          | Validation                                             |
| ------------------------------ | ------------------------------------------------------ |
| `eventId`                      | UUID                                                   |
| `schemaVersion`                | Literal `1`                                            |
| `workspaceId`                  | Non-empty string                                       |
| `deviceId`                     | Non-empty string                                       |
| `repository.remoteUrl`         | Non-empty string                                       |
| `repository.gitDirFingerprint` | Non-empty string                                       |
| `repository.headSha`           | Optional 40-character hexadecimal Git SHA              |
| `repository.branch`            | Optional non-empty string                              |
| `type`                         | `STAGED_SNAPSHOT`, `LOCAL_COMMIT`, or `PUSH_ATTEMPT`   |
| `observedAt`                   | ISO date-time with timezone offset                     |
| `payload`                      | Draft unknown payload pending frozen per-event schemas |

#### Local queue states

Source: `apps/cli/src/queue/event-store.ts`

- `pending` — stored locally and waiting for acknowledgement.
- `accepted` — acknowledged and retained separately.
- `dead-letter` — permanently rejected, with a readable reason.

These are storage states, not claims about whether engineering work was pushed or merged.

#### Activity lifecycle language

The authoritative master-plan states are `STAGED`, `LOCAL_COMMIT`, `PUSHED`, `MERGED`, `DISCARDED`, and `UNKNOWN`. The current report fixture demonstrates the first four using these user-facing labels:

| State          | User-facing label    |
| -------------- | -------------------- |
| `STAGED`       | Work in progress     |
| `LOCAL_COMMIT` | Committed locally    |
| `PUSHED`       | Pushed to GitHub     |
| `MERGED`       | Merged               |
| `DISCARDED`    | Discarded/superseded |
| `UNKNOWN`      | Unknown              |

#### Report fixture model

Source: `packages/fixtures/reports/demo.ts`

The current report UI uses deterministic fixture data grouped by account, repository, and evidence item. It includes lifecycle state, title, factual detail, actor/author disclosure, timestamp, paths, and evidence references. It is a UI fixture—not the final server API schema.

### Schemas still requiring shared approval

- Per-event payload variants and byte limits.
- Normalized GitHub activity.
- Batch acknowledgement and error envelopes.
- Final deterministic report-facts and Gemini-output schemas.
- Connection and activity read models.
- Discarded/unknown representation and redaction outcomes.

These remain drafts until both developers approve the shared contracts.

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

### Day 2 — Documentation block: Tools and schemas

**Status:** README inventory added and checked against the current code and the authoritative 15-day plan.

**Done**

- Documented implemented tools with current versions.
- Separated planned-but-unimplemented tools from working dependencies.
- Documented the version-1 CLI event envelope fields and validation.
- Explained local queue states versus activity lifecycle states.
- Documented the report fixture model and schemas still awaiting shared approval.

**Problems and resolutions**

- Planned technologies could be mistaken for completed integrations. The README now labels them explicitly as not integrated yet.
- Queue storage states and engineering lifecycle states could be confused. They are now documented separately.

**Verification:** README values were checked against `package.json`, `apps/web/package.json`, `packages/contracts/src/cli-events.ts`, `TRACE_MASTER_PLAN.md`, and `ALI_PLAN.md`; formatting passed.

**Files**

- `README.md`

### Day 2 — Task 2.2 follow-up: XDG queue integration and live status counts

**Status:** The durable queue now uses standard Linux data paths and `trace status` reads actual queue files instead of printing fixed zeroes.

**Done**

- Added XDG-aware Trace configuration and data paths with safe `HOME` fallbacks.
- Located queue files under `$XDG_DATA_HOME/trace/events` or `~/.local/share/trace/events`.
- Added event-store counts for pending, accepted, and dead-letter JSON events.
- Changed `trace status` to display all three real counts.
- Kept fresh-install status and inactive-watcher guidance unchanged.

**Problems and resolutions**

- The previous status command displayed hardcoded queue counts, so it could mislead users after events existed. A black-box test reproduced that mismatch before implementation.
- While adding the integration test, the existing fresh-install test was displaced by an edit. It was restored before running RED so coverage did not regress.
- The first manual compiled-CLI run failed because `@trace/contracts` exported TypeScript source instead of its compiled package output. The package now exports `dist` JavaScript and declaration files; the built CLI then executed successfully.

**Verification:** The focused command-shell suite passed with 3 tests, including a temporary XDG home containing one event in each queue state. The complete suite passed with 14 tests. Format, lint, typecheck, and the optimized Next.js build passed. The compiled `node apps/cli/dist/src/index.js status` command also ran successfully against an isolated temporary home.

**Files**

- `apps/cli/src/config/paths.ts`
- `apps/cli/src/commands/status.ts`
- `apps/cli/src/queue/event-store.ts`
- `apps/cli/tests/commands/shell.test.ts`
- `packages/contracts/package.json`
- `README.md`

### Day 2 — Task 2.1 follow-up: Test-only saved-event sender

**Status:** A saved-event sender can now be tested without claiming a real server connection.

**Done**

- Added a sender that reads a small group of pending events.
- Let the test decide the result for each event separately.
- Moved accepted events into accepted storage.
- Moved permanently rejected events into rejected storage with a readable reason.
- Left temporary failures in pending storage so they can be tried again later.
- Rejected duplicate or unknown test results instead of changing the wrong event.

**Problems and resolutions**

- The first full lint check found an unnecessary `async` marker in the test helper. It was removed and all checks were rerun.
- This is only a controlled test sender. It does not contact GitHub, a Trace server, or any external service.

**Verification:** The focused sender test passed. It proved that one event was accepted, one was rejected with a reason, and one stayed pending. The complete suite passed with 15 tests. Format, lint, typecheck, and the optimized Next.js build passed.

**Files**

- `apps/cli/src/queue/sender.ts`
- `apps/cli/tests/queue/sender.test.ts`
- `README.md`

### Next planned work

1. Start Day 3 Task 3.1: find the Git repository root, current branch, current commit, and configured remotes.
2. Convert GitHub HTTPS and SSH addresses into one consistent `owner/repository` format.
3. Detect detached-branch and unsupported repository situations with clear messages.
