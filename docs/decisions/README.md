# Architecture decisions

Accepted decisions for the authorised build. These close gaps in [Grounds-Build-Ready-Plan.md](../../Grounds-Build-Ready-Plan.md). They do not add product scope.

| ID                                     | Title                                               | Status   |
| -------------------------------------- | --------------------------------------------------- | -------- |
| [0001](0001-evidence.md)               | Evidence identity, freshness and UNKNOWN            | Accepted |
| [0002](0002-orchestration.md)          | Run and step orchestration, fencing and idempotency | Accepted |
| [0003](0003-security.md)               | Identity, grants and credential boundaries          | Accepted |
| [0004](0004-provider-boundary.md)      | Provider ports and AWS command allowlist            | Accepted |
| [0005](0005-detector-truth-tables.md)  | GRD-ECS-001 and GRD-OBS-001 truth tables            | Accepted |
| [0006](0006-build-0-implementation.md) | Build 0 implementation amendments                   | Accepted |
| [0007](0007-build-1-implementation.md) | Build 1 implementation amendments                   | Accepted |

Related:

- [Build 0 data model](../architecture/build-0-data-model.md)
- [State machines](../architecture/state-machines.md)
- [Threat model](../threat-model.md)
