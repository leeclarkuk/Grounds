# ADR-0002: Run and step orchestration, fencing and idempotency

Status: Accepted
Date: 2026-08-31
Milestone: Build 0

## Context

The plan defines run states, `FOR UPDATE SKIP LOCKED`, `lease_epoch` and idempotency, but left step ordering, retry, cancellation races and write fencing incomplete. A worker could theoretically claim `evaluate` before `collect`, write observations after lease loss, or commit collect results after cancel. Collector errors were also conflated with terminal run failure, which would hide required-evidence gaps.

## Decision

### Run states

Allowed transitions:

- `pending_authorisation` → `queued` (grant consumed) | `cancelled`
- `queued` → `collecting` (collect lease acquired) | `cancelled`
- `collecting` → `evaluating` (collect succeeded) | `failed` | `cancelled`
- `evaluating` → `healthy` | `findings` | `failed`

`healthy` means every pinned detector returned `PASS`. `findings` means evaluation completed and at least one detector returned `FAIL` or `UNKNOWN`. Mixed `PASS` and `UNKNOWN` with no `FAIL` terminates as `findings`, never `healthy`.

Result summary: `FAIL` if any `FAIL`, else `UNKNOWN` if any `UNKNOWN`, else `PASS`.

`failed` is reserved for internal orchestration faults: invariant violation, persist failure, or exhausted orchestration attempts. Inaccessible provider evidence does not put the run in `failed`.

### Steps

Exactly two steps per run: `collect` then `evaluate`.

- On enqueue: insert `collect` as `ready` and `evaluate` as `blocked`.
- `evaluate` becomes `ready` only when `collect` reaches `succeeded`.
- Step states: `blocked` → `ready` → `leased` → `succeeded` | `failed` | `cancelled`.
- Retry: same step row, `leased` → `ready` on lease expiry recovery or retryable failure, `attempt` incremented, new attempt event. Pinned max attempts: 5. Backoff: 1s, 2s, 4s, 8s, 16s, capped at 16s.
- Claim predicate: `FOR UPDATE SKIP LOCKED` where the step is `ready`, or `leased` with `lease_expires_at < now()`, the run state is eligible, and the run is not `cancelled`.
- Eligible run states: `collect` may be claimed in `queued` or `collecting`. `evaluate` may be claimed only in `evaluating`.

### Fencing

Acquiring or recovering a lease increments `lease_epoch`, sets `lease_owner` and `lease_expires_at`.

Heartbeats update `lease_expires_at` only when `lease_owner` and `lease_epoch` match.

Every observation, finding, event and run-state write runs in a transaction that first locks the step row and checks:

- `lease_owner` is this worker
- `lease_epoch` matches
- `lease_expires_at > now()`
- expected step state is `leased`
- expected run state is the legal state for that write

Completion of a step uses the same checks plus expected state. A stale worker cannot commit.

Clock authority is PostgreSQL `now()`.

### Cancellation

`POST /v1/runs/:id/cancel` (Build 1) and the application cancel command (Build 0 tests) persist cancel immediately.

Honoured from `pending_authorisation`, `queued` and `collecting`. A cancel during `evaluating` is recorded on the run as a requested flag or event and does not abort an in-flight evaluate that already holds a valid lease.

Cancel of collect is one transaction: set run to `cancelled`, set collect step to `cancelled`, increment `lease_epoch`. The previous collect lease cannot commit observations, findings or run transitions.

Cancellation is checked between bounded operations (between collector calls, after each page).

### Idempotency

One protocol for every write:

- Client supplies `Idempotency-Key`.
- Same key and same payload digest: replay the original resource and HTTP result.
- Same key and different payload digest: RFC 9457 `409`.
- Run natural uniqueness additionally includes consumed `authorisation_grant_id` (unique) and a computed key of organisation, profile version, resource scope, evidence window and trigger identity.
- Events are appended in the same transaction as the state change. Sequence is `MAX(sequence)+1` for that aggregate, protected by unique `(aggregate_type, aggregate_id, sequence)`.

### Outbox and cases

`outbox` exists so lag can be measured. Build 0 and Build 1 insert no outbox rows and run no reconciler. `cases` is schema-only: no writes in Builds 0 or 1.

## Consequences

- Build 0 can prove fencing, cancel, replay and ordering without AWS or HTTP write APIs.
- Pagination and throttle retries must heartbeat and re-check cancel; a collector that outlives its lease cannot persist.

## Tests required

- Two workers race; one claims the step.
- Expired lease recovered with a higher epoch.
- Stale worker cannot commit observations, findings, events or run transitions.
- Crash after observation insert and before step completion replays without duplicates.
- Evaluate cannot be claimed while collect is `ready` or `leased`.
- Cancel during collect: collect lease cannot commit afterwards.
- Retry increments attempt on the same step id.
- Event sequence cannot fork.
- Same idempotency key and payload replays; same key and different payload conflicts.
