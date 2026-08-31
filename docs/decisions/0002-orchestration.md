# ADR-0002: Run and step orchestration, fencing and idempotency

Status: Accepted
Date: 2026-08-31
Milestone: Build 0

## Context

The plan defines run states, `FOR UPDATE SKIP LOCKED`, `lease_epoch` and idempotency, but left step ordering, retry, cancellation races and write fencing incomplete. A worker could theoretically claim `evaluate` before `collect`, write observations after lease loss, or commit collect results after cancel. Collector errors were also conflated with terminal run failure, which would hide required-evidence gaps.

## Decision

### Run states

Allowed transitions:

- `queued` → `collecting` (collect lease acquired) | `cancelled`
- `collecting` → `evaluating` (collect succeeded) | `failed` | `cancelled`
- `evaluating` → `healthy` | `findings` | `failed`

The persisted initial state is `queued`. `pending_authorisation` is not a durable row.

`healthy` means every pinned detector returned `PASS`. `findings` means evaluation completed and at least one detector returned `FAIL` or `UNKNOWN`. Mixed `PASS` and `UNKNOWN` with no `FAIL` terminates as `findings`, never `healthy`.

Result summary: `FAIL` if any `FAIL`, else `UNKNOWN` if any `UNKNOWN`, else `PASS`.

`failed` is reserved for internal orchestration faults: invariant violation, persist failure, or exhausted orchestration attempts. Inaccessible provider evidence does not put the run in `failed`.

### Steps

Exactly two steps per run: `collect` then `evaluate`.

- On enqueue: insert `collect` as `ready` and `evaluate` as `blocked`, both with `attempt = 0`, `lease_epoch = 0`, `next_attempt_at` null.
- `evaluate` becomes `ready` only when `collect` reaches `succeeded`.
- Step states: `blocked` → `ready` → `leased` → `succeeded` | `failed` | `cancelled`. `leased` → `ready` is only for an explicit retryable failure while the current owner still holds the lease.
- `attempt` is the number of leases acquired for the step, including recoveries. The first claim sets `attempt = 1`. Maximum attempts: 5. There is no sixth lease.
- Authoritative expired-lease transition: an expired `leased` row is claimed in place. The same `UPDATE` increments `lease_epoch`, sets the new owner and `lease_expires_at`, increments `attempt`, keeps `state = leased`, and records a recovery event. Recovery does not pass through `ready`.
- Explicit retryable failure (still holding a valid lease): `leased` → `ready`, `next_attempt_at = now() + backoff(attempt)`, owner cleared, expiry cleared. Backoff: 1s, 2s, 4s, 8s, then 16s capped.
- When a claim or watchdog sees `attempt >= 5` and the step is `ready` with due `next_attempt_at`, or `leased` and expired, the same transaction sets the step to `failed` and the run to `failed` (orchestration fault: attempts exhausted). No further lease is issued.
- Claim predicate: `FOR UPDATE SKIP LOCKED` where `attempt < 5`, `(next_attempt_at IS NULL OR next_attempt_at <= now())`, run state is eligible, run is not `cancelled`, and either `state = ready` or (`state = leased` and `lease_expires_at < now()`).
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

Honoured from `queued` and `collecting`. A cancel during `evaluating` is recorded on the run as a requested flag or event and does not abort an in-flight evaluate that already holds a valid lease.

Cancel of collect is one transaction: set run to `cancelled`, set collect step to `cancelled`, increment `lease_epoch`. The previous collect lease cannot commit observations, findings or run transitions.

Cancellation is checked between bounded operations (between collector calls, after each page).

### Idempotency

Two distinct keys. Do not store one and pretend it is the other.

1. **Client request key.** Header `Idempotency-Key` on every write. Stored as `client_idempotency_key` plus `request_digest`. Same key and same digest: replay the original resource. Same key and different digest: RFC 9457 `409`. Unique per resource table (`authorisation_grants.client_idempotency_key`, `assurance_runs.client_idempotency_key`).
2. **Run identity digest.** SHA-256 of RFC 8785 canonical JSON of `organisationId`, `profileVersionId`, `resourceScope`, `evidenceWindow`, and `triggerIdentity`. For manual Builds 0 and 1, `triggerIdentity` is `{ "type": "manual_grant", "grantId": "<uuid>" }`. Unique on `assurance_runs.run_identity_digest`.

Enqueue is one transaction: consume grant (`UPDATE … RETURNING *`), insert the run using only columns from that returned grant row (organisation, actor provenance, profile, scope, scope digest, evidence window, detector versions), insert both steps, append the initial events (`grant_consumed`, `run_queued`, `step_created:collect`, `step_created:evaluate`). The persisted initial run state is `queued`. `pending_authorisation` is a logical step inside that transaction and is not a durable row in Builds 0 and 1. If any insert fails, the grant remains unconsumed.

A database trigger rejects a run insert or update whose `resource_scope_digest`, evidence window, `profile_version_id`, `organisation_id` or `detector_versions` do not equal the consumed grant. Tests must attempt to tamper with each of those fields and fail.

Events are appended in the same transaction as the state change. Sequence is `MAX(sequence)+1` for that aggregate, taken while the aggregate row is locked, under unique `(aggregate_type, aggregate_id, sequence)`. Duplicate logical events are also prevented by unique `(aggregate_type, aggregate_id, type, operation_id)`.

`operation_id` is a stable command identity, not a lease epoch for outcomes:

- enqueue: `enqueue:<run_id>`
- lease acquired or recovered: `collect:lease:<lease_epoch>` / `evaluate:lease:<lease_epoch>`
- step outcome: `collect:succeeded:<run_id>`, `collect:failed:<run_id>`, `evaluate:succeeded:<run_id>`

Replay of the same command inserts no second sequence number. Concurrent appenders must serialise on the aggregate; tests must prove contiguous sequences and no lost committed transitions.

`error_class` is a closed set (`attempts_exhausted`, `persist_failure`, `invariant_violation`, `cancelled`). `error_message` is a short internal string, never a provider body, stack trace, AWS request object or secret. Tests must prove those cannot be persisted.

### Outbox, cases and cost

`outbox` exists so lag can be measured. Build 0 and Build 1 insert no outbox rows and run no reconciler. The plan's "fake reconciler" wording is superseded by this ADR. `cases` is schema-only: no writes in Builds 0 or 1.

Invariant 22 in the plan is scoped for this build as follows. Every terminal run records `started_at`, `terminal_at`, duration (`terminal_at - created_at`), provenance (actor, grant, profile, scope, detector versions) and step attempts. Evaluated runs (`healthy` or `findings`) also persist cited observations and findings. Cancelled or failed-before-evaluate runs record provenance and duration without findings. Monetary cloud cost is not claimed in Builds 0 or 1; fixture cost is recorded as collector attempt counts on the run (`collector_attempt_count`, default 0).

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
- Retry increments attempt on the same step id. Durable `next_attempt_at` survives worker death. Two workers cannot recover the same epoch. A sixth attempt is impossible.
- Crash between grant consume and run insert rolls back; the grant can still be consumed once.
- Event sequence cannot fork. Replaying the same `operation_id` does not append a second event. Concurrent appenders produce contiguous sequences.
- Client idempotency key replay and conflict behaviour as above. Distinct `run_identity_digest` uniqueness is also enforced.
- Tampering with run scope, window, profile or detector versions at insert is rejected.
- `error_message` cannot persist secrets or raw provider objects.
