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

A covering alarm is enabled (`ActionsEnabled = true`), has at least one configured notification action (a non-empty ARN in `AlarmActions`), and matches one of:

- `AWS/ApplicationELB` / `UnHealthyHostCount` with a TargetGroup dimension matching the inspected target group; or
- `AWS/ECS` / `RunningTaskCount` with a ServiceName dimension matching the inspected service.

CPU utilisation is not coverage.

The detector asserts configured alarm actions, not owner notification. `DescribeAlarms` cannot prove SNS subscriptions or that a human receives the alarm. Builds 0 and 1 do not call SNS. Title and explanation must not say an owner is notified.

FAIL when inventory is complete and no covering alarm exists.

PASS when inventory is complete and at least one covering alarm exists.

UNKNOWN if alarm inventory cannot be read completely.

### Evaluation outcome

Every finding, including PASS, cites at least one observation through `finding_citations`. Replay of the same observations and detector versions yields the same fingerprints.

### Finding fingerprint

`fingerprint` is SHA-256 over RFC 8785 canonical JSON of:

```ts
{
  organisationId: string,
  detectorId: string,
  detectorVersion: string,
  detectorParametersDigest: string,
  resource: ResourceRef,
  result: "PASS" | "FAIL" | "UNKNOWN",
  condition: Record<string, string | boolean | null>
}
```

`detectorParametersDigest` is SHA-256 of the pinned profile detector parameters.

Explicitly excluded: `run_id`, observation row ids, `evaluatedAt`, `title`, `explanation`, volatile counts, lease metadata.

Detector-specific `condition` maps:

- `GRD-ECS-001`: `{ targetGroupArn, healthCheckPath, matcher, failClause }` where `failClause` is `"replacement"`, `"deficit"`, `"both"`, or `null` on PASS/UNKNOWN.
- `GRD-OBS-001`: `{ unhealthyTargetAlarm, runningTaskAlarm }` booleans for whether each coverage rule was met.

Equivalent findings across runs share a fingerprint so a later case table can deduplicate. Distinct resources, detector versions, parameters or results must not collide.

## Consequences

- Build 1 fixtures must exercise PASS, FAIL and UNKNOWN for both detectors, including contradiction and incomplete pagination.
- Profile changes create a new `profile_versions` row. They cannot retcon an in-flight or historic run.

## Tests required

- Full truth tables for both detectors, including mixed PASS/UNKNOWN and UNKNOWN-only (run terminates `findings`, never stuck in `evaluating`).
- CPU-only alarm does not satisfy GRD-OBS-001.
- An alarm with `AlarmActions` still produces wording that claims configured actions, not owner delivery.
- Incomplete alarm pagination yields UNKNOWN, never PASS or FAIL.
- Fingerprint stability across replay; equivalent findings across runs share a fingerprint; changing resource, detector version, parameters or result changes the fingerprint; distinct conditions do not collide.
- Two runs with the same fingerprint both persist a finding row. Uniqueness is `(run_id, fingerprint)`.
