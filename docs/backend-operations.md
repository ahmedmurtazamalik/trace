# Backend operations

This runbook covers the production-like Trace API, worker, migration runner, PostgreSQL, Redis, report storage, and isolated LaTeX compiler. It does not deploy the Next.js frontend.

The backend Compose definition is `infrastructure/compose/backend.production.yml`. Supply secrets through an operator-controlled environment file or secret manager; never commit that file.

## Environment contract

Required backend values:

| Variable | Consumer | Requirement |
| --- | --- | --- |
| `DATABASE_URL` | migration, API, worker | PostgreSQL URL using the Compose hostname `postgres` when using this topology |
| `REDIS_URL` | API, worker | Redis URL using the Compose hostname `redis` |
| `SESSION_SECRET` | API | At least 32 random, non-placeholder characters |
| `FRONTEND_ORIGIN` | API | Public HTTPS frontend origin |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG` | API/worker | GitHub App identity |
| `GITHUB_APP_PRIVATE_KEY` | API/worker | PEM with literal newlines or escaped `\\n`; store only in a secret manager |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | API | OAuth credentials for account and installation verification |
| `GITHUB_CALLBACK_URL` | API | Public HTTPS OAuth callback URL |
| `GITHUB_INSTALLATION_CALLBACK_URL` | API | Public HTTPS installation callback URL |
| `GITHUB_WEBHOOK_SECRET` | API | At least 32 random, non-placeholder characters |
| `REPORT_CODEX_MODEL`, `TRACE_CODEX_HOME` | worker | Explicit Codex model and dedicated authenticated CLI home |
| `REPORT_LATEX_IMAGE` | worker | Immutable registry digest (`name@sha256:…`) or local full image ID (`sha256:…`) |
| `REPORT_LATEX_WORK_ROOT` | worker/host | Absolute host directory bind-mounted at the identical path in the worker |
| `DOCKER_SOCKET`, `DOCKER_GID` | worker/host | Host socket path and its numeric owning group; the socket is mounted at `/var/run/docker.sock` in the worker |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | worker | One absolute application shutdown budget shared by both queues and resource cleanup; production default `210000` |
| `TRACE_API_IMAGE`, `TRACE_MIGRATION_IMAGE`, `TRACE_WORKER_IMAGE` | Compose | Full local `sha256:…` IDs or registry `name@sha256:…` digests; no tags |
| `POSTGRES_PASSWORD` | PostgreSQL | Random database password matching `DATABASE_URL` |

Optional controls include `LOG_LEVEL`, `REPORT_WORKER_CONCURRENCY`, `REPORT_LATEX_TIMEOUT_MS`, and `TRACE_API_PORT`.

Use restrictive file permissions (`0600`) for environment files. Rotate the session secret, GitHub OAuth secret, webhook secret, App private key, dedicated Codex CLI authentication, and database password through the deployment platform. A rotation that changes connectivity requires a controlled restart.

## Build and deploy

Validate interpolation without exposing resolved output:

```bash
docker compose --env-file /secure/trace-backend.env \
  -f infrastructure/compose/backend.production.yml config --quiet
```

Build candidate images from the pinned Dockerfile frontend and Node base, publish them, and set the three release variables to registry digests. PostgreSQL and Redis are also digest-pinned in Compose. Validate release references before interpolation; mutable tags are rejected by policy and the validator.

```bash
node infrastructure/scripts/validate-image-references.mjs \
  "$TRACE_API_IMAGE" "$TRACE_MIGRATION_IMAGE" "$TRACE_WORKER_IMAGE"

docker compose --env-file /secure/trace-backend.env \
  -f infrastructure/compose/backend.production.yml up -d --no-build
```

The migration service must exit successfully before API or worker startup. It runs non-root with a read-only filesystem, dropped capabilities, no-new-privileges, a bounded stop period, and only a temporary `/tmp`. PostgreSQL and Redis must be healthy. Do not bypass these dependency conditions. PostgreSQL, Redis, and the migration runner remain on the internal `data` network; API and worker also join `egress` so external GitHub and report-provider calls work without exposing data-service ports. Record the rendered Compose image references and resolved container image IDs with the release evidence.

## Migration and rollback

`migrate` runs Prisma's deploy-safe migration command once. It never runs development migration generation and never seeds production.

Before migration:

1. Take and verify a database backup.
2. Record the exact application, migration, and compiler image digests.
3. Confirm the release migration is compatible with the currently running application during the rollout window.
4. Run the migration service and retain its logs.

Trace migrations are forward-only; there is no automatic destructive down-migration command. For application defects, redeploy the prior application images only when the schema remains backward-compatible. For an incompatible or destructive migration, stop writers, restore the verified pre-deploy backup into a replacement database, point the backend at it, and then redeploy the prior images. Never improvise reverse SQL against production.

## Health and readiness

- `GET /health` is liveness and proves the API process can answer HTTP.
- `GET /ready` is readiness and returns success only when PostgreSQL and Redis probes both pass.
- Compose marks API healthy only after both endpoints succeed.
- The migration container's successful exit is a separate release gate.
- Worker startup fails closed when PostgreSQL, Redis, GitHub App, report-provider, storage, or compiler configuration is invalid.

A liveness success is not evidence that dependencies or workers are ready. Monitor migration exit status, API health, API readiness, worker running state, queue age/depth, and terminal job failures separately.

## Graceful shutdown and queue draining

API and worker images use an init process and receive `SIGTERM` during a controlled stop. The API has 30 seconds to run Nest shutdown hooks and close PostgreSQL/Redis resources. On worker shutdown, both BullMQ consumers begin closing concurrently under one absolute 210-second application deadline. Queue drain reserves the final 10% (capped at 10 seconds) for forced queue/socket cleanup, and database/resource cleanup receives only the time remaining on that same deadline. Compose grants 240 seconds so Docker cannot escalate before the bounded application shutdown completes.

```bash
docker compose --env-file /secure/trace-backend.env \
  -f infrastructure/compose/backend.production.yml stop -t 240 worker api
```

Do not use `docker kill -s KILL` for normal deployment. The worker should exit `0`. Nest may re-emit the handled `SIGTERM`, so the API container can report `143` after completing shutdown hooks; `137` or a grace-period timeout is a failure. If the worker exits non-zero or exceeds its grace period, inspect queue state before replacement; durable database rows remain authoritative and publishers reconcile unpublished work after restart.

## Correlation and logs

API responses carry `X-Request-Id`; error envelopes and security-sensitive audit records retain the request ID. The API emits one JSON object per log line, applies `LOG_LEVEL`, and records sanitized completed or aborted request events with correlation ID, method, query-free path, status, and duration. Accept only generated or syntax-validated inbound IDs. Collect container stdout in the deployment platform and correlate failures with the response request ID, durable delivery/report ID, and sanitized operation code. Never log session cookies, CSRF values, OAuth codes/states, installation tokens, App private keys, webhook signatures, raw provider prompts/responses, or report contents.

## Report storage

Compose mounts the same `trace_report_artifacts` volume at `/var/lib/trace/reports` in API and worker. The worker writes generated artifacts and the API reads authorized downloads. This volume is durable state: include it in backup, restore, retention, capacity, and access-control procedures. A database-only restore can leave report rows pointing to missing artifacts; restore database and report storage to a consistent recovery point.

## LLM provider

Production report generation invokes the pinned Codex CLI from the worker with `REPORT_LLM_PROVIDER=codex`. Set `REPORT_CODEX_MODEL` explicitly and mount a dedicated authenticated CLI home through `TRACE_CODEX_HOME`; do not mount a developer's general-purpose home directory. The worker runs `codex exec` ephemerally in a fresh temporary directory, ignores repository/user instructions, uses a read-only sandbox, constrains output with a strict JSON schema, bounds prompt/response sizes, and makes at most one schema-repair attempt. Stable database identifiers and commit SHAs are request-locally aliased before inference and restored only after grounded validation.

Codex CLI authentication is an operational credential. Restrict filesystem permissions and account scope, rotate or revoke it through the approved Codex account workflow, and use only organization-approved automation credentials for a multi-user deployment. A personal subscription is suitable for local/internal development, not as a public shared inference backend. Codex unavailability, authentication failure, timeout, or invalid output must fail the report job safely rather than fabricate content. Keep the deterministic provider limited to local development and tests.

## LaTeX compiler

Build `infrastructure/latex/Dockerfile` and deploy by immutable digest. The worker starts compiler containers with no network, read-only root, dropped capabilities, bounded CPU/memory/PIDs, unprivileged UID/GID, and temporary filesystems.

The worker needs Docker access. Mounting `/var/run/docker.sock` grants control equivalent to the Docker daemon and therefore effectively host-root authority despite the non-root process. Restrict deployment access and run the worker on an isolated host where possible.

`REPORT_LATEX_WORK_ROOT` solves the sibling-container bind-mount boundary. Create an absolute host directory owned by worker UID `1000`, mount it into the worker at the identical path, and do not place unrelated files there. The worker creates per-job directories and removes them after compilation.

## Backup and restore

Back up both PostgreSQL and the report-artifact volume. Regularly test restoration into an isolated environment.

A minimum recovery drill is:

1. Quiesce API/worker writers or capture an application-consistent recovery point.
2. Export PostgreSQL with a version-compatible tool and snapshot the artifact volume.
3. Restore into new database and storage targets—never over the only copy.
4. Run the migration container against the restored database.
5. Start backend images at their recorded digests.
6. Verify `/health`, `/ready`, authenticated report metadata, and a representative authorized download.
7. Record recovery time and any orphaned database/artifact records.

Redis is operational queue/cache state, not the authority for accepted webhook deliveries or report records; recovery relies on durable PostgreSQL state and reconciliation publishers.

## GitHub App operations

Follow `docs/github-app-setup.md`. Rotate the App private key, OAuth client secret, and webhook secret independently. During webhook-secret rotation, coordinate GitHub and API rollout so signatures are never accepted with an unknown key. Validate OAuth, installation, and webhook callbacks from the public URL after each configuration change.

## Smoke test

Run the destructive, isolated local smoke harness only on Linux with Docker Engine, a Unix socket (default `/var/run/docker.sock`), GNU `stat`, OpenSSL, Python 3, curl, grep, Node.js, and pnpm. Rootless/custom sockets can be supplied with `TRACE_DOCKER_SOCKET`; Docker Desktop and non-GNU hosts are not currently supported by this harness. The script checks every prerequisite before building:

```bash
pnpm smoke:backend
```

It uses a unique Compose project and temporary secrets, builds all backend images plus the LaTeX sandbox, resolves and validates immutable local image IDs, migrates a fresh database, checks `/health` and `/ready`, verifies API/worker UID `1000`, compiles a real PDF from inside the worker, drains active webhook and report jobs against Redis, sends bounded `SIGTERM` stops, requires worker exit `0` and API exit `0` or handled-signal `143`, rejects forced exit `137`, and removes containers, volumes, images, and temporary files. Set `TRACE_CODEX_ACCEPTANCE_HOME` to a dedicated authenticated Codex home to add a credential/readability preflight without copying authentication material.
