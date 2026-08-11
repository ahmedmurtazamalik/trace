# Murtaza — Trace Platform and GitHub Integration Plan

> **Primary role:** Own the Trace web platform, database, authentication/authorization, GitHub App integration, repository ingestion, lifecycle reconciliation, deterministic report facts, and final deployment/security integration.

**Shared goal:** Deliver the platform contracts and APIs early enough that Ali can integrate the CLI and report experience without waiting.  
**Schedule:** 15 working days  
**Source of truth:** [`TRACE_MASTER_PLAN.md`](./TRACE_MASTER_PLAN.md)

---

## 1. Your ownership boundary

### You own

- pnpm workspace and Next.js platform setup with Ali on Day 1.
- Prisma schema, migrations, and Supabase PostgreSQL access.
- Auth.js GitHub sign-in and Trace workspace authorization.
- GitHub App registration documentation and server credentials.
- Personal-account and organization installation handling.
- Webhook verification, delivery deduplication, normalization, and enrichment.
- Repository metadata/tree/text indexing and incremental updates.
- CLI device-pairing and event-ingestion server endpoints.
- Activity lifecycle reconciliation and attribution policy.
- Deterministic report-facts builder and evidence validator.
- Connection/index health, cleanup, environment validation, and deployment path.

### Ali owns

- CLI implementation and local Git observation.
- Activity/report interface implementation.
- Gemini composition, deterministic prose fallback, LaTeX renderer/editor/compiler service.

### Shared-review areas

You must both approve changes to:

- `packages/contracts/`
- `prisma/schema.prisma` and migrations
- authentication/authorization behavior
- lifecycle attribution rules
- report evidence schema
- compiler trust boundary

Do not take over Ali's files to “save time.” Open an issue or propose a contract change, then let the owner implement it.

## 2. Working method

For each behavior:

1. Write the smallest failing test.
2. Run it and confirm the expected failure.
3. Implement the minimum behavior.
4. Run the focused test and then the affected suite.
5. Refactor only while green.
6. Commit with a plain, narrow message.
7. Open or update the PR with exact verification commands.

Use dependency injection for GitHub clients, clocks, token creation, Gemini boundary, and source retrieval. This lets Ali and CI use fixtures without live external services.

## 3. Day-by-day execution

## Day 1 — Shared foundation and contract freeze

Work beside Ali for this day.

### Block 1: Repository baseline

**Files**
- Create root workspace/config files from the approved tree.
- Create `apps/web/`, `apps/cli/`, `apps/latex-service/`, and shared packages.

**Actions**
- Initialize Git only after the empty scaffold baseline is approved and committed.
- Configure pnpm workspaces, TypeScript, formatting, lint, Vitest, and CI.
- Keep `main` protected; require checks and one review.

**Verification**
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

### Block 2: Shared schemas and fixtures

**Files**
- `packages/contracts/src/cli-events.ts`
- `packages/contracts/src/github-events.ts`
- `packages/contracts/src/report.ts`
- `packages/contracts/tests/*.test.ts`
- `packages/fixtures/github/*.json`
- `packages/fixtures/cli/*.json`
- `packages/fixtures/reports/*.json`

Create fixtures for:
- personal and organization installation;
- one push with multiple commits;
- pusher different from author;
- merged pull request;
- staged snapshot and local commit;
- duplicate event;
- valid and invalid report output.

**Gate**
- Ali can import the same package from CLI code.
- Every fixture parses through its Zod schema.

### Block 3: Provider setup together

- Create development Supabase project.
- Register development GitHub App.
- Record callback/webhook URL and exact read-only permissions in `docs/github-app.md`.
- Add environment-variable names to `.env.example`; exchange values outside Git.

**Commit examples**
```text
add workspace test baseline
add shared ingestion contracts
add sanitized GitHub fixtures
```

---

## Day 2 — Database, authentication, and workspace slice

### Task 2.1: Model workspace ownership

**Files**
- `prisma/schema.prisma`
- `prisma/migrations/...`
- `apps/web/tests/db/workspace.test.ts`

Implement the master-plan models required for this first slice:
- `Workspace`
- `User`
- `WorkspaceMember`
- `GitHubAccount`
- `GitHubIdentityLink`

Start with tests proving:
- one user cannot access another workspace;
- membership pair is unique;
- GitHub numeric ID is stable even when login changes.

### Task 2.2: Add Auth.js GitHub sign-in

**Files**
- `apps/web/lib/auth/config.ts`
- `apps/web/lib/auth/session.ts`
- `apps/web/app/api/auth/[...nextauth]/route.ts`
- `apps/web/tests/auth/*.test.ts`

Requirements:
- server-derived user identity;
- no client-supplied user/workspace trust;
- clear configuration errors;
- mock provider in automated tests.

### Task 2.3: Create/join workspace

**Files**
- `apps/web/lib/workspaces/service.ts`
- `apps/web/app/api/workspaces/*`
- `apps/web/app/dashboard/page.tsx`

Use a short-lived invite code or invite link. Do not build email delivery or complex role administration.

**Acceptance**
- First authenticated user creates a workspace.
- Second test user joins.
- Cross-workspace read/write attempts return `403` or `404` safely.

**Handoff to Ali**
- Provide fixture-authenticated development mode and workspace ID fixture for UI/CLI tests.

---

## Day 3 — GitHub App installation tracer bullet

### Task 3.1: GitHub App client boundary

**Files**
- `apps/web/lib/github/app-client.ts`
- `apps/web/lib/github/types.ts`
- `apps/web/tests/github/app-client.test.ts`

Wrap Octokit behind a narrow interface:
- create installation client;
- get installation owner;
- list selected repositories;
- get repository metadata.

Tests use fake clients, not live API calls.

### Task 3.2: Installation callback

**Files**
- `apps/web/app/api/github/install/callback/route.ts`
- `apps/web/lib/github/installations.ts`
- Prisma models/migration for `GitHubInstallation` and `Repository`.

Required behavior:
- authenticate Trace user;
- fetch installation from GitHub rather than trust query owner fields;
- support owner type `User` and `Organization` with one code path;
- ensure installation is attached to the active workspace only after confirmation;
- upsert stable repository IDs.

### Task 3.3: Connection state endpoint

Expose a contract-backed endpoint and minimal page data for:
- active;
- pending approval;
- suspended;
- deleted;
- failed sync.

**Acceptance**
- One real personal test repository connects and appears.
- Organization fixture follows the same persistence path.
- Create a disposable free test organization and complete a real owner-approved installation before final acceptance.

**Handoff to Ali**
- Provide `GET /api/connections` fixture and stable type for account/repository cards.

---

## Day 4 — Signed, idempotent GitHub ingestion

### Task 4.1: Verify webhook raw body

**Files**
- `apps/web/app/api/github/webhook/route.ts`
- `apps/web/lib/github/webhook-signature.ts`
- `apps/web/tests/github/webhook-signature.test.ts`

Test first:
- correct signature accepted;
- wrong/missing signature rejected before JSON processing;
- malformed body controlled error;
- payload/body size enforced.

### Task 4.2: Delivery ledger

Add `WebhookDelivery` and the processing service.

Behavior:
- unique `X-GitHub-Delivery` ID;
- second delivery returns success without duplicate processing;
- processing states `RECEIVED`, `PROCESSED`, `RETRYABLE`, `FAILED`;
- sanitized error details.

Return the webhook response after signature verification, durable delivery insert, and cheap normalization. Schedule bounded enrichment after the response. Never perform repository-wide indexing or model work in the webhook request. If post-response execution is interrupted, retain `PENDING`/`RETRYABLE` state for `Sync now` recovery.

### Task 4.3: Normalize events

**Files**
- `apps/web/lib/ingestion/github-normalizer.ts`
- `apps/web/tests/ingestion/github-normalizer.test.ts`

Support P0 events:
- push;
- pull request opened/updated enough for context;
- pull request closed+merged;
- installation suspended/deleted;
- repositories added/removed.

Keep sender, pusher, author, committer, co-author, and bot fields separate.

**Acceptance**
- Replay one signed push fixture twice and observe one normalized activity.
- A pusher/author mismatch remains visible in persisted data.

---

## Day 5 — Commit enrichment and initial repository indexing

### Task 5.1: Commit persistence

Add `Activity`, `Commit`, and `CommitFile` models and tests.

Upsert key:
- commit: `(repositoryId, sha)`;
- activity: `(source, externalKey)`.

Keep authored, committed, first-observed, and GitHub event times separate.

### Task 5.2: Bounded commit details

**Files**
- `apps/web/lib/github/commit-enricher.ts`
- `apps/web/lib/repositories/file-policy.ts`

Implement limits from configuration:
- maximum files per commit;
- maximum patch bytes;
- generated/vendor/lock/binary classification;
- truncated-data marker.

Do not fail the whole event because one patch is unavailable.

### Task 5.3: Repository tree import

**Files**
- `apps/web/lib/repositories/indexer.ts`
- `apps/web/tests/repositories/indexer.test.ts`

Retrieve the default-branch tree and supported text blobs through GitHub API. Do not clone.

Store each file once. `SourceChunk` stores line/offset metadata, not duplicate content.

Test:
- directory exclusions;
- per-file and total repository limits;
- Unicode;
- binary detection;
- path traversal rejection;
- stable indexed SHA.

**Acceptance**
- Connected test repository displays tree, indexed SHA, file count, skipped count, and reason summaries.

---

## Day 6 — Incremental indexing, reconciliation, and health

### Task 6.1: Incremental file updates

Handle:
- added file;
- modified file;
- renamed path;
- deleted file;
- empty/binary/oversized change.

Update repository snapshot atomically. The repository cannot claim a new indexed SHA while some changed files remain at the previous version.

### Task 6.2: Manual reconciliation

**Files**
- `apps/web/app/api/repositories/[id]/sync/route.ts`
- `apps/web/lib/github/reconcile.ts`

`Sync now` should:
- authenticate workspace membership;
- request commits since last cursor/observation;
- reuse normal commit upserts;
- update health status;
- return pending/incomplete details rather than claim completeness.

No scheduled report and no broad branch polling.

### Task 6.3: Health endpoints/UI data

Expose:
- installation status;
- last webhook;
- last successful index/reconciliation;
- pending enrichment count;
- actionable error.

**Handoff to Ali**
- Stable repository/activity read endpoints plus success/error fixtures.

---

## Day 7 — CLI pairing and ingestion server

Ali builds the CLI client in parallel; you own the server half.

### Task 7.1: Device-code pairing

**Files**
- `apps/web/app/api/cli/device/start/route.ts`
- `apps/web/app/api/cli/device/authorize/route.ts`
- `apps/web/app/api/cli/device/token/route.ts`
- `apps/web/lib/cli/devices.ts`

Requirements:
- short-lived human-readable code;
- authenticated browser approval;
- one-time exchange;
- token shown once and stored only as a hash;
- device revocation;
- polling expiration and rate bounds.

### Task 7.2: Repository binding

The CLI submits normalized remote URL/fingerprint; the server presents only repositories the active workspace installation can access. Never accept an arbitrary repository/workspace ID without checking ownership.

### Task 7.3: Event batch ingestion

**Files**
- `apps/web/app/api/cli/events/route.ts`
- `apps/web/lib/cli/ingest.ts`
- `apps/web/tests/cli/ingest.test.ts`

Behavior:
- bearer token maps to device/user/workspace;
- validate schema and payload limits;
- acknowledge each event independently;
- unique event ID makes retries idempotent;
- potential secret marker rejects/redacts according to contract;
- revoked token fails closed.

**Pairing checkpoint**
- Use Ali's real CLI against your endpoint before ending the day.

---

## Day 8 — Lifecycle reconciliation and attribution

### Task 8.1: Local observation models

Add `CliDevice` and `LocalObservation` if not already migrated. Preserve raw observation; derived lifecycle can change.

### Task 8.2: Link observations

**Files**
- `apps/web/lib/ingestion/lifecycle.ts`
- `apps/web/tests/ingestion/lifecycle.test.ts`

Rules:
- staged snapshots link by repository/device/content fingerprint;
- local commit links preceding staged observation and adds SHA;
- GitHub push links repository/SHA and changes remote state;
- merged PR changes remote state to `MERGED`;
- amended/rebased SHA supersedes local observation without deleting evidence;
- no duplicated code-change item.

### Task 8.3: Attribution

Test explicitly:
- local-only grouped under CLI identity;
- pushed grouped under GitHub actor;
- company-account actor remains company account;
- actor different from author keeps both;
- bot/co-author labels;
- unknown identity remains unknown rather than guessed.

**Acceptance**
- One real staged → local commit → pushed sequence appears as one linked lifecycle.

---

## Day 9 — Deterministic report facts and repository context retrieval

### Task 9.1: Scope validation

**Files**
- `apps/web/lib/reports/scope.ts`
- `apps/web/tests/reports/scope.test.ts`

Validate:
- workspace membership;
- date/timezone boundaries;
- immutable evidence cutoff captured when the report request begins;
- selected repository/account belongs to workspace;
- allowed activity states;
- bounded range and evidence count.

### Task 9.2: Facts builder

**Files**
- `apps/web/lib/reports/facts.ts`
- `apps/web/tests/reports/facts.test.ts`

Compute in code:
- subjects;
- repositories;
- activity states;
- commit/PR counts;
- additions/deletions when known;
- file/module grouping;
- actor/author wording inputs;
- evidence IDs.

No Gemini call in this module.

Persist the deterministic facts snapshot used for the report. New events arriving after its cutoff may appear only in a newly requested report; they must not mutate existing evidence.

### Task 9.3: Relevant context retrieval

Retrieve only:
- changed patches;
- changed current files;
- nearby/source module metadata;
- relevant README/package-manifest context;
- PR description.

Cap each item and total report context. Mark unavailable/truncated evidence.

### Task 9.4: Evidence validator

Reject model output that includes unknown evidence, repository, account, or SHA references. Return a reason Ali's fallback layer can display/log safely.

**Handoff to Ali**
- Final report-facts fixture and validation interface.

---

## Day 10 — Platform/UI support and error paths

### Task 10.1: Read APIs/server queries

Finalize contract-backed data for Ali's pages:
- workspace overview;
- connections;
- repository detail/index health;
- activity filters/detail;
- CLI devices;
- report history/version status.

### Task 10.2: Cleanup and disconnect

- Removing repository access marks it disabled.
- Device revoke blocks future events.
- Workspace deletion removes source, tokens, and reports.
- Historical report behavior is explicit before deletion.

### Task 10.3: Failure states

Test and expose actionable messages for:
- GitHub approval pending;
- installation suspended/deleted;
- API rate-limited;
- truncated diff;
- index failure;
- CLI token revoked;
- report generation failure;
- compiler unavailable.

---

## Days 11–12 — Integration and cross-review

### End-to-end integration

Run with Ali:

1. Personal GitHub installation.
2. Real installation on the disposable test organization.
3. CLI pairing and initialization.
4. Start the CLI watcher and create a staged snapshot.
5. Local commit.
6. GitHub push and duplicate webhook replay.
7. Merged PR.
8. Report request and evidence inspection.
9. LaTeX edit/compile/download.

### Adversarial tests you own

- spoofed workspace/repository IDs;
- invalid GitHub signatures;
- replayed delivery/event IDs;
- organization installation attached by wrong user;
- source path/size abuse;
- GitHub text containing prompt instructions;
- actor/author mismatch;
- force push and deleted branch;
- source cleanup after disconnect/workspace deletion.

### Cross-review Ali's work

Focus on:
- CLI token storage and queue loss;
- existing Git hook preservation;
- report evidence validation actually being called;
- LaTeX compilation isolation;
- edited version overwrite behavior.

Report blockers with exact reproduction; let Ali fix them.

---

## Day 13 — Security and deployment

### Task 13.1: Secret/config audit

- Runtime-validate server secrets.
- Inspect built client for accidental secret exposure.
- Confirm logs redact authorization headers, GitHub tokens, private keys, source text, and CLI tokens.

### Task 13.2: Compiler isolation verification

Even though Ali owns the compiler implementation, you own the deployment boundary:
- separate container;
- no database/GitHub/Gemini/Auth secrets;
- no host source mount;
- temporary volume only;
- network disabled or strictly unnecessary during compile;
- memory/time/output limits.

### Task 13.3: Demo deployment

- Docker Compose starts from documented commands.
- Supabase migrations run from a clean database.
- Public callback/webhook URL works through the chosen tunnel/host.
- Health checks show GitHub/database/compiler status without exposing secrets.

---

## Day 14 — Documentation and blocker fixes

Own or co-author:
- `docs/architecture.md`
- `docs/setup.md`
- `docs/github-app.md`
- `docs/threat-model.md`
- `docs/troubleshooting.md`

Ask Ali to follow setup from a clean checkout while you observe silently. Every place they need verbal help becomes a documentation fix.

Do not add new features.

---

## Day 15 — Final acceptance and presentation

### Exact-snapshot verification

Run from a clean checkout and fresh database:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose build
docker compose up
```

Then perform the full manual demo script twice. Record the exact commit used.

### Presentation responsibilities

You explain:
- why sign-in and installation are separate;
- personal/organization installation architecture;
- actor/author/repository-owner distinction;
- webhook idempotency and repository indexing;
- source/privacy boundaries;
- deployment and security decisions.

Ali demonstrates the CLI and report workflow.

## 4. Your required test inventory

Before declaring your scope complete, automated tests must prove:

- [ ] Cross-workspace access denied.
- [ ] Personal and organization installation owners normalize correctly.
- [ ] Callback does not trust client owner/workspace fields.
- [ ] Valid webhook accepted; invalid signature rejected.
- [ ] Duplicate webhook creates one activity.
- [ ] Push actor and commit author remain separate.
- [ ] Repository tree/file bounds are enforced.
- [ ] Incremental add/modify/rename/delete is atomic.
- [ ] CLI device code expires and exchanges once.
- [ ] CLI token is hashed/revocable.
- [ ] Repeated CLI event is idempotent.
- [ ] Staged/local/pushed/merged lifecycle links without duplicate change.
- [ ] Company-account actor is not reassigned to a human.
- [ ] Report counts and timezone boundaries are deterministic.
- [ ] Unknown AI evidence references are rejected.
- [ ] Disconnect/deletion behavior is explicit and tested.

## 5. Handoff checklist to Ali

Do not announce an API “ready” until all are true:

- [ ] Zod request/response schema merged.
- [ ] Success and failure fixtures merged.
- [ ] Ownership/authorization behavior documented.
- [ ] Endpoint test passes.
- [ ] One exact curl/test command is in the PR.
- [ ] Breaking changes are called out before merge.

## 6. Personal anti-overengineering rules

Do not add:
- job queues or event buses;
- Redis;
- vector databases/embeddings;
- generalized provider framework;
- arbitrary organization provisioning;
- all-branch polling;
- full clones;
- analytics dashboards;
- complex role systems.

Build the demonstrated vertical flow first. Reliability comes from narrow contracts, idempotency, database constraints, and tests—not additional infrastructure.

## 7. Your completion statement

Your work is complete only when Ali can run the CLI/report experience against your real APIs without private verbal instructions, the full workflow succeeds on the exact final commit, and the web platform never claims stronger attribution or completeness than its evidence supports.
