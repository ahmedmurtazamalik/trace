# Person B Handoffs

## Day 1 — Person B

### Done
- Initialized the Next.js App Router frontend inside `apps/web` with strict TypeScript and Tailwind CSS.
- Created a polished responsive developer-tool shell with desktop sidebar, mobile navigation, active-route state, skip link, semantic landmarks, visible focus, and reduced-motion behavior.
- Added page shells for dashboard, repositories, activity, reports, GitHub, settings, login, registration, forgot-password, and reset-password.
- Added `packages/ui` primitives: button, input, label, card, table, badge, dialog, skeleton, empty state, and error state.
- Added deterministic illustrative workspace fixtures and MSW browser/server handlers.
- Added Vitest/React Testing Library and Playwright configuration.
- Added frontend-local environment and setup documentation.
- Clearly marked all fixture-backed information as illustrative and all later-day controls as unavailable or planned.
- Completed a focused visual-direction pass before handoff: deeper ink/cobalt contrast, differentiated metric accents, stronger brand signal treatment, dimensional surfaces, and restrained motion with reduced-motion support.

### Person B-owned files changed
- `apps/web/**`
- `packages/ui/**`
- `docs/frontend-setup.md`
- `docs/person-b-handoffs.md`

No Person A-owned file or root workspace file was changed.

### Contract consumed
- Domain/version: None on Day 1.
- Fixture path: `apps/web/src/mocks/fixtures/workspace.ts`
- No direct shared-contract edits: YES

### Mock versus real status
- Mock-backed: Dashboard metrics/activity, repository previews, activity previews, GitHub state, and all page shells.
- Real adapter: None; intentionally deferred.
- Joint smoke test: Not applicable until a prior-day backend contract and endpoint are available.

### Tests and builds actually run
- Expected RED: `pnpm --filter @trace/ui test` — failed because UI exports did not exist.
- Expected RED: `pnpm --filter @trace/web test` — failed because shell/page/fixture modules did not exist.
- `pnpm --filter @trace/ui test` — PASS, 2 tests.
- `pnpm --filter @trace/web test` — PASS, 6 tests.
- `pnpm --filter @trace/ui typecheck` — PASS.
- `pnpm --filter @trace/web lint` — PASS, no warnings or errors.
- `pnpm --filter @trace/web typecheck` — PASS.
- `pnpm --filter @trace/web build` — PASS, 12 static routes generated.
- `pnpm --filter @trace/web test:e2e` — PASS, 22/22 desktop and mobile tests.
- Production HTTP smoke — `/dashboard` and `/login` served from the rebuilt Next.js production output.
- Rendered visual inspection — PASS on desktop and Pixel 5 viewport; no clipping, overlap, or unusable navigation found.
- Quantitative contrast samples — PASS, 4.68:1 to 16.55:1 across changed text/control pairs.
- Browser console inspection — PASS, no JavaScript errors.

### Contract change requests
- None.

### Problems/risks
- Standalone Codex delegation was unavailable because its CLI authentication returned HTTP 401. Direct implementation continued; no repository changes came from the failed process.
- Initial Playwright configuration reused an unrelated service on port 3000, producing false-positive route checks. Playwright now uses an isolated non-reused port 3100 and verifies exact route headings.
- A stale Trace Playwright server later occupied port 3100 during the visual-polish rerun. It was identified by executable and working directory, stopped, and the 22-test browser suite was rerun successfully against a fresh server.
- Running the Playwright dev server replaces the production `.next` output; the final production build must run after browser tests before `next start`.
- The root lockfile remains integration-owner-controlled and was not created or modified.
- Next.js 14 and ESLint 8 emit upstream deprecation notices during dependency installation, but lint, typecheck, tests, and build pass. Dependency modernization should be coordinated rather than changed during Day 1.

### Next-day joint gate
- READY, subject to Person A publishing the frozen Day 1 auth/session/error contract and fixture.
- Day 2 Person B work: registration, login, logout/session UX, protected layout behavior, forgot/reset password, API-client cookie/CSRF handling, and auth error/loading states against contract mocks.

## Day 2 — Authentication UI

### Done
- Added a typed authentication API boundary consuming `@trace/shared` frozen schemas for register, login, current session, logout, forgot-password, and reset-password.
- Added cookie credentials on every auth request, canonical CSRF-header logout, cancellation forwarding, runtime success-response validation, and safe normalized errors.
- Implemented accessible registration, login, forgot-password, and reset-password forms with contract-aligned local validation, duplicate-submit prevention, progress, success, conflict, disabled-account, rate-limit, network, service, and invalid-token states.
- Added an in-memory session provider. Session credentials remain in the HTTP-only cookie; public user and CSRF response state are never persisted to local/session storage.
- Added `/auth/me` bootstrap, protected workspace rendering, expired-session redirects, safe local return paths, and explicit logout race protection.
- Added authenticated identity and logout controls to the existing shell without replacing its accepted layout.
- Added desktop and Pixel 5 browser coverage using deterministic frozen-contract HTTP interception.
- Added user-facing and developer-facing documentation.

### Person B-owned files changed
- `apps/web/**`
- `docs/frontend-setup.md`
- `docs/user-guide.md`
- `docs/person-b-handoffs.md`

No Person A-owned backend/shared-contract source, root workspace configuration, root README, or root lockfile is changed.

### Contract consumed
- Source: `packages/shared/src/auth.ts` merged into `main` through Person A's Day 1/Day 2 authentication delivery.
- API documentation: `docs/api.md`, implemented authentication API section.
- Fixtures: `packages/shared/test/fixtures/auth/*.json`.
- Endpoints: `/api/v1/auth/register`, `/login`, `/me`, `/logout`, `/password/forgot`, `/password/reset`.
- No direct shared-contract edits: YES.

### Mock versus real status
- Real adapter: `apps/web/src/api/auth.ts` targets `NEXT_PUBLIC_API_ORIGIN`, sends real cookie credentials, validates real response schemas, and uses the documented CSRF header.
- Deterministic tests: component tests inject adapters; Playwright intercepts the same frozen HTTP endpoints with contract-shaped responses.
- Live joint smoke: pending a running API/PostgreSQL/Redis environment. Forgot-password additionally needs Person A's bounded outbound provider in non-test environments; without it the backend intentionally returns `503`.

### TDD evidence
- API-client RED: missing `src/api/auth.ts`; then seven missing endpoint/error behaviors.
- Login RED: missing `login-form.tsx`.
- Session RED: missing `session-provider.tsx`.
- Registration/recovery/reset RED: missing three form components.
- Protection RED: missing `protected-session.tsx`.
- Browser RED: 28/34 initially passed; failures isolated Next route-announcer selectors, asynchronous shell readiness, and a real logout/protection redirect race. The logout state machine was corrected and focused tests passed before the complete rerun.
- Logout-failure RED: 8/9 provider tests passed; the new regression correctly found `isSigningOut` remained true after failed revocation. The provider now restores the authenticated state, resets the transition, rethrows the safe error, and the header renders retryable feedback.
- Independent-review RED: the first reviewer found literal/encoded backslash open-redirect bypasses and a late-bootstrap overwrite race. Focused tests failed exactly those three cases; return-path decoding/backslash rejection and abortable generation-guarded bootstrap now pass.
- Final-review RED: the second reviewer found that a pending logout could clear a newer login session. The new test failed only that race (`expected authenticated, received anonymous`); generation-owned logout completion/failure now preserves the newer session and all provider tests pass.
- Post-publication review RED: the delayed focused verdict found that a stale successful logout still returned normally, allowing the button handler to redirect a newly authenticated session to `/login`. Provider return-value and button-integration tests failed exactly three assertions (`undefined` vs `true`/`false`, plus one stale redirect). `signOut()` now reports ownership-aware completion and the handler redirects only on `true`; all 15 focused provider/control tests pass.

### Tests and builds actually run
- `pnpm --filter @trace/ui test` — PASS, 2/2.
- `pnpm --filter @trace/ui typecheck` — PASS.
- `pnpm --filter @trace/web test` — PASS, 43/43 across 10 files.
- `pnpm --filter @trace/web lint` — PASS, no warnings or errors.
- `pnpm --filter @trace/web typecheck` — PASS.
- `pnpm --filter @trace/web build` — PASS, 14 static pages generated.
- `pnpm --filter @trace/web test:e2e` — PASS, 34/34 on desktop Chrome and Pixel 5.
- Focused session regression — PASS, 12/12 after explicit logout-state fix.
- Desktop visual inspection — PASS; accepted split layout preserved with aligned, readable controls and no clipping.
- 393 × 851 mobile visual inspection — PASS; measured document width equals viewport width, with no clipping or overflow.
- Browser console inspection — PASS, no JavaScript errors.
- Security scan — PASS; no hardcoded secret assignments, browser token persistence, direct cookie access, unsafe HTML/eval, or debug logging.
- `git diff --check` and ownership scan — PASS; no whitespace errors or changed paths outside Person B scope.

### Problems/risks
- The fresh integrated workspace initially failed offline installation with `ERR_PNPM_NO_OFFLINE_META` for `@types/jest@29.5.14`; a normal workspace install succeeded.
- `@trace/shared` publishes `dist` entries but was not built in the fresh source workspace. Frontend-only Next/Vitest/TypeScript source aliases now consume the committed shared source without modifying Person A's package.
- `pnpm install` generated a root lockfile diff; it was explicitly reverted to preserve integration-owner scope.
- Playwright's Next dev server emits a future-version `allowedDevOrigins` warning for `127.0.0.1`; current tests and requests succeed. Coordinate the future Next upgrade rather than changing root/runtime policy in Person B's branch.

### Next-day joint gate
- Frontend Day 2 authentication functionality is ready after final quality gates.
- Live local integration verified registration/login session behavior and CSRF logout against API/PostgreSQL/Redis; password-reset delivery remains intentionally unavailable until a bounded provider exists.

## Day 3 — GitHub integration UX

### Done
- Added a typed GitHub API boundary consuming the frozen Day 2 shared schemas for connect, status, and disconnect.
- Separated Trace identity, linked GitHub account, and GitHub App installation authorization in the UI.
- Implemented disconnected, connecting, connected, reconnect-required, suspended-installation, callback-result, service-error, and retained-history states.
- Connect navigation accepts only the contract-validated backend `https://github.com/` URL; no PAT or provider token enters the frontend.
- Disconnect requires confirmation, sends the in-memory CSRF token through the canonical header, and explicitly retains historical activity.
- Added responsive status cards and a clearly labelled illustrative Day 4 repository preview.
- Added focused API, component, and desktop/mobile browser coverage plus setup/user documentation.

### Contract and boundary
- Source: `packages/shared/src/github.ts`, frozen at Person A's Day 2 gate.
- Fixtures: `packages/shared/test/fixtures/github/*.json`.
- Endpoints: `/api/v1/github/connect`, `/callback`, `/status`, `/connection`; Day 11 later changed the state-creating `/connect` operation from `GET` to CSRF-protected `POST`.
- Person A-owned backend/shared files changed: NONE.
- Mock-backed: all GitHub Day 3 browser flows; Person A's same-day GitHub backend is not required.
- Real GitHub credentials, OAuth exchange, installation tokens, repository synchronization, and tracking behavior are not implemented or claimed.

### TDD and verification
- Expected RED: focused suites failed because `src/api/github.ts` and `github-connection-panel.tsx` did not exist.
- Focused GREEN: 7/7 API/component tests passed after the minimal contract-backed implementation.
- Final web regression: 50/50 tests across 12 files.
- UI package: 2/2 tests; UI type-check passed.
- Web lint and type-check: passed with no warnings or errors.
- Playwright: 38/38 desktop/mobile scenarios verified. The initial run passed 36/38 and exposed one ambiguous test selector caused by Next's route announcer; after narrowing only that assertion, the affected Day 3 spec passed 4/4 without rerunning the unchanged scenarios.
- Production build: passed with `NODE_ENV=production`; 14/14 static pages generated. The persisted local shell had `NODE_ENV=development`, which caused the first prerender attempt to mix Next development/production runtimes.
- Scope, secret/persistence scan, and `git diff --check`: passed.

### Problems/risks
- Repository preview data is illustrative and visibly labelled; Day 4 must consume Person A's frozen Day 3 repository contract.
- Real callback/connect integration waits for Person A's Day 3 backend and configured GitHub application.

### Next-day joint gate
- Day 3 frontend is ready when final gates pass and the branch is pushed.
- Day 4 depends on the repository contract frozen by Person A at the end of Day 3.

## Day 3 integration repair — Person B

### Done
- Added the shared-contract-validated GitHub installation frontend adapter; Day 11 later changed the state-creating backend operation from `GET` to CSRF-protected `POST`.
- Added **Install GitHub App** for connected accounts without an installation.
- Added **Update GitHub App installation** for connected accounts with a suspended installation.
- Kept account reconnection ahead of installation repair when account authorization is `RECONNECT_REQUIRED`.
- Replaced the guessed post-disconnect `DISCONNECTED` state with a fresh backend status read, preserving the backend's `RECONNECT_REQUIRED` lifecycle.
- Added focused API, component, and browser regressions for installation start/recovery and disconnect refresh.

### Ownership and remaining joint gate
- Person B-owned frontend and handoff files changed; no backend or shared-contract source was modified.
- The branch now includes PR #9's synchronized dependency manifests, audited lockfile, clean-runner CI preparation, and authoritative disconnect refresh.
- The installation/recovery controls and safe refresh-failure fallback remain additional Person B repairs on top of that updated `main`.
- Person A still needs to change backend callback redirects from `/settings/github` to the implemented `/github` route before the complete OAuth/App callback journey is release-ready.

## Day 4 task 1 — Repository management foundation (Person B)

### Done
- Replaced the static repository placeholder with an interactive responsive management screen.
- Added a deterministic adapter whose list and tracking results are parsed by the frozen `@trace/shared` repository schemas.
- Kept GitHub App accessibility and per-user Trace tracking visibly separate.
- Added trimmed search with stable `?search=` URL state, clear-search behavior, and no-results feedback.
- Added explicit pending tracking completion, safe rollback/error feedback, inaccessible historical repositories, nullable GitHub URLs, visibility, branch, contributor, and last-activity states.
- Added focused adapter/component tests and a desktop/mobile browser journey.

### Problems and resolutions
- The initial pending-state test used an immediately rejected promise, so the pending state completed before the assertion. The test now controls the promise and proves the button is disabled before releasing the failure.
- Person A's Day 4 repository endpoints are same-day work, so this slice uses visibly disclosed deterministic fixtures rather than claiming live GitHub repository data.

### Verification
- Web unit/component tests: 58/58 passed.
- Repository browser journey: 2/2 desktop/mobile passed.
- Web lint and type-check: passed.
- Canonical production build: passed, 14/14 pages.
- `git diff --check`: passed.

### Files
- `apps/web/app/(app)/repositories/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/repositories.spec.ts`
- `apps/web/src/features/repositories/repository-fixture-adapter.ts`
- `apps/web/src/features/repositories/repository-fixture-adapter.test.ts`
- `apps/web/src/features/repositories/repository-management-panel.tsx`
- `apps/web/src/features/repositories/repository-management-panel.test.tsx`
- `apps/web/src/features/repositories/repository-route.tsx`

### Next
- Add detail-route shell and explicit loading/empty/forbidden/server-error fixture scenarios.
- Integrate Person A's list/detail/tracking endpoints only after their independent Day 4 contract-compatible implementation is available.

## Day 5 — Activity experience (Person B)

### Done
- Replaced the Activity placeholder with a source-neutral, contract-shaped development timeline.
- Added date, repository, contributor, source, and type filters with stable URL state and clear-all behavior.
- Added source-compatible activity type choices, generic future-value fallback, contributor display without requiring a Trace account, and deterministic factual commit/push cards.
- Added cursor pagination with deduplication and stale-request protection for filter changes and overlapping page loads.
- Added loading, empty, filtered-empty, retryable error, and pagination-error states.
- Kept fixture provenance visible: this page uses deterministic illustrative activity and does not claim live webhook processing.
- Added focused component coverage and a desktop/mobile browser journey.

### Person B-owned files changed
- `apps/web/app/(app)/activity/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/activity.spec.ts`
- `apps/web/src/features/activity/**`
- `apps/web/src/mocks/fixtures/activity.ts`
- `docs/person-b-handoffs.md`

No Person A-owned backend, worker, shared-contract, root workspace, or infrastructure file was changed.

### Contract and mock-versus-real status
- Contract: frozen `packages/shared/src/activity.ts` and the Day 4 API documentation.
- Mock-backed: Activity list, filtering, pagination, loading/empty/error states, and browser journey.
- Real adapter: not yet; the Activity API is scheduled for Person A Day 7.
- Live webhook data: not shown; Person A Day 5 accepts webhooks and Day 6 processes them.

### TDD and verification
- Expected RED: stale cursor-page regression appended an old page after filters changed; generation ownership now discards stale completion.
- Real regression caught before publication: rapid mobile filter changes could lose URL state; removing parent-to-child filter feedback fixed the race.
- Focused Activity component suite: PASS, 6/6.
- Complete web suite before the final focused race fix: PASS, 70/70; the final complete suite is rerun at the publication gate.
- Activity Playwright journey: PASS, 2/2 across desktop and mobile.
- Web lint and typecheck: PASS.
- Production build: PASS, 14/14 routes generated.
- `git diff --check`, ownership scan, and added-line secret/unsafe-API scan: PASS.

### Issues and important notes
- All activity shown on Day 5 is deterministic illustrative data from `apps/web/src/mocks/fixtures/activity.ts`.
- GitHub webhook acceptance exists on integrated `main`, but enrichment and the real Activity API are later Person A work.
- `.hermes/` remains local-only and is excluded from the Day 5 commit.

### Next-day joint gate
- Person B Day 6 builds the Dashboard against the already frozen dashboard contract.
- Person A Day 6 GitHub processing must be integrated through `main` before Day 6 coherence verification.

## Day 6 — Dashboard (Person B)

### Done
- Replaced the Day 1 preview with a contract-shaped development dashboard.
- Added all seven deterministic metrics: activity, repositories, contributors, commits, files changed, additions, and deletions.
- Reused the canonical Activity summary card for recent work rather than duplicating factual rendering.
- Added date and repository filtering with stable URL state and required-date validation.
- Added `GITHUB_NOT_CONNECTED`, `NO_TRACKED_REPOSITORIES`, `NO_ACTIVITY`, `PARTIAL`, loading, and retryable error states with clear next actions.
- Added responsive desktop/mobile layout and browser coverage.
- Kept the fixture boundary visible in the UI.

### Person B-owned files changed
- `apps/web/app/(app)/dashboard/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/e2e/dashboard.spec.ts`
- `apps/web/src/features/dashboard/**`
- `apps/web/src/features/activity/activity-summary-card.tsx`
- `apps/web/src/features/activity/activity-experience.tsx`
- `apps/web/src/mocks/fixtures/dashboard.ts`
- `docs/person-b-handoffs.md`

No Person A-owned backend, worker, shared-contract, root workspace, or infrastructure file was changed.

### Contract and mock-versus-real status
- Exact integrated `origin/main`: `1a9229ad4749c39ca0a0b97897e02270fb71e7b4`.
- Contract: frozen `packages/shared/src/dashboard.ts` and `packages/shared/src/activity.ts`.
- Real: Person A's GitHub push processor is on `origin/main`; it persists canonical commit, contributor, branch, file-change, addition, deletion, and occurrence-time facts compatible with the shared Activity summary.
- Mock: Dashboard and Activity screens still load deterministic schema-validated fixtures. Both screens disclose this in the UI.
- Unfinished: no `/api/v1/activity` or `/api/v1/dashboard` route exists on the integrated tree, so the processed database facts are not yet reachable by these screens. This remains teammate/backend-owned work and no backend, worker, database, or shared-contract file was changed to hide it.

### TDD and final integrated verification
- Expected RED/GREEN history: dashboard feature absence, required-date handling, hostile URL values, browser-history synchronization, and stale-request ownership were each captured by focused regressions before their Person B fixes.
- UI test: PASS, 2/2; UI typecheck: PASS.
- Web test: PASS, 85/85; web lint and typecheck: PASS with no lint warnings or errors.
- Full Playwright desktop/mobile suite: PASS, 54/54, including timezone-aware Dashboard and Activity date boundaries across both projects.
- Independent-review RED/GREEN: fixed unsafe raw Dashboard errors, stale facts during failed filter changes, factually incorrect fixture-date relabeling, timezone-incorrect Activity day groups and fixture filtering, malformed Activity date/timezone URL handling, and the inaccurate historical `Today` label; focused component suite PASS, 21/21, and focused browser suite PASS, 6/6.
- Production build: PASS with 14/14 static pages generated under `NODE_ENV=production`.
- `git diff --check`: PASS.
- Ownership inspection: PASS; every Day 6 diff path is under `apps/web/**` or `docs/person-b-handoffs.md`.
- Rebase/conflicts: clean rebase of all three Person B commits onto the exact main SHA; zero conflicts. Final divergence before publication: main behind 0 / Day 6 ahead 4 (including this integration closeout commit).

### Issues and important notes
- Dashboard data is deterministic illustrative data from `apps/web/src/mocks/fixtures/dashboard.ts`; it is not live database, webhook, or Activity API data.
- Activity remains deterministic illustrative data from `apps/web/src/mocks/fixtures/activity.ts` for the same missing-route reason.
- Person A Day 6 was proven on live `origin/main` by commits `6f2a794`, `b86ca9f`, and `1a9229a`; GitHub showed no corresponding merged or open PR.
- `.hermes/` remains local-only, untracked, and excluded from commits.

### Next-day joint gate
- Ali can open the Day 6 PR after the verified rebased branch is pushed.
- A later backend-owned phase must publish the canonical Activity and Dashboard read routes before fixture-to-live frontend integration can be truthfully completed.

### Delayed Day 5 review remediation
- Validated URL `source` and `type` values through shared schemas and safely dropped invalid or incompatible values.
- Restored bidirectional filter synchronization for browser Back/Forward navigation.
- Cleared stale pagination loading state when filters change.
- Added semantic day-group headings, lists, and list items to the Activity timeline.
- Replaced raw loader messages with safe normalized user-facing errors and added contract validation to the fixture adapter.
- Added focused component and desktop/mobile Playwright regressions for all five findings.

### Delayed Day 6 review remediation
- Validated every Dashboard URL query and fixture response through the frozen shared schemas, with safe defaults for hostile dates and timezones.
- Restored Dashboard controls and data when URL-derived props change through browser Back/Forward navigation.
- Added stale-request, zero-value, large-number, hostile-query, and desktop/mobile history regressions.

## Day 7 — Real Activity and Dashboard API adapters (Person B)

### Done
- Added production cookie-authenticated `GET /api/v1/activity`, `GET /api/v1/repositories/:id/activity`, and `GET /api/v1/dashboard` adapters without changing the frozen shared contracts.
- Validated every outgoing query and every successful response through `@trace/shared` schemas.
- Added safe error normalization for session expiry, authorization, validation, service, network, malformed-response, and unexpected failures; raw backend details are never rendered.
- Added request cancellation for filter changes, browser-history restoration, pagination replacement, and unmount while preserving stale-response generation protection and cursor deduplication.
- Switched production Activity and Dashboard routes from local fixture loaders to the real adapters. Component tests retain dependency-injected fixture loaders and browser tests intercept the exact production API paths with contract-shaped responses.
- Added direct sign-in actions when the API reports an expired session and corrected stale global preview copy that falsely claimed no API could be connected.

### Joint review remediation
- The first immutable combined-tree review correctly rejected publication because the production Dashboard adapter targeted a missing backend route, Activity/Dashboard repository controls exposed fixture-only IDs, and the Dashboard default date was frozen to a fixture day.
- The integrated tree now implements authenticated `GET /api/v1/dashboard` over authorization-filtered canonical PostgreSQL activity, including truthful zero/partial/ready states and canonical commit-only line/file totals.
- Activity and Dashboard repository choices now come from the validated live repository API; fixture-only choices were removed. The contributor picker was removed until a real contributor-options contract exists, while valid contributor IDs in URLs remain supported by the Activity API.
- Dashboard now defaults to the current calendar date in the requested timezone and retains schema-validated hostile-query fallback behavior.
- The joint gate is covered by real API/database integration tests for authentication, state derivation, inaccessible-repository non-disclosure, local-day bounds, metrics, and recent activity. Browser interception remains frontend-only evidence and is not represented as a live webhook acceptance test.

### Person B-owned files changed
- `apps/web/src/api/activity.ts` and `activity.test.ts`
- `apps/web/src/api/dashboard.ts` and `dashboard.test.ts`
- `apps/web/src/features/activity/**`
- `apps/web/src/features/dashboard/**`
- `apps/web/src/components/shell/app-shell.tsx`
- `apps/web/e2e/activity.spec.ts`
- `apps/web/e2e/dashboard.spec.ts`
- `docs/person-b-handoffs.md`

No Person A-owned API, worker, database, shared-contract, root workspace, infrastructure, or backend-documentation file was changed.

### Contract and real-versus-mock status
- Base: merged Day 6 `origin/main` at `71e3f4085413defd7d0977bc060723d3dbac7da8`.
- Frozen contracts: `packages/shared/src/activity.ts` and `packages/shared/src/dashboard.ts` from the prior-day contract gate.
- Production frontend default: real authorized API fetches through `NEXT_PUBLIC_API_ORIGIN` (default `http://localhost:3001`) with cookies and validated responses.
- Tests: deterministic contract fixtures injected at the loader seam or returned by Playwright network interception. These prove frontend behavior and request compatibility; real Dashboard authorization and aggregation are covered separately by API/database integration tests.
- Current integrated dependency: Activity and Dashboard production adapters target implemented authenticated API routes in the combined Day 7 tree.

### TDD and verification
- Expected RED: Activity and Dashboard adapter tests each failed because their production modules did not exist.
- Activity adapter/experience focused suite: PASS, 14/14.
- Dashboard adapter/experience focused suite: PASS, 15/15.
- Focused Activity browser suite: PASS, 8/8 across desktop/mobile.
- Focused Dashboard browser suite: PASS, 4/4 across desktop/mobile.
- Final UI suite and typecheck: PASS, 2/2.
- Final web suite: PASS, 93/93; lint and typecheck PASS with no warnings or errors.
- Final full Playwright suite: PASS, 54/54 across desktop/mobile.
- Production build: PASS with 14/14 static pages generated.
- `git diff --check`, Person B ownership audit, moving-base check, and conflict simulation: PASS; `origin/main` remained `71e3f4085413defd7d0977bc060723d3dbac7da8`.

### Joint gate
- Real API/database integration verifies authenticated Activity and Dashboard routes, canonical stored events, authorization bounds, state derivation, and exact metric contribution.
- Fixture-backed and intercepted browser tests remain labeled frontend evidence; a real GitHub webhook delivery remains a separate operational acceptance gate.

## Day 7 — Activity detail enrichment (Ali patchwork)

### Done
- Expanded each Activity card to show the contributor avatar, display name, and distinct `@username` from the existing frozen Activity response.
- Added an accessible avatar label and an initials fallback when GitHub does not provide an avatar URL.
- Replaced the abbreviated timestamp with exact date, time to the second, and timezone while retaining the canonical ISO timestamp in the `<time>` element.
- Kept normalized branch display and changed-file count visible, with correct singular/plural wording (`1 file changed`, `2 files changed`).
- Added responsive card styles without changing Person A-owned API, worker, database, or shared-contract files.

### TDD and verification
- Expected RED: the focused card regression failed because no avatar/username existed, the timestamp was abbreviated, and the file count rendered as `1 files`.
- Focused Activity card regression: PASS, 1/1.
- Complete web suite: PASS, 97/97.
- Web lint and typecheck: PASS with no warnings or errors.
- Production build: PASS with 14/14 static pages generated under `NODE_ENV=production`.
- `git diff --check`: PASS.
- Browser visual QA at `http://localhost:3002/activity`: PASS; contributor identity and exact timestamp are readable with no clipping or overlap. The demo record has no branch/file facts, so those remain truthfully omitted there; the focused contract regression verifies both when supplied.

### Publication status
- Day 7 was published through PR #16 and merged into `main` after both CI checks passed.

## Day 8 — Report lifecycle UI (Person B)

### Done
- Replaced the Reports placeholder with a date- and browser-timezone-aware report request form.
- Added responsive report history for the frozen `pending`, `processing`, `completed`, and `failed` statuses only.
- Added duplicate-date, generation-unavailable/queue-failure, expired-session, empty-history, retryable-load, and safe fallback messages without exposing raw backend details.
- Added report detail routing at `/reports/[id]`, deterministic fact cards, pending/processing progress, failed state, and completed structured-content preview.
- Added bounded polling that runs only while a report is pending or processing and stops after completion/failure.
- Kept PDF download disabled because frontend download delivery is not implemented; artifact metadata alone never enables an inert control.
- Added a cookie-authenticated future report API adapter validated through `@trace/shared`; MSW verifies processing-to-completed transitions and malformed-response rejection.
- Used source-neutral **Development activity** language throughout.

### TDD and verification boundary
- Expected RED 1: lifecycle test failed because `report-lifecycle` did not exist; GREEN added creation/history with all four states.
- Expected RED 2: detail test failed because `report-detail` did not exist; GREEN added detail and bounded polling.
- Expected RED 3: duplicate handling exposed only generic copy; GREEN mapped the closed duplicate/generation/session codes safely.
- Expected RED 4: report history failure had no retry action; GREEN added separate load failure state and accessible retry.
- Expected RED 5: independent review found same-status polling stopped after one refresh, stale in-flight responses could overwrite newer routes/write after unmount, unknown fixture IDs displayed the completed fallback report, and the future create adapter omitted CSRF. GREEN added repeated-active-status polling, retry-resume polling, abort/generation guards, safe unknown-ID failure, zero-activity browser coverage, and mandatory frozen CSRF headers.
- Focused report component and adapter tests: PASS, 15/15, including detail polling, terminal stops, stale-response protection, unknown-ID safety, opaque-ID encoding, schema rejection, and mandatory CSRF.
- Focused report browser tests: PASS, 4/4 across desktop/mobile, covering live list/create HTTP requests, the CSRF-protected create request, rendered lifecycle states, detail-link generation, and 375px overflow. These tests do not claim browser navigation to detail, encoded-ID behavior, or unknown-ID rendering.
- Complete web suite: PASS, 116/116; UI: PASS, 2/2; shared contract: PASS, 24/24.
- Full Playwright desktop/mobile suite: PASS, 58/58.
- Web, UI, and shared typecheck: PASS; web lint: PASS with no warnings or errors.
- Production build: PASS with 14/14 pages, including dynamic `/reports/[id]`.
- Desktop visual QA: PASS; hierarchy, lifecycle differentiation, disabled downloads, and live factual-report disclosure are clear with no clipping.
- Real 375px mobile visual QA: PASS; zero horizontal overflow, stacked controls/cards, readable failure state, and no console/page errors.
- Final independent corrected-tree review: **APPROVED**; it verified timer/request cleanup, Strict Mode and retry overlap safety, stale/post-unmount guards, repeated active-state polling, terminal stops, safe unknown IDs, and mandatory CSRF.

### Day 8 patchwork: live Reports integration
- Production list/create/detail routes now use `apps/web/src/api/reports.ts`; fixture loaders are no longer imported by production report pages.
- Report creation forwards the authenticated session's in-memory CSRF token. The adapter keeps cookie credentials, frozen-schema validation, safe errors, abort signals, and encoded detail IDs.
- The UI now truthfully labels **Live factual reports**. PDF controls remain disabled with an accessible explanation because frontend download delivery is not implemented; artifact metadata alone never enables an inert control.
- The production-composition regression proved RED while fixture wiring remained (`listReports` had zero calls), then GREEN after live wiring. Deterministic Playwright coverage intercepts the real HTTP endpoints and asserts list requests, CSRF-protected creation, response rendering, route links, and mobile overflow.
- Person A's Reports API integration suite is the evidence for real PostgreSQL persistence, ownership isolation, duplicate handling, CSRF enforcement, and exactly-once Redis job publication; intercepted browser tests are not presented as database/queue proof.
- Day 9 generation may advance reports beyond pending when its worker and provider are configured; download remains unavailable until its frontend delivery route is implemented.

### Person B ownership
- Changed only `apps/web/**`, `docs/user-guide.md`, and `docs/person-b-handoffs.md`.
- No Person A-owned API, worker, database, shared contract, infrastructure, or root workspace file was changed.
- `.hermes/` remains local-only and uncommitted.

## Day 9 — Structured report editor and revisions

### Done
- Replaced the Day 8 read-only narrative preview with a structured editor for executive, repository, contributor, and accomplishment prose.
- Kept deterministic report facts read-only and outside the editable payload.
- Added dirty-state feedback, cancel/reset, browser-close protection, validation, in-flight cancellation, and safe retained drafts after failures.
- Added the frozen `PUT /api/v1/reports/:id/revision` adapter with cookie credentials, CSRF, optimistic `expectedRevision`, runtime request/response validation, and safe conflict/session/not-editable errors.
- Displays current revision and AI/manual provenance and adopts the canonical revision returned by the API after save.
- Added responsive desktop/mobile browser coverage.

### Person B-owned files changed
- `apps/web/**`
- `docs/person-b-handoffs.md`

No Person A-owned backend or shared-contract source was changed.

### Contract consumed
- `packages/shared/src/reports.ts`
- `PUT /api/v1/reports/:id/revision`
- `ReportRevisionUpdateRequest` / `ReportRevisionUpdateResponse`
- No direct shared-contract edits: YES.

### Real versus mock status
- Real adapter: revision saves target `NEXT_PUBLIC_API_ORIGIN`, include cookie credentials and canonical CSRF, and validate frozen schemas.
- Browser tests: deterministic contract-shaped GET fixtures exercise the production report route and editor on desktop/mobile.
- Unit/component tests: save success, exact nested prose-only patches, special characters, revision conflict with draft rebase, expired session, save retry, same/different-report replacement, in-flight cancellation/stale response, post-submit edit rebase, invalid API response, long-prose validation, dirty/cancel, and unload warning.
- Joint live API/database smoke: still requires a running authenticated API environment with a completed report owned by the test user.

### Tests and builds actually run
- Expected RED: focused editor test failed because `ReportEditor` did not exist; GREEN after the structured editor implementation.
- Focused report editor/detail/API tests — PASS.
- Complete web suite — PASS, 131/131 across 26 files.
- Report Playwright suite — PASS, 6/6 across desktop and mobile.
- Web lint — PASS, no warnings or errors.
- Web typecheck — PASS.
- Production build — PASS, 14/14 routes including dynamic `/reports/[id]`.
- `git diff --check` — PASS.
- Ownership scan — PASS; only `apps/web/**` and `docs/person-b-handoffs.md` changed, excluding local `.hermes/`.
- Security scan — PASS; no added secrets, unsafe HTML, browser credential persistence, debug logging, or dynamic evaluation.

### Problems/risks
- Independent review initially found two blockers: conflict reload could lose a retained draft, and an old in-flight save could overwrite a replacement report. Focused regressions failed only those cases; GREEN now rebases unsaved prose onto a newer same-report revision, resets on a different report ID, aborts old saves, and ignores stale completions.
- Re-review found one further race: prose typed after Save could be replaced by the canonical response. Its focused RED reproduced the loss; GREEN now rebases post-submit edits onto the saved revision and keeps them visibly unsaved.
- Final independent corrected-tree review: **PASS, no blockers**. It verified conflict draft rebasing, same/different-report replacement, save generation/abort guards, stale completion suppression, post-submit edit preservation, prose-only contract safety, and canonical revision adoption.
- Home live-test repair: applied the committed additive `20260813173500_report_processing_lease` migration, rebuilt/restarted stale API and worker processes so report routes and processing run from current code, fixed report requests to `Asia/Karachi`, made adding repository access explicit through GitHub plus **Add or refresh repositories**, and stopped exposing opaque contributor database IDs in editor headings/accessibility labels. The live revision probe still returns HTTP 404 because Person A explicitly deferred the revision-edit endpoint to Day 10; the frontend now preserves the draft and reports that backend boundary truthfully instead of collapsing it into a generic failure. Focused UX/API tests, full 131-test web suite, 6/6 report browser tests, lint, typecheck, production build, database status, and live HTTP health passed.
- Contributor identity follow-up: report contributor labels resolve authorized Activity API IDs to `displayName (@username)` without changing the frozen report contract or exposing internal IDs; strict unit and browser tests cover the real adapter path and privacy-safe fallback.
- Playwright's synthetic cross-origin PUT fulfillment produced `net::ERR_FAILED`; duplicate browser network-save coverage was removed after the API adapter test proved method, URL, CSRF, body, response validation, and conflict behavior. Browser tests cover rendered editor behavior and responsive layout.
- Live joint save remains the integration gate because local browser tests do not provide the real API, database, authenticated cookie, and completed report together.

### Next-day joint gate
- READY after final quality gates, subject to a live authenticated save smoke against Person A's Day 10 revision endpoint.
- Next planned Person B slice: Day 10 report export/download UX after Person A publishes the frozen artifact endpoint contract.

## Day 10 — Report regeneration and verified artifact delivery

### What was done (Ali / Person B)
- Added the frozen `POST /api/v1/reports/:id/regenerate` frontend adapter with cookie authentication, canonical CSRF, validated `expectedRevision`, encoded route IDs, cancellation, and runtime response validation.
- Added a Regenerate control for completed or failed reports. Unsaved narrative edits disable it with clear Save/Cancel guidance, regeneration preserves the current narrative while processing, and bounded polling resumes afterward.
- Added conflict/session/not-editable/generation-unavailable handling without replacing the current report on failure.
- Added the frozen `GET /api/v1/reports/:id/download?artifactId=...` adapter for PDF and optional TEX artifacts.
- Downloads use validated artifact metadata rather than response-provided filenames, stream no more than the frozen expected size, verify content type, byte count, and SHA-256, then create and promptly revoke a browser object URL.
- Added visible filename, kind, revision, and human-readable size metadata plus expired/unavailable/corrupted-file recovery.
- Added responsive report-file and action layouts for desktop/mobile.
- No deterministic report facts, shared schemas, backend, database, worker, infrastructure, root workspace, or root README files were changed.

### How to test
1. Open a completed report at `/reports/:id`.
2. Confirm **Report files** shows the current PDF metadata.
3. Select **Download PDF** and confirm the validated filename is used.
4. Edit narrative prose without saving; **Regenerate report** must be disabled and explain Save/Cancel.
5. Cancel or save, then regenerate; the screen should switch to Processing and resume polling.
6. For final joint proof, repeat against a real authenticated Day 10 API report and open the resulting real PDF.

### Real / mock / unfinished boundary
- **Real frontend code:** both adapters target `NEXT_PUBLIC_API_ORIGIN`, send cookies, use frozen request/query schemas, and validate every response or byte stream before delivery.
- **Mock browser proof:** Playwright intercepts contract-shaped HTTP, serves deterministic four-byte `%PDF` test bytes with the matching SHA-256, proves a real Chromium download event and safe suggested filename, and verifies save revision 1 → processing/polling → completed revision 2 → regeneration with `{ expectedRevision: 2 }`. This is transport/integrity/UI proof, not evidence of a valid rendered PDF or PostgreSQL/worker persistence.
- **Unfinished joint gate:** authenticated browser → merged real API → database/worker → generated PDF → browser download/open, plus a real stale-revision regeneration conflict. Person A's Day 10 backend is now merged; this operational smoke has not yet been run in the authenticated local runtime.

### TDD and verification
- Regeneration adapter expected RED: missing `regenerateReport`; focused GREEN verified endpoint, CSRF, body, and frozen processing response.
- Regeneration UI expected RED: missing action and dirty-draft guard; focused GREEN added revision-safe regeneration and polling resume.
- Download adapter expected RED: missing `downloadReportArtifact`; focused GREEN verified artifact query, safe metadata filename, content type, bounded size, SHA-256, and corrupted-byte rejection.
- Download UI expected RED: missing current-PDF action, metadata, and expired-file state; focused GREEN added all three.
- Focused report/API/editor tests: PASS, 29/29.
- Complete web suite with explicit `NODE_ENV=test`: PASS, 142/142 across 26 files.
- Report Playwright suite: PASS, 8/8 across desktop and mobile, including Chromium download event, save revision 1 → processing/polling → regenerate revision 2, dirty-state blocking, and mobile overflow coverage.
- Complete Playwright suite after rebasing onto merged Person A Day 10: PASS, 62/62 across desktop and mobile.
- Web lint: PASS, no warnings or errors.
- Web typecheck: PASS.
- Production build: PASS, all 14 routes generated including dynamic `/reports/[id]`.
- `git diff --check`: PASS.

### Issues / notes
- The first all-unit command inherited production React mode from browser/build work and failed uniformly with `act(...) is not supported in production builds`; rerunning with explicit `NODE_ENV=test` passed 137/137. This was an invalid test environment, not a regression.
- The first download browser mock used a route glob that matched report detail but not nested `/download`, causing repeated `Failed to fetch`. Changing the mock to the explicit `/reports/**` path-segment glob fixed the boundary; the corrected browser scenario passed.
- Integrity verification intentionally hashes the complete artifact in-browser after enforcing the frozen maximum size. This favors trustworthy delivery over instant download for large reports.
- `.hermes/` remains local-only and untracked.

### What's next
- Run the joint authenticated real-backend save/regenerate/download smoke against the now-merged Person A revision, regeneration, and artifact endpoints.
- Do not mark Day 10 overall complete until browser → API → database/worker → real PDF download/open and stale-revision conflict are proven.

## Day 11 — Frontend security, accessibility, and UX hardening

### What was done
- Audited Ali's Day 11 plan against exact merged `origin/main` commit `7caf40c3fe44e9fc547ae689fbbe9282e38fa592`, which contains Person A's merged backend Day 11 security work.
- Kept protected-route bootstrap, safe local return-path validation, cookie credentials, in-memory CSRF/session state, and closed 401/403 UI handling intact.
- Added accessible destructive confirmations for GitHub disconnection and repository tracking removal, including initial focus, Escape dismissal, Tab containment, focus restoration, pending-state protection, and retained-history explanations.
- Added first-invalid-field focus to login and registration validation.
- Replaced raw unexpected repository errors with safe user-facing fallbacks while preserving validated `RepositoryApiError` messages.
- Added reusable route/global error containment that announces and focuses safe recovery UI without rendering error messages or framework digests.
- Added automated browser audits across every public/protected page shell for landmarks, duplicate IDs, unnamed controls, missing image alternatives, and horizontal overflow.
- Added browser proof that CSRF/session identifiers never enter local storage, session storage, or readable cookies; added reduced-motion and keyboard-only critical-flow checks.
- Changed only `apps/web/**` and this Person B handoff. No backend, worker, database, shared contract, infrastructure, root README, package manifest, or lockfile was changed.

### How to test
1. Open `/login`, submit empty fields, and confirm focus moves to **Username**.
2. Open `/github`, choose **Disconnect GitHub**, and confirm focus moves to **Cancel**; Escape closes the dialog and restores focus.
3. Open `/repositories`, choose **Stop tracking**, and confirm no request occurs until **Confirm stop tracking** is selected.
4. Run `NODE_ENV=test pnpm --filter @trace/web test` and expect 156/156.
5. Run `NODE_ENV=production pnpm --filter @trace/web test:e2e` and expect 66/66 across desktop and Pixel 5.

### Issues and important notes
- The first clean-worktree test command could not start because dependencies were absent; `pnpm install --frozen-lockfile` restored the exact merged dependency tree without changing the lockfile.
- The first accessibility scanner incorrectly ignored valid wrapping `<label>` elements, and the first reduced-motion assertion compared Chromium's equivalent scientific-notation CSS serialization as text. Both test-harness assumptions were corrected; no product workaround was added.
- Automated browser tests use deterministic HTTP interception. They prove frontend security/UX behavior and request boundaries, not live PostgreSQL/Redis/worker execution.
- Ali's Day 11 slice is complete on local branch `day11`. It is not pushed, in a PR, merged, or deployed.

### Verification
- Focused RED confirmed five missing behaviors; focused GREEN: 30/30.
- Route error-boundary RED confirmed missing implementation; focused GREEN: 1/1.
- Complete web unit/component suite: PASS, 156/156 across 27 files.
- Complete Playwright suite: PASS, 66/66 across desktop Chrome and Pixel 5.
- Web lint: PASS, no warnings or errors (only Next's upstream `next lint` deprecation notice).
- Web typecheck: PASS.
- Final production build after browser tests: PASS, 14/14 routes generated.
- `git diff --check`, ownership inspection, and sensitive-browser-API scan: PASS.

### What's next
- With Ali's permission: push `day11`, then separately open the Day 11 PR.
- After merge, verify the exact integrated main branch before calling the full team Day 11 complete.

## Day 11 follow-up — repository/account requirements and typography

### What was done
- Increased the global root type scale from 16px to 16.5px and regular body weight to 450 without changing layout, routes, colors, or component hierarchy.
- Added a focused typography token regression test.
- Traced repository removal and GitHub identity switching through the frozen frontend/shared/backend contracts rather than adding misleading frontend-only controls.

### Issues / notes
- Durable repository removal is not in the current contract. `DELETE /repositories/:id/tracking` only disables tracking; synchronized accessible repositories remain listable. A real **Remove repository** action needs backend-persisted dismissal/removal semantics and must atomically stop tracking.
- Switching GitHub identities is explicitly blocked in `GithubService.callback`: a disconnected Trace account may reconnect the same `githubUserId`, but a different GitHub user ID is rejected. Supporting **Switch GitHub account** requires Person A to safely untrack/detach old repositories/installations, enforce cross-user uniqueness, link the new account, and add integration tests before Person B exposes the control.
- No backend/shared-contract code was changed in this follow-up.

### Verification
- Typography RED confirmed the old tokens; focused GREEN: 1/1.
- Complete web unit/component suite: PASS, 157/157 across 28 files.
- Web lint and typecheck: PASS.
- Complete Playwright suite: PASS, 66/66 across desktop and Pixel 5, including all-route horizontal-overflow checks.
- Final production build after browser tests: PASS, 14/14 routes generated.
- Live computed styles: root 16.5px, body weight 450, viewport width equals body scroll width.
- Desktop visual inspection: PASS; no clipping, crowding, or layout breakage.

### What's next
- Person A must freeze contracts/implementation for durable repository removal and GitHub identity replacement.
- After those backend contracts merge, Person B can add the accessible confirmation and recovery UX test-first.
