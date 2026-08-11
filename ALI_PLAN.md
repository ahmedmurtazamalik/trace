# Ali — Trace CLI, Activity Experience, and Reporting Plan

> **Primary role:** Own the Trace CLI and local Git observation, activity/report user experience, Gemini structured synthesis, deterministic fallback, LaTeX rendering/editing, isolated PDF compilation, downloads, and user-facing documentation.

**Shared goal:** Build against frozen shared contracts and checked-in fixtures so your work proceeds in parallel while Murtaza implements the real platform APIs.  
**Schedule:** 15 working days  
**Source of truth:** [`TRACE_MASTER_PLAN.md`](./TRACE_MASTER_PLAN.md)

---

## 1. Your ownership boundary

### You own

- CLI command structure, configuration, device authentication client, and help output.
- Git repository discovery and remote normalization.
- Staged-file observation, local-commit hooks, push-attempt observation, local queue/retry, and uninstall/cleanup.
- CLI secret redaction and privacy controls.
- Dashboard activity, connection, repository, report-request, report-editor, and download experiences.
- Gemini structured report composition and deterministic fallback.
- Deterministic LaTeX rendering/escaping with the supplied theme.
- Isolated Tectonic compiler service and browser integration.
- Report version UI and preservation of manual edits.
- User-facing CLI/report/testing/demo documentation.

### Murtaza owns

- Database, authentication, workspaces, GitHub App, webhooks, repository indexing, server-side CLI endpoints, lifecycle reconciliation, deterministic facts, evidence validation, deployment/security integration.

### Shared-review areas

Both developers approve:

- `packages/contracts/`
- lifecycle attribution language;
- report schema and evidence references;
- compiler trust boundary;
- CLI ingestion authentication;
- database migrations affecting your features.

Do not duplicate server types inside the CLI or UI. Import shared contracts.

## 2. Working method

Every behavior follows:

1. Write a failing test.
2. Confirm it fails for the missing behavior.
3. Add the smallest implementation.
4. Run focused and affected tests.
5. Refactor while green.
6. Commit one coherent change.

Build against fixtures first. Murtaza's API being unfinished is not a blocker unless a previously agreed contract must change.

All Git tests use disposable temporary repositories. Never run destructive tests against either developer's real repository.

## 3. Day-by-day execution

## Day 1 — Shared foundation and contract freeze

Work beside Murtaza.

### Block 1: Baseline tooling

Help establish:
- pnpm workspace;
- shared TypeScript/format/lint/Vitest configuration;
- CI;
- package boundaries;
- empty app shells.

### Block 2: Shared contracts

Co-author and approve:
- CLI event envelope and variants;
- normalized GitHub activity;
- report facts/model output;
- connection/activity read models;
- error envelope.

Add sanitized fixtures covering:
- staged snapshot;
- changed staged snapshot;
- local commit;
- push attempt;
- actor different from author;
- staged/local/pushed/merged report;
- AI failure and invalid evidence;
- LaTeX special characters.

### Block 3: User-language agreement

Use these exact state labels unless both developers change them:

```text
Work in progress       STAGED
Committed locally      LOCAL_COMMIT
Pushed to GitHub       PUSHED
Merged                 MERGED
Discarded/superseded   DISCARDED
Unknown                UNKNOWN
```

Avoid “completed” except for merged/pushed facts that actually support it.

---

## Day 2 — CLI shell, local queue, and report UI fixture

### Task 2.1: CLI command shell

**Files**
- `apps/cli/src/index.ts`
- `apps/cli/src/commands/login.ts`
- `apps/cli/src/commands/init.ts`
- `apps/cli/src/commands/status.ts`
- `apps/cli/src/commands/start.ts`
- `apps/cli/src/commands/stop.ts`
- `apps/cli/src/commands/remove.ts`
- `apps/cli/src/commands/doctor.ts`
- `apps/cli/tests/commands/*.test.ts`

Commands should fail with actionable messages and non-zero exit codes. `trace --help` must explain what is and is not collected. `trace start` runs the staged-file watcher as a tracked background process; `trace stop` shuts it down cleanly. Automatic restart after reboot is outside the Linux MVP, so `trace status` must make an inactive watcher obvious.

Do not implement real login on this day; inject a fake transport.

### Task 2.2: Durable local queue

**Files**
- `apps/cli/src/queue/event-store.ts`
- `apps/cli/tests/queue/event-store.test.ts`

Use an atomic filesystem queue under the user's config/data directory:
- one immutable JSON event per file;
- write temporary file then rename;
- retain event UUID across retries;
- separate pending/accepted/dead-letter states;
- no raw token or unrelated source in logs.

A file queue is sufficient; do not add local database infrastructure.

### Task 2.3: Report UI skeleton

**Files**
- `apps/web/app/reports/new/page.tsx`
- `apps/web/app/reports/[id]/page.tsx`
- `apps/web/components/reports/*`
- `apps/web/tests/reports/*.test.tsx`

Build from the shared report fixture:
- scope form;
- state badges;
- account/repository sections;
- evidence disclosure;
- generation/empty/error states.

**Acceptance**
- CLI help/status works in a temporary home directory.
- A fixture event survives process restart.
- Fixture report renders without real API/Gemini.

---

## Day 3 — Git repository discovery and staged snapshots

### Task 3.1: Git adapter

**Files**
- `apps/cli/src/git/runner.ts`
- `apps/cli/src/git/repository.ts`
- `apps/cli/tests/git/repository.test.ts`

Wrap Git subprocess calls; never build commands through unsafe shell interpolation.

Support:
- detect repository root and Git directory;
- current branch and HEAD;
- configured remotes;
- normalize GitHub HTTPS and SSH URLs to stable `owner/repo`;
- detect detached head;
- refuse unsupported worktree/submodule cases clearly for MVP.

### Task 3.2: Repository initialization

`trace init` writes only Trace configuration, never source files. It asks the user to choose a connected remote when multiple exist.

Store:
- Trace workspace/repository binding;
- local Git-directory fingerprint;
- privacy options;
- hook installation metadata.

### Task 3.3: Staged diff capture

**Files**
- `apps/cli/src/git/staged.ts`
- `apps/cli/src/git/index-watcher.ts`
- `apps/cli/tests/git/staged.test.ts`

Observe `.git/index` changes and run bounded Git commands equivalent to:
- staged name/status;
- staged numstat;
- staged text patch.

Requirements:
- debounce rapid index writes;
- content fingerprint deduplicates identical state;
- include changed paths/stats and bounded text patch;
- mark binary/generated/lock files without uploading content;
- empty staged state supersedes prior snapshot;
- never inspect unrelated directories.

The watcher exists only while `trace start` is active. Store a PID/instance record, reject duplicate starts, remove stale PID state safely, and stop cleanly. Do not claim staged coverage for periods when it was inactive.

**Acceptance**
- In a temporary repository, `git add` causes exactly one queued snapshot after debounce.
- Re-adding unchanged content sends no new snapshot.
- Unstaging generates replacement/discard state.

---

## Day 4 — Local commits and hook coexistence

### Task 4.1: Hook manager

**Files**
- `apps/cli/src/git/hooks.ts`
- `apps/cli/tests/git/hooks.test.ts`

Install Trace hooks without destroying existing hooks:
- preserve existing executable/content;
- chain Trace safely;
- avoid recursion;
- record what Trace changed;
- `trace remove` restores prior state;
- document `core.hooksPath` limitations.

P0 hooks:
- `post-commit`;
- `pre-push` or safest supported push observation mechanism;
- optional `post-checkout`/`post-merge` only if needed to refresh state.

### Task 4.2: Local commit event

Capture:
- SHA;
- parents;
- author/committer metadata as evidence;
- branch;
- staged fingerprint linkage;
- changed paths/stats and bounded patch.

Do not claim GitHub actor before a webhook confirms it.

### Task 4.3: Amend/rebase behavior

Test:
- normal commit;
- amend creates new SHA and supersedes old local observation;
- reset removes current local state without deleting evidence;
- merge commit is labeled;
- hook failure never blocks the user's Git operation; it writes a local diagnostic and queues later.

**Acceptance**
- Stage → commit yields one linked local lifecycle in fixture output.
- Existing dummy hook still executes before/after Trace installation.

---

## Day 5 — Device login and real transport integration

Murtaza supplies the device endpoints; continue using fake transport until then.

### Task 5.1: Device login client

**Files**
- `apps/cli/src/auth/device-flow.ts`
- `apps/cli/src/config/credentials.ts`
- `apps/cli/tests/auth/device-flow.test.ts`

Flow:
1. Request code.
2. Display URL/code and attempt to open browser.
3. Poll with server-provided interval.
4. Handle pending, slow-down, expired, denied, and approved responses.
5. Store token with owner-only file permissions.

Never print the token. `trace logout` deletes it locally; dashboard revoke invalidates it remotely.

### Task 5.2: Batch transport

**Files**
- `apps/cli/src/transport/client.ts`
- `apps/cli/src/queue/sender.ts`

Requirements:
- send small bounded batches;
- independent acknowledgements;
- accepted events move out of pending;
- retry transient failures with capped exponential backoff/jitter;
- authentication errors pause and tell user to log in;
- permanent validation failures go to dead-letter with a useful reason.

### Task 5.3: Real pairing checkpoint

Pair with Murtaza and test:
- login;
- repository selection/binding;
- staged event ingestion;
- duplicate retry;
- device revocation.

Commit updated server response fixture if reality differs from contract; never silently special-case the client.

---

## Day 6 — Offline resilience, secret safety, and CLI usability

### Task 6.1: Offline and restart

Test with endpoint unavailable:
- staging and commits still queue;
- process restart retains queue;
- reconnect sends in original observed order;
- event IDs do not change;
- partial batch success is safe.

### Task 6.2: Secret filtering

**Files**
- `apps/cli/src/privacy/redaction.ts`
- `apps/cli/tests/privacy/redaction.test.ts`

Implement bounded rules for obvious credentials:
- private-key headers;
- common token/password assignment patterns;
- `.env` and known secret-file paths;
- configured user exclusions.

Prefer dropping/redacting suspicious patch content while retaining filename/statistics. Warn the user locally. Do not promise perfect secret detection.

### Task 6.3: Commands and diagnostics

`trace status` shows:
- logged-in identity/workspace;
- bound repository;
- watcher/hook state;
- pending/dead-letter event counts;
- last successful upload;
- privacy settings.

`trace doctor` checks:
- Node/Git availability;
- repository support;
- token permissions;
- hook coexistence;
- server reachability;
- configuration corruption.

`trace start` and `trace stop` must be safe to repeat. After a reboot, `trace status` reports the watcher inactive and tells the user to run `trace start`.

`trace remove` stops watching, removes only Trace-owned configuration/hooks, and explains whether queued data remains.

**Acceptance**
- A fresh graduate can install, initialize, inspect status, disconnect, and recover from offline mode using only help text.

---

## Day 7 — Activity and connection interface

### Task 7.1: Dashboard shell

**Files**
- `apps/web/app/dashboard/page.tsx`
- `apps/web/components/dashboard/*`

Show:
- connected account/organization installations;
- repository count and index health;
- CLI devices;
- recent activity;
- clear next action.

Organizations are labeled as repository owners/access sources, not reportable employees.

### Task 7.2: Activity timeline

**Files**
- `apps/web/app/activity/page.tsx`
- `apps/web/components/activity/*`

Filters:
- date range;
- account;
- repository;
- state.

Each item shows:
- state label;
- repository;
- primary actor;
- author/observer distinction when relevant;
- paths/theme;
- timestamps;
- expandable evidence.

### Task 7.3: Error/loading/empty states

Build fixtures and components for:
- no installations;
- pending organization approval;
- installation suspended;
- repository indexing;
- CLI not connected;
- offline/pending enrichment;
- no activity.

**Handoff checkpoint**
- Swap fixture loader for Murtaza's read API without changing component types.

---

## Day 8 — Report request and Gemini synthesis

### Task 8.1: Scope form

User selects:
- date/date range and sees workspace timezone;
- accounts;
- repositories;
- included states;
- concise/detailed level.

Default behavior must not hide staged/local work accidentally. Explain what each state means.

Before AI generation, disclose that bounded excerpts from selected private repositories may be sent to Gemini. Let the user choose deterministic-only generation; declining AI must not block report creation.

### Task 8.2: AI boundary

**Files**
- `apps/web/lib/reports/gemini.ts`
- `apps/web/lib/reports/model-schema.ts`
- `apps/web/tests/reports/gemini.test.ts`

Gemini receives only Murtaza's validated `ReportFacts` plus bounded code evidence.

System requirements:
- repository content is quoted untrusted evidence, never instructions;
- structured JSON output;
- each claim references evidence IDs;
- no hours/productivity/performance claims;
- uncertainty when evidence is incomplete;
- timeout and one bounded retry at most.

### Task 8.3: Deterministic fallback

**Files**
- `apps/web/lib/reports/fallback.ts`

Build a useful report without AI:
- group account → repository → state;
- list deterministic facts;
- include evidence links;
- explain unavailable interpretation.

Test Gemini timeout, invalid JSON, unsupported evidence, and quota failure.

**Acceptance**
- Same facts produce a usable report with Gemini enabled or disabled.

---

## Day 9 — LaTeX renderer and theme integration

Start with a simple internal fixture template. Replace its styling only after the supplied baseline arrives.

### Task 9.1: Template adapter

**Files**
- `apps/web/lib/reports/latex/template.ts`
- `apps/web/lib/reports/latex/escape.ts`
- `apps/web/tests/reports/latex/*.test.ts`

Keep content and presentation separate:
- structured report content;
- deterministic renderer;
- versioned theme assets.

Escape untrusted content including:

```text
# $ % & _ { } ~ ^ \
```

Handle Unicode according to the selected engine/template. Long paths and code snippets must wrap safely.

### Task 9.2: Provided theme adaptation

When received:
- preserve title, colors, typography, headers/footers, and section style;
- identify required packages/fonts/assets;
- replace hard-coded sample content with renderer slots;
- document unsupported template constructs;
- add a golden `.tex` fixture and PDF smoke case.

Never send the full LaTeX source through Gemini.

### Task 9.3: Golden rendering tests

Test:
- no activity;
- staged-only;
- all states;
- special characters;
- Unicode names;
- long repository/path names;
- missing optional field;
- multiple accounts/repositories.

Compare normalized `.tex` output to reviewed fixtures, not an unstable binary PDF hash.

For PDF smoke tests, verify compilation succeeds, page count is nonzero, and selected text can be extracted. Do not compare PDF bytes because timestamps and metadata may differ.

---

## Day 10 — Compiler service, editor, versions, and downloads

### Task 10.1: Isolated compiler service

**Files**
- `apps/latex-service/src/server.ts`
- `apps/latex-service/src/compiler.ts`
- `apps/latex-service/tests/*.test.ts`
- `apps/latex-service/Dockerfile`

Requirements:
- accept only authenticated internal requests;
- strict input/output size limit;
- unique temporary directory;
- Tectonic compile with shell escape unavailable;
- timeout and controlled process termination;
- return PDF or sanitized compile error;
- delete temporary files in success and failure;
- no database/GitHub/Gemini/Auth secrets;
- no host source mount;
- no network during normal compile after required assets are available.

Test invalid LaTeX, timeout, oversized input, concurrent names, and cleanup.

### Task 10.2: LaTeX editor

**Files**
- `apps/web/components/reports/latex-editor.tsx`
- `apps/web/components/reports/pdf-preview.tsx`
- `apps/web/tests/reports/editor.test.tsx`

Use CodeMirror with:
- editable source;
- dirty indicator;
- save version;
- compile button;
- clear errors with line/context when available;
- PDF preview and downloads.

### Task 10.3: Version behavior

Test:
- initial generated version;
- manual edit creates/persists new version;
- regenerate creates another version;
- existing edit is never overwritten;
- `.tex` download is exact saved source;
- PDF corresponds to the selected version.

**Acceptance**
- Edit one sentence, compile, preview, and download both files.

---

## Days 11–12 — Full integration and adversarial testing

### Integrate against real platform

Run with Murtaza:

1. Sign in and join workspace.
2. Connect personal repository.
3. Connect a repository from the disposable test organization.
4. Pair CLI.
5. Start the watcher and stage a source change.
6. Commit locally.
7. Work offline and queue another event.
8. Reconnect and upload.
9. Push and replay the webhook.
10. Merge a PR.
11. Generate, edit, compile, and download report.

### Edge cases you own

- rapid repeated `git add`;
- unstage/reset;
- amend/rebase;
- existing Git hooks;
- multiple remotes;
- detached HEAD;
- offline partial batch;
- revoked token;
- staged secret marker;
- AI invalid/unsupported evidence;
- LaTeX injection characters;
- compiler timeout and cleanup;
- regeneration after manual edit.

### Cross-review Murtaza's work

Focus on:
- whether personal and organization installation use the same model;
- whether user-controlled IDs cross workspace boundaries;
- webhook replay behavior;
- pusher/author distinction in API data;
- whether source indexing claims completeness when truncated;
- whether report facts actually match UI evidence.

Return exact reproduction steps; Murtaza fixes platform findings.

---

## Day 13 — UX/accessibility and integration polish

### Dashboard quality

- All buttons have loading/disabled/error feedback.
- Empty states explain the next action.
- State badges are understandable without color alone.
- Keyboard navigation and focus are visible.
- Core screens remain usable around 320px width.
- Technical evidence is expandable instead of overwhelming the summary.

### CLI quality

- Help has examples.
- Errors explain the next command.
- Normal successful commands are concise.
- `doctor` is safe to paste into a support message and redacts tokens/paths where appropriate.
- Interrupting the watcher/command does not corrupt queue/configuration.

No new features after this day.

---

## Day 14 — Documentation and clean-user test

Own or co-author:
- `docs/cli.md`
- `docs/testing.md`
- `docs/demo-script.md`
- report/theme sections in `docs/setup.md`
- CLI/report issues in `docs/troubleshooting.md`

Ask Murtaza to follow the CLI and report instructions from a clean environment while you stay silent. Convert every verbal clarification into documentation.

Create a one-page testing guide for non-developers:

```text
Action → expected state → where to verify → recovery if missing
```

---

## Day 15 — Final acceptance and presentation

### Final checks

- Run all project checks from a clean checkout.
- Install/pair CLI using the documented path.
- Run the full manual acceptance script twice.
- Confirm no real token/source appears in fixtures, logs, screenshots, or generated report.
- Confirm theme assets work without your development machine's fonts/files.
- Prepare a backup PDF, `.tex`, sanitized fixtures, and short recording.

### Presentation responsibilities

You demonstrate:
- Trace CLI installation/pairing;
- staged → local commit → pushed/merged lifecycle;
- clear state/attribution language;
- report request filters;
- evidence-backed explanation;
- LaTeX editing, compilation, preview, and downloads;
- privacy controls and limitations.

Murtaza explains GitHub/database/security architecture.

## 4. Your required test inventory

Before declaring your scope complete:

- [ ] CLI help/login/init/start/stop/status/remove/doctor have black-box tests.
- [ ] SSH and HTTPS GitHub remotes normalize consistently.
- [ ] Index watcher debounces and deduplicates staged state.
- [ ] Watcher rejects duplicate starts, recovers stale PID state, and stops cleanly.
- [ ] Unstage/reset supersedes prior staged observation.
- [ ] Existing Git hooks survive install/remove.
- [ ] Local commit links staged fingerprint and captures SHA.
- [ ] Offline queue survives restart and retains event IDs.
- [ ] Partial batch acknowledgement is safe.
- [ ] Token storage uses owner-only permissions and never logs token.
- [ ] Secret-like patch content is dropped/redacted with warning.
- [ ] Activity UI distinguishes observer, actor, author, and repository owner.
- [ ] Gemini output is schema validated and evidence referenced.
- [ ] Deterministic fallback works without Gemini.
- [ ] LaTeX special characters and Unicode render safely.
- [ ] Compiler limits, timeout, and cleanup pass.
- [ ] Manual edits and generated versions never overwrite one another.
- [ ] `.tex` and PDF downloads match the selected version.

## 5. API/contract dependency map

| Your feature | Build immediately against | Replace with real integration when |
|---|---|---|
| CLI login | fake device transport | Murtaza merges device endpoints |
| CLI event upload | fixture acknowledgements | Murtaza merges batch ingestion |
| Connection/dashboard UI | connection fixtures | connection read API stabilizes |
| Activity UI | lifecycle fixture | activity query stabilizes |
| Report request | report-facts fixture | facts endpoint stabilizes |
| Gemini/LaTeX | validated facts fixture | evidence validator stabilizes |
| Editor/compiler | local compiler contract | report-version API stabilizes |

If the real response violates the frozen schema, stop integration and resolve the shared contract together. Do not add UI-only translation hacks.

## 6. User-language rules

Prefer:

- “Trace observed…”
- “GitHub confirmed…”
- “The diff changes…”
- “This appears to…” when inferred.
- “Evidence was incomplete…”

Avoid:

- “worked for X hours”;
- “was productive”;
- “completed” for staged/local work;
- “wrote” when only pusher identity is known;
- “why” when only a commit subject exists;
- “all activity” when the CLI/repository was disconnected.

## 7. Personal anti-overengineering rules

Do not add:
- a long-running desktop GUI;
- terminal/screen monitoring;
- custom Git implementation;
- local database unless the file queue proves insufficient;
- automatic CLI updater;
- Windows support during MVP;
- vector search or agents;
- arbitrary template marketplace;
- collaborative editor;
- custom PDF viewer;
- broad design-system work before the product loop passes.

## 8. Your completion statement

Your work is complete only when a new user can pair the CLI, understand every activity state, recover from common errors, generate a grounded report with or without Gemini, safely edit the LaTeX, and download a matching PDF without requiring your verbal help.
