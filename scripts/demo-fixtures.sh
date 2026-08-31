#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SCENARIO="${1:-healthy}"
export DATABASE_URL="${DATABASE_URL:-postgres://grounds:grounds@127.0.0.1:5432/grounds}"
export GROUNDS_IDENTITY_MODE=development
export GROUNDS_DEV_ACTOR_ID=dev-actor
export GROUNDS_DEV_ORGANISATION_ID=org_grounds_dev
export GROUNDS_PROVIDER=fixture
export GROUNDS_FIXTURE_SCENARIO="$SCENARIO"
export GROUNDS_API_BASE_URL=http://127.0.0.1:3000
export GROUNDS_LISTEN_HOST=127.0.0.1
export GROUNDS_LISTEN_PORT=3000

if [[ ! -f apps/api/dist/main.js || ! -f apps/worker/dist/main.js ]]; then
  echo "Build the workspace first: pnpm build" >&2
  exit 1
fi

node scripts/seed-dev.mjs

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "${WORKER_PID:-}" ]]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

echo "Starting fixture demonstration scenario=${SCENARIO}"
echo "API http://127.0.0.1:3000  UI http://127.0.0.1:3001"
pnpm --filter @grounds/api start &
API_PID=$!
pnpm --filter @grounds/worker start &
WORKER_PID=$!
pnpm --filter @grounds/web start &
WEB_PID=$!
wait
