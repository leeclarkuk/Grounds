# ADR-0005: GRD-ECS-001 and GRD-OBS-001 truth tables

Status: Accepted
Date: 2026-08-31
Milestone: Build 1 (implementation), locked before that code is written

## Context

The plan states detector intent in prose. The architecture gate required executable rules for "repeated", "sustained", target-health reasons, alarm coverage, notification actions and the boolean meaning of `GRD-OBS-001`. Thresholds are pinned on the profile version, not chosen at evaluation time.

These rules are recorded now so Build 1 cannot invent them during implementation. Detector code is not part of Build 0.

## Decision

### Pinned profile parameters

Copied onto the run from the immutable profile version:

| Key | Fixture default | Meaning |
| --- | --- | --- |
| `replacementCountThreshold` | `2` | Distinct STOPPED tasks with `stoppedAt` inside the evidence window |
| `runningDeficitThreshold` | `1` | `desiredCount - runningCount` on the service observation |
| `unhealthyTargetReasons` | `["Target.FailedHealthChecks"]` | Target-health reasons that count as load-balancer health-check failure |
| `deficitSustainedFraction` | `0.8` | Fraction of `RunningTaskCount` datapoints in the window that must sit below `desiredCount` |
| `freshnessMaxAgeSeconds` | profile-defined | Age beyond which required evidence is `STALE` |

Deficit metric: namespace `AWS/ECS`, metric `RunningTaskCount`, compared to the service's `desiredCount`.

### GRD-ECS-001

Required evidence kinds: ECS service, tasks (or inaccessible-task observation), inspected target group, target health, and the target group's health-check path and matcher.

FAIL when all of the following are evidenced, fresh, in-scope and non-truncated:

1. The service is attached to the inspected target group.
2. At least one target in that group is `unhealthy` with a reason in `unhealthyTargetReasons`.
3. Either replacement count ≥ `replacementCountThreshold`, or sustained deficit: `desiredCount - runningCount ≥ runningDeficitThreshold` on the service observation, or at least `deficitSustainedFraction` of `RunningTaskCount` datapoints in the window are below `desiredCount`.
4. The target group observation includes a non-empty health-check path and matcher.

UNKNOWN when any required observation is missing, stale, truncated, inaccessible, or contradictory (service target group ≠ inspected group; target-health group mismatch; running count disagrees with described running tasks).

PASS when all required evidence is fresh and complete and the FAIL conjunction is false.

The finding may say the health-check contract is failing. It must not claim a missing application route.

### GRD-OBS-001

Alarm inventory is complete only when `DescribeAlarms` pagination finishes without error, truncation or dropped pages.

A covering alarm is enabled (`ActionsEnabled = true`) and has at least one notification action (an SNS ARN in `AlarmActions`) and matches one of:

- `AWS/ApplicationELB` / `UnHealthyHostCount` with a TargetGroup dimension matching the inspected target group; or
- `AWS/ECS` / `RunningTaskCount` with a ServiceName dimension matching the inspected service.

CPU utilisation is not coverage.

FAIL when inventory is complete and no covering alarm exists.

PASS when inventory is complete and at least one covering alarm exists.

UNKNOWN if alarm inventory cannot be read completely.

### Evaluation outcome

Every finding, including PASS, cites at least one observation id. Replay of the same observations and detector versions yields the same fingerprints.

## Consequences

- Build 1 fixtures must exercise PASS, FAIL and UNKNOWN for both detectors, including contradiction and incomplete pagination.
- Profile changes create a new `profile_versions` row. They cannot retcon an in-flight or historic run.

## Tests required

- Full truth tables for both detectors, including mixed PASS/UNKNOWN (run terminates `findings`).
- CPU-only alarm does not satisfy GRD-OBS-001.
- Incomplete alarm pagination yields UNKNOWN, never PASS or FAIL.
- Fingerprint stability across replay.
