#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILE="$ROOT/infrastructure/compose/backend.production.yml"
TOKEN="${TRACE_SMOKE_TOKEN:-day13-$PPID-$$}"
PROJECT="trace-${TOKEN//[^a-zA-Z0-9_-]/-}"
TEMP_ROOT=$(mktemp -d "/tmp/trace-backend-smoke-${TOKEN}.XXXXXX")
ENV_FILE="$TEMP_ROOT/smoke.env"
PRIVATE_KEY_FILE="$TEMP_ROOT/github-app.pem"
LATEX_WORK_ROOT="$TEMP_ROOT/latex-work"
API_IMAGE="trace-api-smoke:$TOKEN"
MIGRATION_IMAGE="trace-migrate-smoke:$TOKEN"
WORKER_IMAGE="trace-worker-smoke:$TOKEN"
LATEX_IMAGE="trace-latex-smoke:$TOKEN"
COMPOSE=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")

cleanup() {
  local status=$?
  set +e
  if [ "$status" -ne 0 ]; then
    printf '%s\n' '--- backend smoke failure status ---' >&2
    "${COMPOSE[@]}" ps --all >&2
    printf '%s\n' '--- backend smoke failure logs ---' >&2
    "${COMPOSE[@]}" logs --no-color --tail 200 migrate api worker postgres redis >&2
  fi
  "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm --force "$API_IMAGE" "$MIGRATION_IMAGE" "$WORKER_IMAGE" "$LATEX_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for command in docker openssl python3 curl grep node stat; do
  command -v "$command" >/dev/null || { printf 'missing smoke prerequisite: %s\n' "$command" >&2; exit 1; }
done
docker info >/dev/null
docker compose version >/dev/null
DOCKER_SOCKET=${TRACE_DOCKER_SOCKET:-/var/run/docker.sock}
test -S "$DOCKER_SOCKET" || { printf 'Docker socket is not available: %s\n' "$DOCKER_SOCKET" >&2; exit 1; }
stat -c '%g' "$DOCKER_SOCKET" >/dev/null
mkdir -m 700 "$LATEX_WORK_ROOT"
openssl genpkey -quiet -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$PRIVATE_KEY_FILE"
PRIVATE_KEY_ESCAPED=''
while IFS= read -r line; do PRIVATE_KEY_ESCAPED+="${line}\\n"; done < "$PRIVATE_KEY_FILE"

POSTGRES_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)
CLIENT_SECRET=$(openssl rand -hex 24)
LLM_KEY=$(openssl rand -hex 24)
DOCKER_GID=$(stat -c '%g' "$DOCKER_SOCKET")
API_PORT=$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)

docker build --file "$ROOT/apps/api/Dockerfile" --target runtime --tag "$API_IMAGE" "$ROOT"
docker build --file "$ROOT/apps/api/Dockerfile" --target migration --tag "$MIGRATION_IMAGE" "$ROOT"
docker build --file "$ROOT/apps/worker/Dockerfile" --target runtime --tag "$WORKER_IMAGE" "$ROOT"
docker build --tag "$LATEX_IMAGE" "$ROOT/infrastructure/latex"
API_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$API_IMAGE")
MIGRATION_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$MIGRATION_IMAGE")
WORKER_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$WORKER_IMAGE")
LATEX_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$LATEX_IMAGE")
node "$ROOT/infrastructure/scripts/validate-image-references.mjs" \
  "$API_IMAGE_ID" "$MIGRATION_IMAGE_ID" "$WORKER_IMAGE_ID"

umask 077
{
  printf 'POSTGRES_DB=trace\n'
  printf 'POSTGRES_USER=trace\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'DATABASE_URL=postgresql://trace:%s@postgres:5432/trace?schema=public\n' "$POSTGRES_PASSWORD"
  printf 'REDIS_URL=redis://redis:6379\n'
  printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'FRONTEND_ORIGIN=https://trace.example.test\n'
  printf 'GITHUB_APP_ID=1\n'
  printf 'GITHUB_APP_SLUG=trace-smoke\n'
  printf 'GITHUB_APP_PRIVATE_KEY=%s\n' "$PRIVATE_KEY_ESCAPED"
  printf 'GITHUB_APP_CLIENT_ID=Iv1.smoke\n'
  printf 'GITHUB_APP_CLIENT_SECRET=%s\n' "$CLIENT_SECRET"
  printf 'GITHUB_CALLBACK_URL=https://api.trace.example.test/api/v1/github/callback\n'
  printf 'GITHUB_INSTALLATION_CALLBACK_URL=https://api.trace.example.test/api/v1/github/installation/callback\n'
  printf 'GITHUB_WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET"
  printf 'REPORT_LLM_MODEL=smoke-model\n'
  printf 'LLM_API_KEY=%s\n' "$LLM_KEY"
  printf 'REPORT_LATEX_IMAGE=%s\n' "$LATEX_IMAGE_ID"
  printf 'REPORT_LATEX_WORK_ROOT=%s\n' "$LATEX_WORK_ROOT"
  printf 'DOCKER_GID=%s\n' "$DOCKER_GID"
  printf 'DOCKER_SOCKET=%s\n' "$DOCKER_SOCKET"
  printf 'WORKER_SHUTDOWN_TIMEOUT_MS=210000\n'
  printf 'TRACE_API_PORT=%s\n' "$API_PORT"
  printf 'TRACE_API_IMAGE=%s\n' "$API_IMAGE_ID"
  printf 'TRACE_MIGRATION_IMAGE=%s\n' "$MIGRATION_IMAGE_ID"
  printf 'TRACE_WORKER_IMAGE=%s\n' "$WORKER_IMAGE_ID"
} > "$ENV_FILE"

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up --detach --no-build

for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$API_PORT/health" >/dev/null \
    && curl --fail --silent "http://127.0.0.1:$API_PORT/ready" >/dev/null; then
    break
  fi
  sleep 2
done
curl --fail --silent "http://127.0.0.1:$API_PORT/health" | grep -q '"status":"ok"'
curl --fail --silent "http://127.0.0.1:$API_PORT/ready" | grep -q '"status":"ready"'

test "$("${COMPOSE[@]}" ps --all --format json migrate | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const rows=s.trim().split(/\\n/).filter(Boolean).map(JSON.parse);process.stdout.write(String(rows[0]?.ExitCode ?? ''))})")" = 0
test "$("${COMPOSE[@]}" exec --no-TTY api id -u)" = 1000
test "$("${COMPOSE[@]}" exec --no-TTY worker id -u)" = 1000
"${COMPOSE[@]}" exec --no-TTY worker docker version --format '{{.Client.Version}}' >/dev/null
"${COMPOSE[@]}" exec --no-TTY worker node - <<'NODE'
const { DockerLatexCompiler } = require('./dist/src/latex/latex-compiler.js');
const source = '\\documentclass{article}\\begin{document}Trace Day 13 smoke\\end{document}';
new DockerLatexCompiler({
  image: process.env.REPORT_LATEX_IMAGE,
  workingRoot: process.env.REPORT_LATEX_WORK_ROOT,
  timeoutMs: 60_000,
}).compile(source).then((pdf) => {
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) process.exit(1);
  process.stdout.write(`compiled_pdf_bytes=${pdf.length}\n`);
}).catch(() => process.exit(1));
NODE

"${COMPOSE[@]}" exec --no-TTY worker node operations/verify-worker-drain.mjs \
  | grep -q '"event":"worker.active-drain.verified"'

API_CONTAINER=$("${COMPOSE[@]}" ps --quiet api)
WORKER_CONTAINER=$("${COMPOSE[@]}" ps --quiet worker)
# Docker stop sends SIGTERM, waits for the drain window, and escalates to
# SIGKILL only if a service exceeds that window.
"${COMPOSE[@]}" stop --timeout 240 api worker
test "$(docker inspect --format '{{.State.Running}}' "$API_CONTAINER")" = false
test "$(docker inspect --format '{{.State.Running}}' "$WORKER_CONTAINER")" = false
test "$(docker inspect --format '{{.State.ExitCode}}' "$WORKER_CONTAINER")" = 0
API_EXIT=$(docker inspect --format '{{.State.ExitCode}}' "$API_CONTAINER")
case "$API_EXIT" in
  0|143) ;;
  *) printf 'unexpected API shutdown exit code: %s\n' "$API_EXIT" >&2; exit 1 ;;
esac

printf 'BACKEND_SMOKE_PASS project=%s api_port=%s latex_image=%s\n' "$PROJECT" "$API_PORT" "$LATEX_IMAGE_ID"
