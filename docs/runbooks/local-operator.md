# Local operator runbook

Scope: Builds 0 and 1. Fixture demonstration is the verified path. Optional live AWS smoke is out of CI and is not required to merge.

## Prerequisites

- Node.js 24
- pnpm 10.33.3
- Docker (Testcontainers) or a disposable Postgres URL in `GROUNDS_TEST_DATABASE_URL`

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs format, typecheck, lint, unit, PostgreSQL integration, adapter contract, end-to-end fixture runs, SBOM, secret scan, licence scan, high-severity dependency audit and build. It never calls live AWS.

Next.js still ships `postcss` 8.4.31 and `sharp` 0.34.x. Root `pnpm.overrides` pin those to `postcss@8.5.26` and `sharp@0.35.4` so `pnpm scan:deps` fails closed on high-severity advisories rather than waiting for a Next patch. The SBOM digest is derived from the lockfile only, so it is stable across runs.

## Local stack

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://grounds:grounds@127.0.0.1:5432/grounds
export GROUNDS_IDENTITY_MODE=development
export GROUNDS_DEV_ACTOR_ID=dev-actor
export GROUNDS_DEV_ORGANISATION_ID=org_grounds_dev
export GROUNDS_PROVIDER=fixture
export GROUNDS_FIXTURE_SCENARIO=healthy
pnpm --filter @grounds/persistence-postgres exec node -e "import { createPool, migrateUp } from './dist/index.js'; const p=createPool(process.env.DATABASE_URL); await migrateUp(p); await p.end();"
```

Use the demo script instead of assembling that by hand. It migrates, seeds the immutable `ecs-payments` profile if missing, then starts the API, worker and Mission Control on loopback:

```bash
pnpm build
./scripts/demo-fixtures.sh healthy
```

Then open Mission Control on loopback: `http://127.0.0.1:3001`.

Scenarios: `healthy`, `unhealthy-replacement`, `missing-alarm`, `partial-failure`, `stale-metrics`.

## Identity

The API ignores client actor headers. The server actor and organisation come from `GROUNDS_DEV_ACTOR_ID` and `GROUNDS_DEV_ORGANISATION_ID`. A non-development identity mode refuses to listen.

## Optional live AWS smoke

Not in CI. Set these on the **worker only**:

- `GROUNDS_PROVIDER=aws`
- `GROUNDS_AWS_ROLE_ARN`
- `GROUNDS_AWS_EXTERNAL_ID`
- `GROUNDS_AWS_REGION`
- `GROUNDS_ALLOWED_ACCOUNT_ID`
- `GROUNDS_ALLOWED_RESOURCE_ID` (`clusterName/serviceName`)

The API and browser never receive AWS credentials. Session duration is 900 seconds. The worker refreshes the session before expiry. Do not attach `ReadOnlyAccess`. Do not point this at production. Unapproved services make zero provider calls, including AssumeRole. Live `RunningTaskCount` is read from `ECS/ContainerInsights`.

## What this build will not do

No AWS mutation, Terraform, merge, deploy, MCP, model provider, scheduling or public deployment.
