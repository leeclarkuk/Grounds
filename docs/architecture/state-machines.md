# State machines

## Assurance run

```mermaid
stateDiagram-v2
    [*] --> queued: grant consumed in enqueue transaction
    queued --> collecting: collect lease acquired
    collecting --> evaluating: collect succeeded
    evaluating --> healthy: all detectors PASS
    evaluating --> findings: any FAIL or UNKNOWN
    collecting --> failed: orchestration fault
    evaluating --> failed: orchestration fault
    queued --> cancelled
    collecting --> cancelled
```

The persisted initial state is `queued`. `pending_authorisation` is not a durable row in Builds 0 and 1.

`healthy` requires every pinned detector to return PASS. Any UNKNOWN terminates as `findings`. Evaluating is not cancellable. A cancel requested during evaluate is recorded and ignored for that in-flight lease.

`failed` is an internal orchestration fault, not a missing collector.

## Steps

```mermaid
stateDiagram-v2
    [*] --> blocked: evaluate at enqueue
    [*] --> ready: collect at enqueue
    blocked --> ready: collect succeeded
    ready --> leased: claim attempt less than 5
    leased --> leased: expired lease recovered in place
    leased --> ready: explicit retryable failure with backoff
    leased --> succeeded
    leased --> failed: attempts exhausted or orchestration fault
    ready --> failed: attempts exhausted
    leased --> cancelled: collect cancel
    ready --> cancelled: collect cancel before claim
```

`evaluate` is created `blocked` and cannot be claimed until `collect` is `succeeded`. Expired lease recovery stays on `leased` with a higher `lease_epoch` and incremented `attempt`. `ready` is used for the first claim and for explicit retryable failure after `next_attempt_at`.
