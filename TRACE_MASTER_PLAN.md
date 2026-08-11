# Trace MVP — Shared Implementation Plan

> **Goal:** Build a functional, maintainable demonstration of Trace in which personal GitHub accounts and organizations connect selected repositories, an opt-in CLI records staged/local Git activity, Trace maintains bounded repository context, and users request editable evidence-backed LaTeX/PDF reports.

**Team:** Murtaza and Ali  
**Baseline:** 15 working days  
**Project class:** Internal training/demo MVP, not a production SaaS launch  
**Planning date:** 2026-08-10  
**Authoritative rule:** When this plan and an individual plan differ, this document wins until both developers agree to an edit.

---

## 1. Definition of success

A final demonstration is successful when two test GitHub identities can join one Trace workspace, connect personal or organization-owned repositories through the same GitHub App, generate remote and local activity, and request a report that accurately separates staged, local-commit, pushed, and merged states. The report must use the provided LaTeX theme, remain editable, compile safely, and download as both `.tex` and PDF.

The demonstration must show real end-to-end evidence, not mocked screenshots.

## 2. Product principles

1. **Evidence before prose.** Counts, identities, repository names, states, SHAs, paths, and timestamps come from deterministic code.
2. **Repository ownership is not attribution.** An installation grants access; the authenticated actor, author, and CLI observer are recorded separately.
3. **The shared company account is opaque.** Activity performed as that GitHub account is reported as Company Account, never guessed back to a human.
4. **Local work is not completed work.** Staged and local-only activity is visibly labeled work in progress.
5. **GitHub is authoritative for remote state.** CLI observations may be linked to GitHub events but cannot prove a push or merge.
6. **Reports are on demand.** There is no scheduled report generation.
7. **Source custody is bounded.** Index supported text files, not full clones, binaries, dependencies, or unlimited history.
8. **The model explains; it does not invent.** Unsupported SHAs, repositories, claims, or counts invalidate generated output.
9. **Security defaults to read-only and fail-closed.** Webhooks are signed, tokens are server-side, local tracking is opt-in, and LaTeX compilation is isolated.

## 3. MVP scope

### 3.1 Included — P0

#### Identity and workspace
- GitHub sign-in to Trace.
- One Trace workspace created by the first user; invite-code joining for other users.
- Workspace member list and basic roles: `OWNER` and `MEMBER`.
- GitHub identities represented uniformly; no special company-account behavior.

#### GitHub App
- One Trace GitHub App.
- Installation on personal accounts and organizations.
- Selection of all or specific repositories through GitHub's installation flow.
- Installation callback, suspension/deletion handling, and connection-status UI.
- Read-only metadata, contents, and pull-request permissions.
- Signed `push`, `pull_request`, and installation/repository webhooks.
- Idempotent delivery processing and manual `Sync now` reconciliation.
- Webhook request path verifies and persists normalized metadata quickly, then schedules bounded best-effort enrichment after the response; pending work remains visible and `Sync now` recovers interruptions.

#### Repository context
- Initial import of repository metadata, default branch, folder tree, and supported text files.
- Current file snapshot tied to an indexed commit SHA.
- Repository context represents the selected repository's default branch; activity may record pushes on other refs without claiming those refs are fully indexed.
- Incremental add/modify/rename/delete updates after remote pushes.
- Explicit limits for file count, per-file bytes, total indexed text, and diff size.
- Skip binaries, vendored/generated files, lock files, dependency directories, and secrets detected by basic rules.
- Module/topic context derived from paths, documentation headings, package manifests, and changed files.

#### Activity lifecycle
- Remote push and pull-request/merge activity.
- Separate repository owner, GitHub actor/pusher, commit author/committer, co-author, and bot fields when available.
- Opt-in Trace CLI for Linux as the supported MVP platform.
- CLI pairing with Trace, per-repository initialization, and offline queue.
- Explicit `trace start`/`trace stop` watcher lifecycle for initialized repositories; the Linux MVP does not silently promise restart-on-boot.
- Staged-file snapshots, local commit observations, push attempts, and remote confirmation linking.
- Clear states: `STAGED`, `LOCAL_COMMIT`, `PUSHED`, `MERGED`, `DISCARDED`, and `UNKNOWN`.
- Deduplication between CLI and GitHub observations using repository identity, SHA, and content fingerprints.

#### Activity experience
- Dashboard showing connected accounts/installations, repositories, index health, CLI devices, and recent activity.
- Filters for date range, account, repository, and state.
- Evidence details exposing paths, SHAs, PR links, and observed timestamps.

#### On-demand reports
- User chooses date range, accounts, repositories, included states, and detail level.
- Report creation freezes an evidence cutoff and immutable deterministic-facts snapshot; events arriving later never alter an existing report version.
- Deterministic report facts followed by Gemini structured synthesis.
- The report request discloses that bounded excerpts from selected private repositories may be sent to Gemini and allows deterministic generation without Gemini.
- Evidence validation: generated sections reference only supplied repository IDs and SHAs.
- Deterministic fallback report when Gemini is unavailable or invalid.
- Provided LaTeX theme integrated as a deterministic template.
- LaTeX escaping for untrusted GitHub text.
- Editable `.tex` source, saved report versions, PDF preview, `.tex` download, and PDF download.
- Isolated compilation with shell execution disabled, no application secrets, bounded runtime/memory, and temporary files deleted.

#### Quality and delivery
- Unit, integration, contract, CLI black-box, and browser acceptance tests for high-risk paths.
- GitHub Actions checks: format, lint, typecheck, tests, and production build.
- Docker Compose local demo with web application, isolated LaTeX compiler, and Supabase hosted database.
- Setup guide, demo script, test guide, architecture note, and troubleshooting page.

### 3.2 Explicitly excluded — P1 or later

- Productivity scores, employee ranking, hours worked, or performance judgments.
- Screen recording, keylogging, terminal-history capture, or arbitrary shell-command collection.
- Untracked files and unstaged-file monitoring by default.
- Windows CLI support; macOS is best effort after Linux acceptance passes.
- Public username-only monitoring without installation.
- Full repository clones, binaries, generated artifacts, complete Git history, or semantic vector databases.
- Slack, Discord, email delivery, notifications, or scheduled report generation.
- Automated organization membership provisioning or enterprise SSO.
- Billing, public SaaS onboarding, organization-wide administration, or complex RBAC.
- Issue/project-board ingestion, code-review quality scoring, CI metrics, and deployment metrics.
- Multiple arbitrary user-uploaded LaTeX themes. The provided baseline is the one MVP theme.
- Real-time collaborative LaTeX editing.
- Automatic CLI updater, signed platform binaries, or package-manager publication.
- Background distributed queues. MVP jobs use database-backed status plus bounded request/background execution.

## 4. Technology choices

| Area | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces | Shared types without Turborepo complexity |
| Web | Next.js + TypeScript | One full-stack application and familiar deployment model |
| UI | Tailwind CSS + small reusable components | Fast, free, and maintainable |
| Auth | Auth.js GitHub provider | Separates user sign-in from GitHub App installation |
| GitHub | GitHub App + Octokit | Personal/org installations, short-lived installation tokens, webhooks |
| Validation/contracts | Zod | Runtime validation shared by web and CLI |
| Database | Supabase PostgreSQL + Prisma | Hosted free database, explicit schema/migrations, familiar query layer |
| Source storage | PostgreSQL initially | Small repository count; add object storage only after measured need |
| AI | Gemini structured JSON output | Free-tier-compatible and evidence-bounded |
| LaTeX editing | CodeMirror 6 | Mature browser text editor |
| PDF compiler | Tectonic in isolated compiler service | Modern LaTeX engine; avoids embedding TeX in web process |
| CLI | Node.js + TypeScript | Shares contracts and tooling with the web application |
| Tests | Vitest, Testing Library, Playwright | One JS/TS test ecosystem |
| Local environment | Docker Compose + optional Cloudflare Tunnel | Reproducible demo and public callback during development |
| CI | GitHub Actions | Free project automation |

Do not lock framework versions in the plan. Pin exact versions in `pnpm-lock.yaml` at project initialization and update only intentionally.

## 5. Deployment boundaries

```text
Browser
  │
  ▼
Next.js web container ─────────────► Supabase PostgreSQL
  │        │
  │        ├───────────────────────► GitHub APIs / webhooks
  │        └───────────────────────► Gemini API
  │
  └──── HTTP with size/time limits ─► isolated LaTeX compiler container

Developer machine
  └──── HTTPS authenticated events ─► Next.js CLI ingestion API
```

The web application remains a modular monolith. The only separate server component is the LaTeX compiler because compiling editable user text inside a process that holds application secrets is an avoidable security risk.

For the final presentation, local Docker Compose is the guaranteed deployment. A free container host may be used if available, but the project must not depend on a provider's temporary free-tier policy. A tunnel may expose the local webhook/callback endpoint during development and demonstration.

## 6. Planned repository layout

```text
Trace/
├── README.md
├── TRACE_MASTER_PLAN.md
├── MURTAZA_PLAN.md
├── ALI_PLAN.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── docker-compose.yml
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── api/auth/
│   │   │   ├── api/github/
│   │   │   ├── api/cli/
│   │   │   ├── api/reports/
│   │   │   ├── dashboard/
│   │   │   ├── repositories/
│   │   │   └── reports/
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── auth/
│   │   │   ├── github/
│   │   │   ├── ingestion/
│   │   │   ├── repositories/
│   │   │   ├── reports/
│   │   │   └── security/
│   │   └── tests/
│   ├── cli/
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   ├── auth/
│   │   │   ├── git/
│   │   │   ├── queue/
│   │   │   └── transport/
│   │   └── tests/
│   └── latex-service/
│       ├── src/
│       ├── tests/
│       └── Dockerfile
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   └── tests/
│   ├── fixtures/
│   │   ├── github/
│   │   ├── cli/
│   │   └── reports/
│   └── test-utils/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/
│   ├── architecture.md
│   ├── setup.md
│   ├── github-app.md
│   ├── cli.md
│   ├── testing.md
│   ├── demo-script.md
│   ├── threat-model.md
│   └── troubleshooting.md
└── .github/workflows/ci.yml
```

Do not create this scaffold until the team has reviewed the tree and established Git as described in the project README.

## 7. Core data model

The schema should use stable GitHub numeric IDs, never mutable login names, as external keys.

| Model | Essential fields and constraints |
|---|---|
| `Workspace` | `id`, `name`, `timezone`, timestamps |
| `User` | `id`, Auth.js identity fields, timestamps |
| `WorkspaceMember` | `workspaceId`, `userId`, `role`; unique pair |
| `GitHubAccount` | GitHub numeric `accountId`, `login`, `type` (`USER`, `ORGANIZATION`), avatar; globally unique account ID |
| `GitHubIdentityLink` | `userId`, `githubAccountId`; unique pair |
| `GitHubInstallation` | workspace, installation numeric ID, owner account, status, repository-selection mode; unique installation ID |
| `Repository` | installation, GitHub repository ID, owner, full name, visibility, default branch, enabled/index status, indexed SHA; unique GitHub repository ID per workspace |
| `RepositoryFile` | repository, path, blob SHA, language/kind, size, text content or compressed content, indexed SHA; unique repository/path |
| `SourceChunk` | file, start/end line, symbol/topic metadata; store offsets/metadata rather than duplicate full content |
| `WebhookDelivery` | delivery ID, event type, signature-valid flag, processing state/error; unique delivery ID |
| `Activity` | workspace, repository, kind/state, actor account, source (`GITHUB`, `CLI`), occurred/observed times, external key, evidence JSON; unique source/external key |
| `Commit` | repository/SHA unique pair, author/committer raw and linked accounts, message, authored/committed/first-observed timestamps, parent SHAs, merge/bot flags |
| `CommitFile` | commit, path, previous path, status, additions/deletions, bounded patch or patch-storage reference |
| `CliDevice` | user/workspace, device name, token hash, last seen, revoked timestamp |
| `LocalObservation` | device/repository, type, content fingerprint, local SHA optional, state, bounded staged patch, observed timestamp, linked commit/activity; idempotency key unique |
| `Report` | workspace, requested scope JSON, immutable evidence cutoff, status, deterministic facts snapshot JSON, created by, timestamps |
| `ReportVersion` | report, version number, structured content JSON, editable LaTeX, PDF reference/status, template version, model metadata; unique report/version |
| `EvidenceLink` | report version, activity/commit/repository reference, claim key |

Migration rules:
- Database constraints enforce uniqueness and workspace ownership.
- Deleting an installation disables repositories; it does not silently erase historical reports.
- Explicit workspace deletion removes source content, CLI tokens, reports, and related data.
- CLI tokens are stored only as hashes.

## 8. Shared contracts — freeze these first

Both developers must approve `packages/contracts` before parallel feature work. Contract changes require a small pull request reviewed by the other developer.

### 8.1 CLI event envelope

```ts
{
  eventId: string;             // UUID generated once and retained across retries
  schemaVersion: 1;
  workspaceId: string;
  deviceId: string;
  repository: {
    remoteUrl: string;
    gitDirFingerprint: string;
    headSha?: string;
    branch?: string;
  };
  type: "STAGED_SNAPSHOT" | "LOCAL_COMMIT" | "PUSH_ATTEMPT";
  observedAt: string;
  payload: unknown;            // discriminated and bounded by type
}
```

Server responses acknowledge each event independently so the CLI can retry failures without duplicating accepted events.

### 8.2 Normalized GitHub activity

```ts
{
  source: "GITHUB";
  repositoryId: string;
  eventKind: "PUSH" | "PULL_REQUEST" | "MERGE";
  githubActorId?: number;
  senderId?: number;
  ref?: string;
  beforeSha?: string;
  afterSha?: string;
  commitShas: string[];
  occurredAt: string;
  deliveryId: string;
}
```

### 8.3 Report facts

Gemini never receives unrestricted database records. It receives validated facts shaped approximately as:

```ts
{
  reportWindow: { from: string; to: string; timezone: string };
  subjects: Array<{
    accountId: string;
    displayName: string;
    items: Array<{
      state: "STAGED" | "LOCAL_COMMIT" | "PUSHED" | "MERGED";
      repositoryId: string;
      evidenceIds: string[];
      deterministicFacts: string[];
      boundedCodeEvidence: string[];
    }>;
  }>;
}
```

Generated output must return claim keys plus evidence IDs; unknown references reject the model response.

### 8.4 Lifecycle attribution

- `STAGED` and unpushed `LOCAL_COMMIT`: grouped under the authenticated CLI identity.
- Remote `PUSHED` and `MERGED`: grouped under the authenticated GitHub actor.
- Commit authorship is shown as evidence, not automatically substituted for the actor.
- If a local commit later appears remotely, link it by repository and SHA. Do not create two code-change items.
- If the remote actor differs from the CLI identity, the remote-confirmed item is grouped under the remote actor and records the local observer/author as secondary evidence.
- Co-authors and bots are preserved and visibly labeled.

## 9. Module boundaries

| Module | Owns | Must not own |
|---|---|---|
| Auth/workspace | sessions, membership, ownership checks | GitHub installation tokens |
| GitHub installation | app callback, installation state, token creation | report prose |
| Webhook ingestion | signature, idempotency, normalization | UI rendering or model calls |
| Repository indexer | tree/blob retrieval, limits, incremental snapshots | activity attribution |
| CLI ingestion | device auth, schema validation, idempotency | trusting client-supplied workspace ownership |
| Lifecycle reconciler | link CLI/GitHub observations and states | changing raw evidence |
| Report facts | deterministic filtering/grouping/counts | LaTeX string composition |
| AI synthesis | structured explanation from bounded facts | database writes outside report version |
| LaTeX renderer | escaping and template insertion | interpreting engineering changes |
| Compiler service | compile supplied `.tex` under strict limits | access to app database/secrets |

## 10. Work phases and ownership

### Phase 0 — Alignment and contracts (Day 1, both)

**Together**
- Confirm scope/non-goals and presentation date.
- Create repository, branch protection, issue labels, and project board.
- Scaffold pnpm workspace and CI only after planning review.
- Define Zod contracts and shared fixtures.
- Register development GitHub App and Supabase project together.
- Agree on the initial LaTeX placeholder until the real theme arrives.

**Gate**
- Clean clone installs and runs checks.
- Both developers can run the web shell, tests, and fixture validation.
- Contract fixture tests pass.

### Phase 1 — Two vertical tracer bullets (Days 2–3)

**Murtaza**
- Auth/workspace/database vertical slice.
- GitHub installation callback using a fixture or real test installation.
- Persist one repository and display connection state.

**Ali**
- CLI command shell, queue, and fixture-backed `STAGED_SNAPSHOT` event.
- Report-page shell using shared report fixture.
- Minimal compiler-service health endpoint and sample `.tex` compilation.

**Gate**
- One real GitHub account can sign in and connect one test repository.
- CLI can queue and deliver one synthetic event to a mocked/server test endpoint.
- Sample LaTeX compiles to a valid PDF.

### Phase 2 — Collection and repository context (Days 4–7)

**Murtaza**
- Signed/idempotent webhooks.
- Push/PR normalization and commit enrichment.
- Initial and incremental repository text indexing.
- Installation/repository connection UI and manual reconciliation.

**Ali**
- CLI device pairing and token storage.
- Per-repository initialization, Git-index watcher, local-commit hooks, offline retry.
- CLI event ingestion UI/status integration using frozen contracts.
- Begin activity timeline components against fixtures.

**Daily integration checkpoint**
- Ali tests the CLI against Murtaza's staging API.
- Murtaza tests server handlers against Ali's recorded fixtures.

**Gate**
- A staged change appears in Trace.
- A local commit updates the same work lifecycle.
- A GitHub push is accepted exactly once even when replayed.
- Modified repository text is updated to the webhook's after SHA.

### Phase 3 — Activity understanding and reports (Days 8–10)

**Murtaza**
- Lifecycle reconciliation, actor/author rules, filters, deterministic report facts.
- Source-context retrieval and evidence validation.
- Connection/index health and error states.

**Ali**
- Activity dashboard and report-request flow.
- Gemini structured synthesis and deterministic fallback.
- LaTeX renderer, editor, compiler integration, versions, and downloads.

**Gate**
- One report includes staged, local, pushed, and merged examples without duplication.
- Every narrative item links to known evidence.
- Empty, AI-failure, and LaTeX-special-character cases succeed.

### Phase 4 — Integration and adversarial testing (Days 11–12)

**Pair work**
- Personal-account installation end to end.
- Real organization installation end to end using a disposable test organization.
- Offline CLI queue and replay.
- Webhook replay, out-of-order event, force-push, and mismatched actor/author tests.
- Large/binary repository bounds.
- Edited LaTeX version preservation and compiler timeout.

**Cross-review rule**
- Ali reviews GitHub/security paths.
- Murtaza reviews CLI/report/LaTeX paths.
- The author fixes findings; reviewers do not silently rewrite each other's feature.

### Phase 5 — Hardening, documentation, and demo (Days 13–15)

**Murtaza**
- Authorization audit, secret/config validation, database cleanup path, deployment/tunnel setup.
- GitHub connection troubleshooting and demo fixture/reset tools.

**Ali**
- UX polish, accessible errors/loading/empty states, CLI help, report/template polish.
- User-facing setup/testing/demo documentation.

**Both**
- Run the full acceptance script twice from a clean clone.
- Perform one fresh-database rehearsal.
- Freeze features after Day 13; only blockers and demo clarity change afterward.
- Record a backup demo video and preserve sanitized fixtures.

**Final gate**
- Definition of done and all P0 acceptance criteria pass on the exact final commit.

## 11. Collaboration workflow

### Branching

Use trunk-based development:

```text
main
├── feat/github-installation
├── feat/cli-staged-watcher
├── feat/report-renderer
└── fix/webhook-deduplication
```

Rules:
- Branch from current `main`.
- One concern per branch, normally less than one day.
- Open a draft PR early when changing a shared contract or migration.
- Rebase or merge `main` before final review; choose one method and use it consistently.
- Delete branches after merge.
- Never create permanent developer-specific branches.

### Commit style

Use small dependency-ordered messages:

```text
add CLI event schema
validate webhook signatures
store repository snapshots
render report evidence links
```

Commit after a coherent test passes. Avoid “work,” “changes,” and multi-feature commits.

### Pull request checklist

- [ ] Scope is one coherent change.
- [ ] Test failed first for behavior changes.
- [ ] Tests, lint, typecheck, and build pass.
- [ ] Schema/contracts/docs changed when required.
- [ ] No secrets, real private source, tokens, or personal email fixtures.
- [ ] Screenshots or CLI output show user-facing behavior.
- [ ] Reviewer can reproduce with exact commands.
- [ ] Shared contract or migration receives the other developer's approval.

### Avoiding blockers

- Build against checked-in fixtures before the other side's service is ready.
- Share Zod contracts, not copied TypeScript interfaces.
- Use dependency injection around GitHub, Gemini, filesystem, and compiler boundaries.
- Never modify the same migration after it is merged; add a new migration.
- The owner of a module approves changes to that module.
- If blocked for more than 30 minutes, write the blocker and switch to fixture-backed tests/documentation rather than waiting silently.

Webhook handlers must not perform repository-wide indexing, report generation, or model calls before acknowledging GitHub. Framework-managed post-response work may enrich a small event in the single-process MVP, but every such operation first records durable `PENDING` state so manual reconciliation can recover a stopped process.

## 12. Test strategy

Follow RED → GREEN → REFACTOR for behavior. Every phase ends with both automated checks and a human-readable acceptance test.

### 12.1 Unit tests

**GitHub/web**
- Signature accepts the correct secret and rejects missing/incorrect signatures.
- Delivery IDs are idempotent.
- Installation owner supports `User` and `Organization`.
- Actor, author, committer, bot, and co-author remain separate.
- File filters reject binaries, oversized files, lock files, traversal paths, and generated directories.
- Incremental indexing handles add/modify/rename/delete.
- LaTeX escaping covers `# $ % & _ { } ~ ^ \\` and Unicode.
- Unknown AI evidence IDs are rejected.

**CLI**
- Remote URL normalization maps SSH and HTTPS to the same repository.
- Index changes produce debounced staged snapshots.
- Identical staged state is not resent.
- Reset/unstage produces a `DISCARDED` or replacement state.
- Local commit captures SHA and links the preceding staged fingerprint.
- Existing user hooks are preserved/chained rather than overwritten.
- Queue retries retain event IDs and use bounded backoff.
- Revoked token fails safely without losing queued data.

### 12.2 Integration tests

- Authenticated user cannot access another workspace.
- Installation callback creates only repositories belonging to that installation.
- Replay the same signed webhook twice: one stored activity.
- Push after a CLI local commit links by repository/SHA.
- Pusher differs from author: grouping uses remote actor and preserves author evidence.
- Repository update transaction leaves index at either old or new SHA, never a mixed snapshot.
- Report facts honor timezone and inclusive/exclusive date boundaries.
- AI timeout produces deterministic fallback.
- Edited report version is not overwritten by regeneration.
- Compiler receives no application secrets and deletes temporary files.

### 12.3 Contract tests

- Every checked-in GitHub fixture parses through the shared schema.
- CLI and server agree on each event variant and maximum payload size.
- Report facts and model output schemas round-trip.
- Breaking schema changes require `schemaVersion` increment or backward-compatible parser.

### 12.4 End-to-end browser/CLI tests

Automate the stable local paths with Playwright and CLI subprocesses:

1. Sign in through test authentication and join workspace.
2. Connect fixture installation and show repositories.
3. In a temporary Git repository, stage a file and run CLI observation.
4. Commit locally; verify lifecycle update.
5. Replay signed push fixture; verify remote confirmation and no duplicate.
6. Request report; edit LaTeX; compile; download `.tex` and PDF.

Real GitHub installation and webhook behavior remains a documented manual acceptance test because external OAuth should not make CI flaky.

### 12.5 User-friendly manual acceptance script

A tester should be able to follow `docs/demo-script.md` without knowing the code:

1. Start Docker Compose and open Trace.
2. Sign in with a test GitHub account.
3. Create/join the Trace workspace.
4. Install Trace on one personal repository.
5. Install Trace on one repository owned by the disposable test organization.
6. Run `trace login`, `trace init`, and `trace start` in a test repository.
7. Modify and stage a text file while the watcher is running; confirm `STAGED` appears.
8. Commit locally; confirm `LOCAL_COMMIT` replaces/links the staged item.
9. Push; confirm GitHub changes state to `PUSHED` without duplicate code work.
10. Merge a PR; confirm `MERGED` evidence.
11. Request a report for the test window.
12. Confirm actor/author wording, evidence links, and state separation.
13. Edit one sentence in LaTeX, compile, and download both formats.
14. Disconnect a repository and verify new events are rejected/ignored safely.

## 13. Edge cases and required behavior

### GitHub
- Duplicate or out-of-order webhooks: idempotent upsert and retryable status.
- Force-push/rebase: retain observed evidence; mark commits no longer on the ref rather than deleting history.
- Empty push or deleted branch: record ref event without fabricating commits.
- Large/truncated API patch: summarize available stats and label code detail incomplete.
- Binary/generated/lock file: retain filename/statistics, omit source analysis.
- Installation suspended/deleted or repository deselected: disable access and show reconnection guidance.
- Organization approval pending: show `Pending owner approval`, not generic failure.
- Renamed/transferred repository: follow stable numeric repository ID and update display name.
- Rate limit or transient API failure: preserve delivery, show pending enrichment, and allow `Sync now` retry.

### CLI
- No Git repository or no remote: explain the fix; do not crash.
- Multiple remotes: ask the user to select the connected GitHub remote.
- Offline: queue locally and show count.
- Staged state changes repeatedly: debounce and replace snapshots by content fingerprint.
- Amend/rebase: link new SHA, retain superseded local observation, avoid remote duplication.
- Existing hooks: chain safely and support `trace remove` restoration.
- Multiple machines: device IDs distinguish observations; SHA/fingerprint reconciles shared work.
- Worktree/submodule: reject unsupported configuration with a clear message in MVP.
- Watcher stopped or machine restarted: `trace status` reports inactive collection and `trace start` resumes it; automatic startup is deferred.
- Potential secret in staged patch: redact/block upload and warn locally.

### Reports and LaTeX
- No activity: valid report explaining no selected evidence.
- Staged-only activity: clearly titled Work in Progress.
- Same SHA under multiple branches: one code-change record with branch observations.
- Model failure/invalid JSON/unknown evidence: deterministic report, never a blank page.
- Special characters/Unicode/long paths: escaped and line-wrapped.
- Compile timeout/missing package: retain `.tex`, show actionable error, allow download.
- User edit followed by regenerate: create a new version; never overwrite edited source.

## 14. Security checklist

- Verify GitHub webhook HMAC against raw request bytes before parsing.
- Never expose GitHub App private key, installation token, Auth secret, database URL, Gemini key, or CLI bearer token to the browser.
- Installation tokens are short-lived and created server-side when needed.
- Derive workspace/account ownership from authenticated session and database relations, never request-supplied IDs alone.
- Encrypt transport; hash CLI tokens; allow device revocation.
- Limit request body, patch, file, repository, model-context, and compile sizes.
- Treat repository text, commit messages, PR descriptions, and LaTeX edits as untrusted input.
- Do not let source text instruct the model; isolate evidence and require structured output.
- Compiler service has no app secrets/database access, no shell escape, no network during compilation, bounded resources, and ephemeral files.
- Report/artifact reads re-check workspace authorization; object-storage links, if introduced, are short-lived.
- The report form discloses private-source excerpt processing by Gemini and offers deterministic generation when the user declines or Gemini is unavailable.
- Provide source/report deletion for disconnected workspaces before final acceptance.
- Use sanitized synthetic repositories and fixtures in tests/demo.

## 15. Environment variables

Document names in `.env.example`; never include values:

```text
DATABASE_URL
DIRECT_URL
AUTH_SECRET
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
GITHUB_APP_ID
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
GEMINI_API_KEY
TRACE_PUBLIC_URL
TRACE_CLI_TOKEN_PEPPER
LATEX_SERVICE_URL
LATEX_SERVICE_SHARED_SECRET
```

Validate required server variables at runtime with clear startup errors. The client bundle may receive only explicitly public values.

## 16. CI and quality gates

Every PR runs:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CLI-focused PRs additionally run black-box CLI tests in temporary repositories. Compiler changes build the compiler image and compile a fixed sample; assert successful compilation, nonzero page count, and expected extracted text rather than comparing unstable PDF bytes. Migration changes validate against a disposable PostgreSQL database.

`main` may merge only when checks pass and the other developer approves shared contracts, migrations, auth, webhook, compiler, or report-grounding changes.

## 17. Schedule compression rules

If fewer than 15 working days are available, cut in this order:

1. Repository-topic visualization polish; retain path/module context in reports.
2. Rich topic inference; retain folder/path context.
3. macOS best-effort support; retain Linux CLI.
4. PR review/open-event reporting; retain push and merged PR context.
5. In-browser PDF preview; retain `.tex` editing and PDF generation/download.
6. Historical backfill beyond seven days; retain post-installation collection.

Do **not** cut:
- webhook signature verification/idempotency;
- workspace authorization;
- CLI opt-in and state labels;
- actor/author separation;
- evidence validation;
- LaTeX escaping/compilation isolation;
- one real end-to-end demonstration.

## 18. Definition of done

### Product
- [ ] Personal installation works and a disposable test organization completes a real owner-approved installation.
- [ ] Selected repositories index bounded text content and update incrementally.
- [ ] CLI pairs, initializes a repository, observes staged/local activity, queues offline, and reconciles a pushed SHA.
- [ ] Shared company account activity remains attributed to that account.
- [ ] On-demand report filters work and no scheduled report exists.
- [ ] Report facts are deterministic and model claims are evidence-validated.
- [ ] User can edit LaTeX, preserve versions, compile, and download `.tex` and PDF.

### Quality
- [ ] Format, lint, typecheck, tests, and production builds pass from a clean clone.
- [ ] High-risk security and edge-case tests pass.
- [ ] No credentials or private repository content are committed.
- [ ] Fresh database migration and setup documentation are verified.
- [ ] Manual acceptance script passes twice on the exact final commit.

### Presentation
- [ ] Demo account/repositories contain safe, understandable changes.
- [ ] GitHub callback/webhook URL is stable for the presentation.
- [ ] Provided LaTeX theme is visible in the final report.
- [ ] Backup fixtures and a short video exist if external GitHub/Gemini services fail.
- [ ] Both developers can explain architecture, attribution, privacy, and limitations.

## 19. Immediate next step after approval

Do not start features immediately. First create the agreed empty repository tree and zero-byte placeholders, let the team connect and commit Git, then implement Phase 0 contracts and CI. This preserves a clean baseline and minimizes first-day merge conflict.
