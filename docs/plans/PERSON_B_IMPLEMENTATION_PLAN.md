# Trace Person B Frontend Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED-GREEN-REFACTOR and two-stage review: specification compliance first, code quality second. Do not implement the Trace CLI or Person A's backend.

**Goal:** Deliver Person B's complete Trace web frontend, API integration, report editing/download experience, accessibility, tests, and frontend documentation across the mandatory sequential 14-day schedule without editing Person A-owned files or depending on same-day backend implementation.

**Architecture:** A Next.js App Router application owns rendering, navigation, secure-session UX, typed API adapters, server-state handling, responsive components, and Playwright flows. Person B imports validated contracts published by Person A but never changes backend contracts directly. Every screen is first proven against deterministic MSW fixtures; real endpoint adapters are integrated only from contracts frozen at a previous daily gate.

**Tech stack:** Next.js, React, TypeScript, Tailwind CSS, imported shared schemas/types, TanStack Query for server state, React Hook Form for forms, MSW for API mocks, Vitest + React Testing Library for component/integration tests, Playwright for browser flows, axe-based accessibility checks where practical.

---

## 1. Scope and non-negotiable boundaries

### Person B owns

- `apps/web/**`: Next.js frontend, routes, API client, frontend adapters, mocks, tests, and frontend-local configuration.
- `packages/ui/**`: reusable presentational components and design tokens.
- `docs/frontend-setup.md`, `docs/user-guide.md`, and `docs/person-b-handoffs.md`.
- Frontend consumption of `packages/shared` contracts without directly editing the package.
- Frontend-only Docker asset if explicitly assigned at the integration gate; otherwise no infrastructure changes.

### Person B must not build or edit

- `apps/api/**`, `apps/worker/**`, `packages/database/**`, `packages/github/**`, or `packages/config/**`.
- `packages/shared/**`; Person A is the single writer. Contract-change requests go through a handoff note.
- `infrastructure/**`, backend Docker/Compose, Prisma schema/migrations, Redis/BullMQ, GitHub webhook handling, LLM calls, LaTeX compilation, or object storage.
- The Go CLI, enrollment/device APIs, local Git scanning/watchers, or CLI-specific dashboards.
- GitHub as the Trace login identity, PAT entry forms, or primary auth tokens in `localStorage`/`sessionStorage`.
- Root `package.json`, `pnpm-workspace.yaml`, `.env.example`, `docker-compose.yml`, or root `README.md` during parallel work.

### Product constraints

- Trace account username/password is the primary identity; GitHub is an attached integration.
- The UI says **Activity** and **Development activity** except on GitHub-specific settings.
- Activity components accept generic `source` and `type` values.
- Repository URLs are optional in frontend models.
- Contributors do not need Trace accounts.
- Canonical commits render once even if multiple ingestion sources later observe them.
- The backend is authoritative for access; the frontend never infers access from repository membership.
- Reports use the approved user-provided LaTeX theme baseline, but LaTeX generation stays server-side.
- Reports are editable through validated structured content and downloadable; the browser never accepts or executes arbitrary LaTeX.

---

## 2. Pre-Day-1 integration baseline

Before either developer begins Day 1, the integration owner commits the agreed workspace skeleton and zero-byte placeholders. This prevents both people from creating or rewriting the same root files.

```text
Trace/
├── apps/
│   ├── api/
│   ├── worker/
│   └── web/
├── packages/
│   ├── config/
│   ├── database/
│   ├── github/
│   ├── shared/
│   └── ui/
├── infrastructure/
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── .gitignore
└── README.md
```

Baseline rules:

- Person B starts only after the baseline commit exists.
- Root dependency versions and the initial lockfile are pinned at baseline.
- Person B declares frontend dependencies only in `apps/web/package.json` or `packages/ui/package.json`.
- Neither person commits competing lockfile changes during the day. The integration owner regenerates/commits the root lockfile once at the daily merge gate if package manifests changed.
- New dependencies after Day 1 require a documented request; prefer existing packages and platform APIs.
- The three specification Markdown files remain untouched.

---

## 3. Person B folder structure

```text
Trace/
├── apps/
│   └── web/                                      # Person B only
│       ├── app/
│       │   ├── (auth)/
│       │   │   ├── login/page.tsx
│       │   │   ├── register/page.tsx
│       │   │   ├── forgot-password/page.tsx
│       │   │   └── reset-password/page.tsx
│       │   ├── (app)/
│       │   │   ├── layout.tsx
│       │   │   ├── dashboard/page.tsx
│       │   │   ├── repositories/
│       │   │   │   ├── page.tsx
│       │   │   │   └── [id]/page.tsx
│       │   │   ├── activity/page.tsx
│       │   │   ├── contributors/[id]/page.tsx
│       │   │   ├── reports/
│       │   │   │   ├── page.tsx
│       │   │   │   └── [id]/page.tsx
│       │   │   ├── github/page.tsx
│       │   │   └── settings/page.tsx
│       │   ├── error.tsx
│       │   ├── global-error.tsx
│       │   ├── loading.tsx
│       │   ├── not-found.tsx
│       │   ├── layout.tsx
│       │   └── globals.css
│       ├── src/
│       │   ├── api/
│       │   │   ├── client.ts
│       │   │   ├── errors.ts
│       │   │   ├── auth.ts
│       │   │   ├── github.ts
│       │   │   ├── repositories.ts
│       │   │   ├── activity.ts
│       │   │   └── reports.ts
│       │   ├── auth/
│       │   │   ├── session-provider.tsx
│       │   │   ├── protected-route.tsx
│       │   │   └── csrf.ts
│       │   ├── components/
│       │   │   ├── shell/
│       │   │   ├── auth/
│       │   │   ├── github/
│       │   │   ├── repositories/
│       │   │   ├── activity/
│       │   │   ├── dashboard/
│       │   │   └── reports/
│       │   ├── features/
│       │   │   ├── auth/
│       │   │   ├── github/
│       │   │   ├── repositories/
│       │   │   ├── activity/
│       │   │   ├── dashboard/
│       │   │   └── reports/
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── mocks/
│       │   │   ├── browser.ts
│       │   │   ├── server.ts
│       │   │   ├── handlers/
│       │   │   └── fixtures/
│       │   ├── test/
│       │   │   ├── setup.ts
│       │   │   └── render.tsx
│       │   └── types/
│       ├── e2e/
│       │   ├── auth.spec.ts
│       │   ├── github.spec.ts
│       │   ├── repositories.spec.ts
│       │   ├── activity.spec.ts
│       │   ├── reports.spec.ts
│       │   └── accessibility.spec.ts
│       ├── public/
│       ├── .env.example                           # Frontend-only variables
│       ├── next.config.ts
│       ├── package.json
│       ├── playwright.config.ts
│       ├── postcss.config.*
│       ├── tailwind.config.*
│       ├── tsconfig.json
│       └── vitest.config.ts
├── packages/
│   └── ui/                                        # Person B only
│       ├── src/
│       │   ├── button.tsx
│       │   ├── input.tsx
│       │   ├── dialog.tsx
│       │   ├── table.tsx
│       │   ├── status-badge.tsx
│       │   ├── skeleton.tsx
│       │   ├── empty-state.tsx
│       │   ├── error-state.tsx
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
└── docs/
    ├── frontend-setup.md                          # Person B only
    ├── user-guide.md                              # Person B only
    └── person-b-handoffs.md                       # Person B only
```

Person B may simplify this structure if the repository already contains an equivalent pattern, but must not move files into Person A-owned folders.

---

## 4. Independence and contract strategy

### Prior-day contract freeze schedule

| Consuming frontend day | Contract required | Must be frozen by |
|---|---|---|
| Day 2 | Auth/session/errors | End of Day 1 |
| Day 3 | GitHub connect/status/disconnect | End of Day 2 |
| Day 4 | Repository list/detail/tracking | End of Day 3 |
| Days 5–7 | Activity/dashboard/filter/pagination | End of Day 4 |
| Days 8–10 | Report lifecycle/detail/edit/regenerate/download | End of Day 7 |

### No same-day backend dependency

- Person B writes API adapters against the previously frozen schemas.
- MSW handlers implement every success, loading, empty, unauthorized, validation, conflict, rate-limit, and server-failure state needed by the UI.
- Component and browser tests use MSW and never require a real backend, GitHub App, LLM, Redis, PostgreSQL, or LaTeX compiler.
- Real end-to-end integration is performed only after both people independently finish and merge at the day's joint gate.
- If a real endpoint is unavailable, the feature remains truthfully marked as mock-backed in the handoff; no backend implementation is added by Person B.

### Contract-change request protocol

If the imported contract cannot support a required UX:

1. Record the exact issue in `docs/person-b-handoffs.md`.
2. Propose the smallest backward-compatible request with an example payload.
3. Continue against a frontend-local adapter/fixture without editing `packages/shared`.
4. Person A accepts/rejects and publishes the change at a later gate.
5. Person B updates the adapter only after the new contract is committed.

### Frontend API-client rules

- Use the configured API base URL; never reach into the database.
- Send cookies with `credentials: "include"`.
- Never put the primary session token in browser storage.
- Follow the frozen CSRF contract for state-changing requests.
- Parse/validate responses with shared schemas at the boundary where practical.
- Normalize errors once into the shared user-facing error model.
- Treat `401` as unauthenticated/session expired, `403` as forbidden, `409` as a domain conflict, `422` as validation, and `429` as rate limited according to the published contract.
- Never expose raw backend, worker, LLM, webhook, or LaTeX errors.

---

## 5. Design and UX principles

- Professional developer-tool aesthetic; dense enough to be useful without becoming noisy.
- Clear hierarchy, predictable navigation, consistent spacing/type, and restrained motion.
- No decorative charts, giant authenticated hero sections, unnecessary gradients, or meaningless metrics.
- Every asynchronous view has loading, empty, partial, stale, success, and recoverable-error behavior.
- Every destructive action has clear consequences and confirmation when appropriate.
- Keyboard navigation, visible focus, semantic landmarks, accessible names, reduced-motion support, and color contrast are built in from the start.
- Mobile layouts preserve primary actions and information; tables become usable responsive lists rather than horizontally unusable pages.
- GitHub **access** and Trace **tracking** are visibly distinct.
- Contributors are presented as contributors, never as missing Trace users.
- Reports present factual metrics separately from AI-authored prose.

---

## 6. Daily implementation loop

For each behavior-changing vertical slice:

1. Write one failing component/integration test.
2. Run the narrow test and confirm it fails for the expected missing behavior.
3. Add the minimum implementation.
4. Run the narrow test and confirm it passes.
5. Refactor while green.
6. Run the affected feature tests.
7. Run frontend lint, typecheck, and production build when the slice affects routing/build behavior.
8. Review for accessibility, responsive behavior, secrets, accidental backend changes, and mock/contract drift.
9. Commit the focused slice with a plain dependency-ordered message.
10. Record actual commands/results and mock-versus-real status in the handoff.

Suggested focused commits:

- `add frontend application shell`
- `add login form states`
- `add GitHub connection status`
- `add repository tracking controls`
- `add activity filters`
- `connect activity API adapter`
- `add report content editor`
- `add report PDF download`

---

# 7. Fourteen-day Person B plan

## Day 1 — Frontend foundation

**Objective:** Produce a standalone frontend shell using mock data without importing unfinished same-day backend code.

**Own folders:** `apps/web/**`, `packages/ui/**`, `docs/frontend-setup.md`, `docs/person-b-handoffs.md`.

### Tasks

1. Inspect the current repository and preserve all specification/plan files.
2. Initialize/configure the Next.js TypeScript app only inside `apps/web`.
3. Configure Tailwind, fonts, color tokens, spacing, focus states, reduced motion, and responsive breakpoints.
4. Create `packages/ui` primitives needed immediately: button, input, label, card, table, badge, dialog, skeleton, empty state, and error state.
5. Build public and authenticated layouts, top/side navigation, mobile navigation, skip link, landmarks, and active-route behavior.
6. Add page shells for auth, dashboard, repositories, activity, reports, GitHub, and settings.
7. Configure Vitest/RTL, MSW, Playwright, and frontend-local fixtures.
8. Create route smoke tests, navigation keyboard tests, and responsive shell tests.
9. Add frontend `.env.example` containing only public/non-secret frontend configuration such as API origin.
10. Do not import `packages/shared` until the Day 1 auth contract is published at the gate.

### Verification

```bash
pnpm --filter @trace/ui test
pnpm --filter @trace/web test
pnpm --filter @trace/web lint
pnpm --filter @trace/web typecheck
pnpm --filter @trace/web build
```

Expected: frontend runs independently with mock data; all shell routes render; no backend service is required.

### Gate

- Frontend foundation passes independently.
- Person B changed no Person A-owned file.
- Day 1 auth contract is available for Day 2.

## Day 2 — Trace authentication UI

**Objective:** Build complete secure-session UX against the Day 1 auth contract.

**Own folders:** auth routes, `src/api/auth.ts`, `src/auth/**`, auth components/features/mocks/tests.

### Tasks

1. Import the frozen auth schemas/types without modifying them.
2. Implement API-client cookie credentials, CSRF adapter, normalized errors, and cancellation behavior.
3. Build registration form with accessible validation, disabled/submitting states, duplicate-field errors, and success navigation.
4. Build login form with generic credential failure, rate-limit state, disabled-account state, and session-expired messaging.
5. Implement session bootstrap via `/auth/me`, protected layout behavior, logout, and safe return path.
6. Build forgot-password and reset-password flows without revealing account existence.
7. Prevent auth tokens from entering local/session storage, query strings, logs, or rendered error details.
8. Add MSW tests for success, validation, unauthenticated, disabled, rate-limited, expired, network, and server-error states.
9. Add Playwright mock flow: register → login → protected dashboard → logout → protected route rejected.

### Gate

Auth UI and browser tests pass entirely against contract mocks. No GitHub UI is started early.

## Day 3 — GitHub integration UX

**Objective:** Explain and operate GitHub as an integration attached to an existing Trace account.

**Own folders:** GitHub route, API adapter, GitHub components/features/mocks/tests; repository page uses mock visual data only.

### Tasks

1. Import the Day 2 GitHub contract.
2. Build disconnected, connecting/redirecting, connected, reconnect-required, suspended, callback-error, and disconnected-history-retained states.
3. Implement the Connect action as browser navigation to the backend-provided safe URL; never request or accept a PAT.
4. Display linked GitHub user separately from installation status and repository counts.
5. Add disconnect confirmation that explicitly says historical activity remains.
6. Add callback-result handling without rendering raw OAuth/state errors.
7. Create repository-list visual prototypes using local fixtures only; do not add real tracking behavior yet.
8. Test connect navigation, callback success/failure, status refresh, disconnect, and session expiration.

### Gate

GitHub UX passes against mocks; no same-day GitHub backend code is needed.

## Day 4 — Repository management UI

**Objective:** Make large repository sets practical while clearly distinguishing access from tracking.

**Own folders:** repository routes, API adapter, components/features/mocks/tests.

### Tasks

1. Import the Day 3 repository contract.
2. Build repository list/table and responsive card presentation with owner/name, visibility, default branch, access, tracking, and optional URL.
3. Add search, filters, stable URL query state, clear-all, and useful no-results behavior.
4. Add enable/disable tracking with optimistic or pending UI only if the contract supports safe rollback; otherwise use explicit pending completion.
5. Keep GitHub accessibility and Trace tracking as separate labels/actions.
6. Handle inaccessible-but-historical, renamed, private, empty, loading, stale, partial, forbidden, and server-error states.
7. Build repository details shell and last-activity/contributor placeholders from contract fixtures.
8. Test idempotent toggles, rollback/failure, keyboard operation, search/filtering, responsive behavior, and nullable repository URLs.

### Gate

Repository management is complete against the prior-day contract. Activity/dashboard contract is available for Day 5.

## Day 5 — Activity experience

**Objective:** Build a clear generic activity timeline against frozen fixtures while Person A independently builds webhook infrastructure.

**Own folders:** activity route, timeline/filter/card components, activity mocks/tests.

### Tasks

1. Import the Day 4 activity contract.
2. Build date, repository, contributor, source, and activity-type filters with URL query synchronization.
3. Build canonical commit and push cards showing contributor, repository, message, timestamp, files, additions, and deletions.
4. Keep rendering driven by generic `source` and `type`; unknown future values receive a safe fallback rather than crashing.
5. Add stable pagination/load-more UI without duplicate entries.
6. Add grouped timeline hierarchy without exposing webhook internals.
7. Implement loading, empty, filtered-empty, partial-data, retry, and forbidden states.
8. Test filter combinations, query restoration, pagination dedupe, unknown types, optional URLs, and contributors without Trace accounts.

### Gate

Activity UI passes against mocks; it has no dependency on same-day webhook work.

## Day 6 — Dashboard

**Objective:** Answer “What work happened today?” using the already frozen activity/dashboard contract.

**Own folders:** dashboard route, summary/recent-activity components, dashboard mocks/tests.

### Tasks

1. Build deterministic metric cards for activity, repositories, contributors, commits, files changed, additions, and deletions.
2. Build recent work grouped by meaningful repository/contributor context.
3. Add dashboard date/repository filters only where they improve decisions.
4. Add GitHub-not-connected, no-tracked-repositories, no-activity, partial-data, loading, and error states with actionable links.
5. Use no decorative or model-inferred productivity charts.
6. Share canonical activity rendering with the Activity page rather than duplicating components.
7. Test metric formatting, zero/large values, partial responses, responsive hierarchy, and keyboard navigation.

### Gate

Dashboard passes against mocks; no dependency on Person A's same-day worker implementation.

## Day 7 — Real activity API adapter integration

**Objective:** Replace activity/dashboard mock adapters with production adapters while retaining MSW tests and truthful fallback states.

**Own folders:** `src/api/activity.ts`, activity/dashboard query hooks and integration tests; no backend files.

### Tasks

1. Keep imported Day 4 contract unchanged.
2. Implement real fetch/query adapters for `/api/v1/activity` and repository activity.
3. Map URL filters to validated query parameters and parse response schemas at the boundary.
4. Add request cancellation, retry rules, session-expiration handling, stable cursor pagination, and stale-data behavior.
5. Connect Activity and Dashboard to the adapter through dependency-injected/query-layer seams so MSW remains usable.
6. Add contract-fixture tests proving mock and real adapters return the same frontend model.
7. Run a joint smoke test against Person A's endpoint only after both independent Day 7 branches pass and merge.

### Gate

Frontend adapter and tests pass independently; after merge, real authorized activity appears without changing UI components.

## Day 8 — Report lifecycle UI

**Objective:** Build report creation/history/status/detail shells against the Day 7 report contract while Person A independently builds factual aggregation.

**Own folders:** report routes, API adapter interface, lifecycle components/features/mocks/tests.

### Tasks

1. Import the frozen report contract.
2. Build date and timezone-aware report request form.
3. Build report history with pending, processing, completed, and failed states only.
4. Add create action, duplicate/conflict handling, empty date, zero-activity, queue-failure, unauthorized, and safe failure messages.
5. Build report details shell and status polling abstraction using MSW.
6. Display source-neutral “Development activity” language.
7. Add disabled/download-unavailable behavior until status is completed.
8. Test status transitions, retry, duplicate creation, session expiry, URL routing, and responsive history.

### Gate

Report lifecycle UI passes without an LLM, database, queue, or real PDF.

## Day 9 — Structured report presentation and editor

**Objective:** Present factual metrics and editable structured narrative without exposing AI JSON or LaTeX.

**Own folders:** report detail/editor components, validation hooks, mocks/tests.

### Tasks

1. Render executive summary, repository sections, contributor sections, accomplishments, and deterministic statistics.
2. Keep factual metrics visually and structurally separate from editable AI prose.
3. Build an accessible structured-content editor limited to fields allowed by the frozen contract.
4. Add dirty state, save, cancel/revert, revision indicator, validation, save conflict, and unsaved-navigation warning.
5. Never provide arbitrary LaTeX editing or browser compilation.
6. Add generation progress and safe AI-failure states without raw provider output.
7. Test malformed/unknown fields, long prose, special characters, revision conflict, validation failure, save retry, keyboard editing, and screen-reader labels.

### Gate

Structured report results and editing work against mocks; no same-day AI worker dependency exists.

## Day 10 — Final report UX and real adapters

**Objective:** Connect report polling, revisions, regeneration, and downloads to frozen contracts while Person A independently implements rendering/storage.

**Own folders:** report API adapter, report detail/history components, report E2E tests.

### Tasks

1. Implement real create/list/detail/update-revision/regenerate/download adapters from the Day 7 contract.
2. Poll only pending/processing reports with bounded intervals and stop on completed/failed/unmount.
3. Save structured edits with revision/conflict handling; do not overwrite newer content silently.
4. Implement PDF download with safe filename/content handling and clear unavailable/expired-artifact behavior.
5. If the contract includes safe `.tex` source download, expose it as a download only—not an in-browser compiler/editor.
6. Preserve manual edits according to revision semantics when regenerating.
7. Add report preview metadata and final responsive styling.
8. Run joint real-PDF smoke testing only after both Day 10 branches independently pass and merge.

### Gate

After merge, the owner can generate, edit, regenerate, and download a report; the frontend never generates LaTeX/PDF.

## Day 11 — Frontend security, accessibility, and UX hardening

**Objective:** Harden every route and interaction without depending on backend changes.

**Own folders:** frontend code/tests/docs only.

### Tasks

1. Audit protected routes, session expiry, forbidden states, return paths, and open-redirect prevention.
2. Verify no auth/CSRF/session secret is persisted or logged improperly.
3. Add route/global error boundaries and safe user-facing errors.
4. Validate all forms and destructive confirmations.
5. Complete keyboard navigation, focus management, semantics, contrast, reduced motion, and responsive audits.
6. Test loading/empty/error states across every page.
7. Confirm no UI action assumes authorization; every backend denial remains safely handled.
8. Run automated accessibility checks plus manual keyboard checks on critical flows.

### Gate

Frontend security/UX regression tests pass; no frontend authorization is treated as authoritative.

## Day 12 — Frontend test completion

**Objective:** Finish automated frontend coverage and fix defects without adding major scope.

**Own folders:** frontend tests and bug fixes only.

### Tasks

1. Complete component tests for shared primitives and feature states.
2. Complete API integration tests with MSW for auth, GitHub, repositories, activity, dashboard, reports, editor, and downloads.
3. Complete Playwright flows: register/login/logout, mocked GitHub connect, repository tracking, activity filtering/pagination, report generation/status/edit/download.
4. Test desktop and mobile viewport classes.
5. Test session expiration and API errors during in-flight actions.
6. Fix every defect with a failing regression test first.
7. Run full frontend tests, lint, typecheck, build, and accessibility suite with actual recorded output.
8. Add no major feature.

### Gate

All frontend suites and production build pass independently.

## Day 13 — Frontend documentation and polish

**Objective:** Make the frontend understandable and usable without editing backend/infrastructure documentation.

**Own folders:** `docs/frontend-setup.md`, `docs/user-guide.md`, frontend code/tests.

### Tasks

1. Document frontend prerequisites, configuration, install, dev, test, Playwright, build, and mock-server commands.
2. Document registration/login, GitHub connection, access versus tracking, activity filters, reports, editing, regeneration, and downloads.
3. Document that CLI support is future work; do not claim it exists.
4. Document frontend environment variables without copying backend secrets.
5. Perform final content, typography, spacing, empty-state, mobile, and focus polish.
6. Verify another developer can run the frontend with MSW and no external credentials.
7. Do not edit root README; provide an integration-ready summary for the integration owner.

### Gate

A fresh developer can run/test the frontend from frontend docs; a user guide covers all implemented workflows.

## Day 14 — Final frontend QA

**Objective:** Prove the frontend definition of done and fix only release-blocking defects.

**Own folders:** frontend fixes and final handoff only.

### QA path

1. Start from a clean worktree and install from the integrated lockfile.
2. Run lint, typecheck, unit/integration tests, Playwright, accessibility checks, and production build.
3. Verify registration, login, logout, forgot/reset, protected routes, session expiry, and disabled account.
4. Verify GitHub disconnected/connected/reconnect/disconnect states and history-retention messaging.
5. Verify repository search/filter/access/tracking and private/public/optional-URL behavior.
6. Verify dashboard metrics, activity timeline, filters, pagination, repository view, contributor view, and unknown source/type fallback.
7. Verify report date selection, pending/processing/completed/failed, structured content, editing/revisions, regeneration, PDF download, and safe errors.
8. Verify mobile layouts, keyboard-only use, focus management, contrast, reduced motion, and basic screen-reader semantics.
9. Verify no secrets or primary tokens exist in browser storage, source maps, logs, fixtures, or committed files.
10. Run joint end-to-end smoke testing against the integrated backend only after both independent QA suites pass.
11. Record exact commands, results, mock-versus-real coverage, and remaining non-core limitations.

### Gate

All required frontend flows are objectively proven; no new architecture or unverified completion claim is introduced.

---

## 8. Required frontend test matrix

| Area | Required proof |
|---|---|
| Application shell | All routes, desktop/mobile navigation, active state, keyboard/focus behavior |
| Authentication | Register/login/logout/me/reset, validation, disabled/rate-limited/session-expired states, no token storage |
| GitHub | Connect redirect, callback result, account vs installation status, reconnect/disconnect, history-retention copy |
| Repositories | Access vs tracking, search/filter, toggle success/failure, private/public, renamed/inaccessible, nullable URL |
| Activity | Date/repository/contributor/source/type filters, URL sync, stable pagination, canonical dedupe, unknown type fallback |
| Dashboard | Correct metrics, zero/large/partial values, recent activity, useful empty states |
| Reports | Create/history/status polling, safe failure, structured rendering, editing/revisions, regeneration, PDF download |
| Authorization UX | 401/403 on every protected domain, no cross-user data rendered from stale cache |
| Accessibility | Keyboard flows, focus, labels, landmarks, dialogs, contrast, reduced motion, automated axe checks |
| Responsive | Auth, navigation, tables/lists, activity, dashboard, report editor/detail at mobile and desktop widths |
| Build quality | Lint, typecheck, tests, Playwright, production build, no secrets or core TODOs |

---

## 9. Person B daily handoff template

```markdown
## Day N — Person B

### Done
- ...

### Person B-owned files changed
- ...

### Contract consumed
- Domain/version:
- Fixture path:
- No direct shared-contract edits: YES / NO

### Mock versus real status
- Mock-backed:
- Real adapter:
- Joint smoke test:

### Tests and builds actually run
- Command:
- Result:

### Contract change requests
- None / exact backward-compatible request:

### Problems/risks
- ...

### Next-day joint gate
- READY / BLOCKED
- Reason:
```

---

## 10. Conflict-prevention checklist

Before every commit and handoff, Person B confirms:

- [ ] No file under `apps/api`, `apps/worker`, `packages/database`, `packages/github`, `packages/config`, `packages/shared`, or `infrastructure` changed.
- [ ] No root workspace/Compose/README file changed during parallel work.
- [ ] Imported contract was frozen before the current day.
- [ ] Same-day backend implementation was not required to write or test the frontend.
- [ ] Mocks match the imported schema and are labeled as mocks.
- [ ] No GitHub PAT, primary auth token storage, CLI implementation, browser LaTeX compilation, or fake completion claim was added.
- [ ] Feature tests were observed failing before implementation and passing afterward.
- [ ] Accessibility and responsive behavior were checked for the changed flow.

---

## 11. Final Person B definition of done

- Next.js production build passes.
- Registration, login, logout, reset, protected routes, and session expiration behave correctly through secure cookie sessions.
- GitHub is clearly an integration, not Trace login.
- Repository access and Trace tracking are distinct and practical at scale.
- Dashboard answers what work happened today with deterministic useful metrics.
- Activity is source-neutral, filterable, paginated, canonical, and readable.
- Repository and contributor views handle contributors without Trace accounts.
- Reports support date selection, history, progress, safe failure, structured presentation, editing/revisions, regeneration, and PDF download.
- The browser never calls an LLM, emits/compiles arbitrary LaTeX, or accesses backend storage/database directly.
- Every important view has loading, empty, error, forbidden, and responsive behavior.
- Component, API integration, Playwright, accessibility, lint, typecheck, and build checks pass with actual recorded output.
- Person B edited no Person A-owned folder and introduced no CLI implementation.
