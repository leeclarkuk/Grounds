# State machines

## Assurance run

```mermaid
stateDiagram-v2
    [*] --> pending_authorisation
    pending_authorisation --> queued: grant consumed
    queued --> collecting: collect lease acquired
    collecting --> evaluating: collect succeeded
    evaluating --> healthy: all detectors PASS
    evaluating --> findings: any FAIL or UNKNOWN
    collecting --> failed: orchestration fault
    evaluating --> failed: orchestration fault
    pending_authorisation --> cancelled
    queued --> cancelled
    collecting --> cancelled
```

`healthy` requires every pinned detector to return PASS. Any UNKNOWN terminates as `findings`. Evaluating is not cancellable. A cancel requested during evaluate is recorded and ignored for that in-flight lease.

`failed` is an internal orchestration fault, not a missing collector.

## Steps

```mermaid
stateDiagram-v2
    [*] --> blocked: evaluate at enqueue
    [*] --> ready: collect at enqueue
    blocked --> ready: collect succeeded
    ready --> leased: claim or recover
    leased --> ready: retry or expired lease
    leased --> succeeded
    leased --> failed: orchestration fault after max attempts
    leased --> cancelled: collect cancel
    ready --> cancelled: collect cancel before claim
```

`evaluate` is created `blocked` and cannot be claimed until `collect` is `succeeded`.
