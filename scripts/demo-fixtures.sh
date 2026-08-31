#!/usr/bin/env bash
set -euo pipefail
SCENARIO="${1:-healthy}"
export DATABASE_URL="${DATABASE_URL:-postgres://grounds:grounds@127.0.0.1:5432/grounds}"
export GROUNDS_IDENTITY_MODE=development
export GROUNDS_DEV_ACTOR_ID=dev-actor
export GROUNDS_DEV_ORGANISATION_ID=org_grounds_dev
export GROUNDS_PROVIDER=fixture
export GROUNDS_FIXTURE_SCENARIO="$SCENARIO"
export GROUNDS_API_BASE_URL=http://127.0.0.1:3000
echo "Starting fixture demonstration scenario=${SCENARIO}"
echo "API http://127.0.0.1:3000  UI http://127.0.0.1:3001"
echo "This script expects compose Postgres and built workspace packages."
