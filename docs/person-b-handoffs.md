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
- Endpoints: `/api/v1/github/connect`, `/callback`, `/status`, `/connection`.
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
- Added the shared-contract-validated `GET /api/v1/github/installation` frontend adapter.
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
