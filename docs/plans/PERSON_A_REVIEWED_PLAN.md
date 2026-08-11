# Trace Person A Backend Plan — Reviewed and Corrected

> **For Hermes:** Implement task-by-task with strict RED-GREEN-REFACTOR and two-stage review: specification compliance first, code quality second. Do not implement the Trace CLI or frontend.

**Goal:** Deliver Person A's NestJS API, database, GitHub App integration, workers, report pipeline, security, tests, and backend deployment work across the mandatory sequential 14-day schedule without editing Person B-owned files or depending on same-day frontend work.

**Architecture:** A pnpm TypeScript monorepo contains a NestJS API, BullMQ worker, PostgreSQL/Prisma data package, GitHub integration package, validated shared HTTP contracts, and backend infrastructure. The Next.js frontend consumes only versioned `/api/v1` contracts. Cross-boundary contracts are frozen no later than the previous day's gate.

**Tech stack:** pnpm workspaces, TypeScript, NestJS, Prisma/PostgreSQL, Redis/BullMQ, Argon2id, GitHub App APIs/webhooks, Jest, Supertest, Docker/Compose, configurable structured-output LLM adapter, controlled LaTeX renderer, configurable report storage.

---

## 1. Review verdict

The submitted `ALI_V2_PLAN.md` is broadly aligned with the three authoritative Trace specifications. It correctly keeps Trace username/password identity separate from GitHub, excludes the CLI and frontend, models per-user repository tracking, verifies webhooks, deduplicates commits, separates contributors from Trace users, and keeps AI/LaTeX outside webhook handling.

It is **not materially overstepping Person A's backend role**, but the following corrections are required.

### Corrections applied

1. **Add a pre-Day-1 integration baseline.** Both people otherwise need to initialize root workspace files on Day 1. A designated integration owner creates and commits only agreed folders, workspace files, and zero-byte placeholders before parallel coding begins.
2. **Use single-writer ownership.** Person A alone writes `packages/shared/**`, root workspace configuration, backend infrastructure, and backend docs. Person B imports shared contracts but never edits them during a day.
3. **Freeze contracts one day before consumption.** The submitted plan finalizes GitHub and repository contracts on the same days Person B needs them. Corrected sequence:
   - Day 1: auth contract frozen for Day 2.
   - Day 2: GitHub connection contract frozen for Day 3.
   - Day 3: repository contract frozen for Day 4.
   - Day 4: activity/dashboard contract frozen for Days 5–7.
   - Day 7: report lifecycle/content contract frozen for Days 8–10.
4. **Correct report status transitions.** `completed-stage` is not a valid status. During AI work the report remains `processing`; it becomes `completed` only after the final artifact is available. Failures become `failed`.
5. **Clarify GitHub identity versus installation.** OAuth/user authorization identifies the linked GitHub account; GitHub App installations authorize repository access. Neither becomes Trace login.
6. **Clarify webhook tracking semantics.** Ingest a repository only while there is at least one authorized Trace tracking membership. Historical data is retained after tracking is disabled or GitHub is disconnected.
7. **Avoid root documentation conflicts.** Person A writes backend-specific docs; Person B writes frontend-specific docs. The root README is integration-owner-only until final assembly.
8. **Keep Day 13 ownership backend-only.** Person A's production Compose and Docker work must not scaffold, rewrite, or prescribe implementation inside `apps/web`.
9. **Add the current report requirement safely.** Trace uses the user-provided LaTeX theme baseline and reports must be editable and downloadable. Editing is limited to validated structured report content/revisions; users and the LLM never submit arbitrary LaTeX. Person A owns revision APIs and deterministic rendering; Person B owns the editor UX.
10. **Do not create CLI placeholders beyond neutral enums/types.** No device, enrollment, token-generation, local-repository, or CLI ingestion implementation belongs in this plan.

---

## 2. Pre-Day-1 integration baseline

This is a coordination prerequisite, not implementation work for either person.

A designated integration owner creates and commits:

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

Rules:

- Placeholders are zero-byte unless a workspace file needs the minimum agreed content.
- Person A may subsequently edit root workspace files; Person B uses `apps/web/package.json` for frontend dependencies.
- Person B does not edit `packages/shared`; Person A does not edit `apps/web` or `packages/ui`.
- The three original specification Markdown files remain untouched.
- Day 1 starts only after this baseline is committed and both people branch from it.

---

## 3. Ownership-safe repository structure

```text
Trace/
├── apps/
│   ├── api/                              # Person A only
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── auth/
│   │   │   │   ├── errors/
│   │   │   │   ├── guards/
│   │   │   │   ├── logging/
│   │   │   │   ├── middleware/
│   │   │   │   └── validation/
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── github/
│   │   │       ├── repositories/
│   │   │       ├── webhooks/
│   │   │       ├── activity/
│   │   │       ├── reports/
│   │   │       ├── audit/
│   │   │       └── health/
│   │   └── test/
│   ├── worker/                           # Person A only
│   │   ├── src/
│   │   │   ├── queues/
│   │   │   ├── processors/
│   │   │   ├── reports/
│   │   │   ├── latex/
│   │   │   │   └── templates/           # Controlled theme baseline
│   │   │   └── storage/
│   │   └── test/
│   └── web/                              # Person B only; never edit
├── packages/
│   ├── database/                         # Person A only
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/
│   │   ├── prisma/seed.ts
│   │   └── src/
│   ├── shared/                           # Person A single writer
│   │   └── src/
│   │       ├── auth.ts
│   │       ├── github.ts
│   │       ├── repositories.ts
│   │       ├── activity.ts
│   │       ├── reports.ts
│   │       ├── errors.ts
│   │       └── index.ts
│   ├── github/                           # Person A only
│   ├── config/                           # Person A only
│   └── ui/                               # Person B only; never edit
├── infrastructure/                       # Person A only
│   ├── docker/
│   ├── latex/
│   └── compose/
├── docs/
│   ├── api.md                            # Person A
│   ├── backend-setup.md                  # Person A
│   ├── github-app.md                     # Person A
│   ├── operations.md                     # Person A
│   ├── person-a-handoffs.md              # Person A
│   ├── frontend-setup.md                 # Person B; never edit
│   └── person-b-handoffs.md              # Person B; never edit
├── docker-compose.yml                    # Person A single writer
├── .env.example                          # Person A backend variables
├── pnpm-workspace.yaml                   # Person A after baseline
├── package.json                          # Person A after baseline
└── README.md                             # Integration owner only
```

---

## 4. Shared contract and dependency protocol

### Contract publication rule

Person A publishes each contract before Person B's consuming day. Publication means all of the following are committed:

1. Validated schema/DTO in `packages/shared/src/<domain>.ts`.
2. Contract tests in `packages/shared/src/<domain>.spec.ts`.
3. Method, path, request, response, error codes, and examples in `docs/api.md`.
4. Stable fixture under `packages/shared/test/fixtures/<domain>/`.
5. Handoff entry in `docs/person-a-handoffs.md`.

Person B may build against the fixture without the endpoint running. Same-day backend availability is never a coding prerequisite.

### Contract conventions

- All endpoints use `/api/v1` except liveness/readiness if deliberately documented otherwise.
- IDs are opaque strings.
- Timestamps are ISO 8601; report dates are `YYYY-MM-DD` with an explicit timezone.
- Lists use one cursor-based pagination model with stable ordering.
- Errors are `{ code, message, requestId, fieldErrors? }`.
- Repository DTOs distinguish `accessible` from `trackingEnabled`.
- Activity DTOs always expose generic `source` and `type`.
- Reports expose only `pending | processing | completed | failed`.
- Report content is validated structured data. Editing creates revisions; it does not accept arbitrary LaTeX.
- Repository URLs are nullable where practical so future local-only repositories do not force a redesign.

### Daily implementation loop

For every behavior-changing slice:

1. Write one failing test.
2. Run it and verify the expected failure.
3. Add the minimum implementation.
4. Run the narrow test and verify it passes.
5. Refactor while green.
6. Run domain tests and affected integration tests.
7. Run lint, typecheck, and build for affected packages.
8. Review the diff for secrets, unsafe logs, frontend edits, migration drift, and unplanned contract changes.
9. Commit the focused slice with a plain dependency-ordered message.
10. Record commands and actual results in the handoff.

---

# 5. Corrected 14-day Person A schedule

## Day 1 — Backend foundation and auth contract

**Own folders:** root workspace files, `apps/api/**`, `packages/config/**`, `packages/database/**`, `packages/shared/**`, backend docs, `infrastructure/**`.

**Tasks:**

- Bootstrap NestJS, Prisma, PostgreSQL, Redis readiness, validation, error handling, test harnesses, Compose, seed infrastructure, and the required core/supporting schema.
- Preserve the exact required core entities and add only narrowly necessary security/operations entities: password reset token, GitHub state, webhook delivery, audit log, and report revision/artifact metadata.
- Keep canonical commit uniqueness at repository identity plus SHA.
- Freeze the complete Day 2 auth contract and fixture.
- Publish provisional shapes for later domains without claiming them frozen.

**Verification:** clean migration from zero, repeatable seed, `/health`, `/ready`, config tests, API build, no frontend/CLI files changed.

**Gate:** backend foundation runs independently; auth contract is frozen for Day 2.

## Day 2 — Authentication backend and GitHub contract

**Own folders:** `apps/api/src/modules/auth/**`, auth common utilities, `packages/database/**`, `packages/shared/src/auth.ts`, `packages/shared/src/github.ts`, backend docs.

**Tasks:**

- Implement registration, login, logout, current-user, forgot/reset password, Argon2id, hashed session tokens, HTTP-only cookies, CSRF, rate limits, disabled-user behavior, audit events, and authorization primitives.
- Test register → login → me → logout → rejection and password-reset non-enumeration.
- Freeze Day 3 GitHub connect/callback/status/disconnect contracts and fixtures.
- Define account connection and installation authorization as separate concepts.

**Gate:** auth API is secure and tested; GitHub frontend contract is frozen.

## Day 3 — GitHub connection backend and repository contract

**Own folders:** `apps/api/src/modules/github/**`, `packages/github/**`, GitHub-related database/shared files, backend docs.

**Tasks:**

- Implement fake and real-adapter boundaries for GitHub user authorization and GitHub App installation access.
- Implement authenticated connect, validated single-use state, callback, status, reconnect, and disconnect while preserving history.
- Never expose installation tokens to the frontend.
- Freeze Day 4 repository list/detail/tracking contracts and fixtures.

**Gate:** mocked GitHub connection passes independently; repository contract is frozen.

## Day 4 — Repository access/tracking and activity contract

**Own folders:** `apps/api/src/modules/repositories/**`, repository database/shared files, backend docs.

**Tasks:**

- Synchronize installation-authorized repositories by stable GitHub repository ID.
- Maintain per-user `UserRepository.trackingEnabled`; never put tracking state on global repository rows.
- Implement authorized list/detail/enable/disable with idempotency, pagination, search, and removed-access handling.
- Freeze Day 5/6/7 activity and dashboard contracts, filters, cursor pagination, source/type enums, and fixtures.

**Gate:** repository APIs work independently; activity/dashboard contract is frozen.

## Day 5 — Webhook acceptance infrastructure

**Own folders:** `apps/api/src/modules/webhooks/**`, `apps/worker/src/queues/**`, webhook database/GitHub helpers, infrastructure tests.

**Tasks:**

- Preserve raw request bytes, verify HMAC, validate headers/payload size/schema, transactionally deduplicate delivery IDs, verify installation/repository/tracking, enqueue a bounded durable reference, and return quickly.
- Add deterministic job IDs, retry/failure observability, and graceful worker shutdown foundation.
- Do not enrich commits, call AI, or generate reports in the request path.

**Gate:** a signed tracked push queues exactly once; invalid and wholly untracked deliveries do not.

## Day 6 — GitHub activity processing

**Own folders:** `apps/worker/src/processors/github/**`, related database/GitHub modules and tests.

**Tasks:**

- Normalize sender, author, and committer without guessing identity from display names/emails.
- Store one push per delivery and one commit per repository+SHA.
- Persist repository-relative commit-file metadata and generic activity rows.
- Add bounded API enrichment only when needed.
- Make overlapping pushes and job retries idempotent.

**Gate:** mocked push → queue → worker → database creates canonical activity exactly once.

## Day 7 — Activity API and report contract

**Own folders:** `apps/api/src/modules/activity/**`, `packages/shared/src/activity.ts`, `packages/shared/src/reports.ts`, backend docs.

**Tasks:**

- Implement authorized activity list and repository-specific activity with date, repository, contributor, type, source, and stable cursor pagination.
- Define timezone/day-boundary behavior.
- Freeze Day 8–10 report lifecycle, detail, revision/edit, regeneration, and download contracts and fixtures.
- Report edit contract accepts only validated structured prose fields and preserves deterministic facts.

**Gate:** activity API is integration-ready; full report frontend contract is frozen.

## Day 8 — Factual report pipeline

**Own folders:** `apps/api/src/modules/reports/**`, `apps/worker/src/queues/reports/**`, report database/shared files.

**Tasks:**

- Aggregate authorized activity by user/date/timezone/repository/contributor.
- Calculate all counts deterministically.
- Persist immutable input snapshot and create one pending report job.
- Implement create/list/detail ownership checks and queue-failure recovery.
- Do not call an LLM or compile LaTeX.

**Gate:** report input is reproducible and queued once.

## Day 9 — Structured AI report worker

**Own folders:** `apps/worker/src/reports/**`, report tests/config.

**Tasks:**

- Implement configurable structured-output provider and deterministic fake.
- Validate output against strict report schema and known repositories/contributors/evidence.
- Retry bounded transient/schema failures and store safe errors.
- Keep status `processing`; do not mark `completed` before a downloadable artifact exists.
- Create the initial editable structured revision without allowing arbitrary LaTeX.

**Gate:** report has valid structured content or a clean failed state.

## Day 10 — Controlled rendering, revisions, and downloads

**Own folders:** `apps/worker/src/latex/**`, `apps/worker/src/storage/**`, report API/storage/database files, `infrastructure/latex/**`.

**Tasks:**

- Render the supplied approved Trace theme baseline deterministically from validated facts and structured prose.
- Escape all untrusted text; compile without shell escape/network in a bounded isolated environment.
- Implement report revision update, explicit regeneration, artifact storage, authorized PDF download, and optional safe `.tex` source download if included in the frozen contract.
- Preserve revision history/manual edits so regeneration cannot silently overwrite them.
- Mark `completed` only after the final artifact is stored successfully.

**Gate:** owner can edit validated content, regenerate, and download a real PDF; cross-user access and injection fail safely.

## Day 11 — Backend security hardening

**Own folders:** backend/security-related files and backend docs only.

**Tasks:**

- Complete endpoint authorization matrix and cross-user negative tests.
- Review sessions, CSRF, CORS, state replay, installation ownership, webhooks, queues, query bounds, LLM/privacy, LaTeX/storage, log redaction, rate limits, dependencies, and secrets.
- Record residual risks without moving core requirements out of scope.

**Gate:** no endpoint relies on frontend authorization; security suite and scans pass.

## Day 12 — Backend integration testing

**Own folders:** `apps/api/test/**`, `apps/worker/test/**`, backend test helpers only.

**Tasks:**

- Run unit, integration, database, queue, security, webhook, activity, report, revision, renderer, storage, and download tests against isolated PostgreSQL/Redis.
- Fix failures with a failing regression test first.
- Run clean migrations, seed, lint, typecheck, build, dependency audit, and coverage inspection.
- Add no major functionality.

**Gate:** all backend tests and builds pass with recorded output.

## Day 13 — Backend deployment and operations

**Own folders:** `infrastructure/**`, API/worker Dockerfiles, backend docs; never `apps/web/**`.

**Tasks:**

- Build non-root production API/worker images and production-like backend Compose.
- Add migration deployment, graceful shutdown, queue draining, health/readiness, structured correlation logging, GitHub App setup, environment documentation, report storage/LLM/LaTeX operations, and smoke tests.
- Do not edit frontend Dockerfiles or frontend documentation.

**Gate:** a fresh developer can operate the backend from backend docs.

## Day 14 — Final backend QA

**Own folders:** backend fixes and final handoff only.

**Tasks:**

- Verify clean build/migration/seed, auth lifecycle, mocked GitHub connection, repository tracking, signed/duplicate webhook, canonical activity, filters/pagination, report aggregation, fake/configured LLM, revision editing, controlled LaTeX, real PDF, owner-only download, disconnect history retention, health/readiness, scans, and production images.
- Resolve only release-blocking defects; record actual commands/results and non-core limitations.

**Gate:** Person A definition of done is objectively proven.

---

## 6. Required handoff template

```markdown
## Day N — Person A

### Done
- ...

### Contracts published or changed
- Endpoint/schema:
- Contract version:
- Backward-compatible impact:
- Fixture path:

### Database/migrations
- Migration:
- Data implications:

### Configuration
- New/changed environment variables:

### Tests and builds actually run
- Command:
- Result:

### Person B integration notes
- No same-day implementation dependency:
- Mock/fixture path:

### Risks
- ...

### Next-day joint gate
- READY / BLOCKED
- Reason:
```

---

## 7. Final Person A definition of done

- API and worker production builds pass.
- Migrations apply from zero and seeds are repeatable.
- Auth/session/reset behavior is secure and tested.
- GitHub identity and installation authorization remain separate from Trace login.
- Repository access and per-user tracking remain distinct.
- Signed tracked pushes produce deduplicated contributors, commits, files, pushes, and generic activity.
- Activity APIs are authorized, source-neutral, filterable, and stably paginated.
- Report facts are deterministic; AI output is structured and validated.
- User-provided approved theme baseline is rendered through controlled templates only.
- Structured report revisions are editable without permitting arbitrary LaTeX.
- PDF/report downloads are owner-authorized.
- Historical data survives disconnect.
- Backend tests, security checks, migration checks, and builds pass with real recorded output.
- No frontend, CLI, PAT flow, hardcoded secret, or core TODO is present.
