# ADR-0004: Provider ports and AWS command allowlist

Status: Accepted
Date: 2026-08-31
Milestone: Build 0 (fakes and deferred ports), Build 1 (AWS adapter)

## Context

The plan listed eleven ports and a denylist of mutator command name families. A denylist does not enforce the no-mutator boundary: `EnableAlarmActionsCommand` and `DisableAlarmActionsCommand` match none of create, put, update, delete, register, deregister, run, start, stop, terminate, modify, set or tag. The architecture gate also treated unused TypeScript ports and a fake outbox reconciler as speculative. `AssumeRoleCommand` is required for the worker and is not a collector.

## Decision

### Ports in the authorised build

Implemented:

- `ResourceInventoryPort`
- `TelemetryPort`
- `EvidenceStore` (PostgreSQL)
- `IdentityProvider` (development only)
- `ExternalActionOutbox` as a table and lag metric only

Not implemented as TypeScript interfaces or fakes in Builds 0 or 1:

- `ChangeHistoryPort`
- `RepositoryMappingPort`
- `InvestigationSpecialistPort`
- `ScmPort`
- `IsolationPort`
- `CheckRunner`

Those names stay in this ADR and the plan as deferred. Vincula, MCP, model providers and AWS DevOps Agent are out of scope.

Build 0 provides in-process fakes of `ResourceInventoryPort` and `TelemetryPort` in `packages/test-support`. The default test path has no AWS SDK dependency. `GROUNDS_PROVIDER=fixture` is the CI default. Real read-only AWS is an optional smoke test behind explicit environment, not the verify gate.

### Package direction

- `packages/domain` depends on neither Fastify, `pg` nor AWS SDK.
- `packages/application` depends on `domain` only.
- `apps/api` must not depend on `adapter-aws`.
- `apps/web` talks HTTP to the API only.
- Only `apps/worker` may depend on `adapter-aws` and load AWS credentials.
- `packages/detectors-ecs` imports domain types, never AWS SDK types. SDK types do not cross the adapter boundary.

### AWS command allowlist

`packages/adapter-aws` may statically import only:

| Client | Command | Purpose |
| --- | --- | --- |
| ECS | `DescribeServicesCommand` | Service inventory |
| ECS | `ListTasksCommand` | Task ids |
| ECS | `DescribeTasksCommand` | Task replacement evidence |
| Elastic Load Balancing v2 | `DescribeTargetGroupsCommand` | Health-check path and matcher |
| Elastic Load Balancing v2 | `DescribeTargetHealthCommand` | Unhealthy target evidence |
| CloudWatch | `DescribeAlarmsCommand` | Alarm inventory |
| CloudWatch | `GetMetricDataCommand` | Running task deficit |
| STS | `GetCallerIdentityCommand` | Account proof |
| STS | `AssumeRoleCommand` | Worker credential bootstrap only |

`AssumeRoleCommand` is not a collector. It is used only in the worker credential provider, with a required external ID and a 900 second session.

Forbidden in `adapter-aws`:

- any other `*Command` identifier
- wildcard imports (`import * as ...Command`)
- `export *` from `@aws-sdk/*`
- dynamic `import()` of `@aws-sdk/*`

A response containing an out-of-scope resource is rejected as a whole, not filtered silently. Scope is checked before the first provider call.

IAM in the target account is a dedicated role. Do not attach AWS managed `ReadOnlyAccess`.

## Consequences

- Architecture tests parse `packages/adapter-aws` and fail the build if the allowlist is violated.
- The published plan's denylist test is replaced by this allowlist test. The invariant (no mutator capability in the binary) is unchanged.
- No outbox reconciler process exists to accidentally emit external writes.

## Tests required

- Exact static allowlist over `packages/adapter-aws`.
- Cross-account, region and resource fixtures are rejected with zero silent filtering.
- Unapproved service: provider call count remains zero.
- Fixture provider is the default path in `pnpm verify`.
