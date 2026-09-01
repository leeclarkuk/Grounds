# ADR-0008: Codex review defect amendments

Status: Accepted
Date: 2026-09-01
Milestone: Build 1 (defect slice on the stacked assurance PR)

## Context

Codex reviewed PRs #3 and #4 after independent review. Several comments were real invariant breaks. The architecture-reasoning specialist (GPT-5.6 Sol) could not start because usage was exhausted. These amendments apply already-locked invariants. They do not add product scope. They are not a substitute architecture-gate PASS.

## Decision

### 1. Redact credentials anywhere in a string

`redactString` matches `AKIA`/`ASIA` access-key ids and presigned-URL parameters (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-SignedHeaders`) anywhere in the value, not only at position zero. Surrounding diagnostic text must not bypass redaction.

### 2. Unusable deficit metrics cannot prove PASS

ADR-0005 required kinds remain service, tasks, target group and target health. FAIL clause 3 is still `replacements OR snapshot deficit OR metric deficit`.

When targets are unhealthy and replacement count and snapshot deficit are both below threshold, missing, stale, truncated, incomplete or empty `RunningTaskCount` evidence makes GRD-ECS-001 `UNKNOWN`. It must not `PASS`. Stale metrics still must not cause `FAIL`. Healthy targets may still `PASS` without usable metrics because clause 2 is false. Stale metrics are not cited on `PASS`.

### 3. DescribeTasks completeness

`normaliseTasks` is complete only when every requested ARN is present in the described task list and `failures` is empty. The collector batches `DescribeTasks` at 100 ARNs, merges tasks and failures, and heartbeats after each batch.

### 4. RunningTaskCount lives in Container Insights

AWS emits `RunningTaskCount` in `ECS/ContainerInsights`, not `AWS/ECS`. Live `GetMetricData` queries `ECS/ContainerInsights`. GRD-OBS-001 covering task-count alarms must match that namespace with exact `ClusterName` and `ServiceName`. `AWS/ECS` remains valid for CPU and memory, not for task-count coverage. This amends ADR-0005 and ADR-0007 on that metric only.

### 5. TargetGroup dimension matching

ApplicationELB stores `TargetGroup` as the ARN resource suffix `targetgroup/name/id`. GRD-OBS-001 matches that suffix or the full ARN. Empty or unrelated values are not a match. Fixture full-ARN dimensions remain valid.

### 6. Short-lived session refresh

AssumeRole sessions remain 900 seconds with a required external ID. The worker caches operations until 60 seconds before expiry, then assumes again. A transient bootstrap failure yields inaccessible observations for that collect and does not poison later collects.

## Rejected from the Codex comments

- Concurrent enqueue after a consumed grant: `EnqueueRun` already replays on `GrantNotConsumableError` and `UniqueConstraintError`.
- Cancel unlocked pre-read: remains the recorded Medium collecting-to-evaluating race. Not in this slice.

## Tests required

- Embedded access keys and presigned URL parameters are redacted.
- Unhealthy + below-threshold replacement/snapshot + stale, missing, inaccessible, incomplete, unparsable or empty `RunningTaskCount`: `UNKNOWN`. Healthy + stale metric: `PASS`.
- DescribeTasks failures or missing ARNs, including PascalCase `Failures`: `complete: false`.
- GRD-ECS-001 `UNKNOWN` when task inventory is incomplete even if running count matches described RUNNING tasks.
- DescribeTasks batches of at most 100 ARNs.
- GRD-OBS-001 PASS on `targetgroup/name/id`. FAIL on an unrelated suffix. FAIL when the only covering alarm is `AWS/ECS` `RunningTaskCount`. PASS on `ECS/ContainerInsights` `RunningTaskCount`.
- Live operations query `ECS/ContainerInsights` (constant and source, not `AWS/ECS`). Session refresh after 840 seconds. Transient AssumeRole failure is retryable.

## Consequences

- Existing fixture healthy alarms that use a full target-group ARN still match.
- Covering `RunningTaskCount` alarms in tests use `ECS/ContainerInsights`.
- No AWS mutation, MCP, models, Terraform or scheduling enter this slice.
