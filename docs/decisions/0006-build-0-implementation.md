# ADR-0006: Build 0 implementation amendments

Status: Accepted
Date: 2026-08-31
Milestone: Build 0

## Context

The Build 0 architecture gate blocked the first implementation proposal. The accepted ADRs 0001–0005 and the data-model artefact left six holes that would make fencing, provenance, readiness and findings unverifiable. This ADR records the amendments. It does not add product scope.

## Decision

### 1. `started_at`

`assurance_runs.started_at` is `timestamptz null`. PostgreSQL `now()` sets it exactly once on the `queued → collecting` transition. It is never updated again.

Duration remains `terminal_at - created_at` as in ADR-0002. `started_at` is provenance for when collection began, not the duration clock.

Correlated checks:

- `queued`: `started_at` is null, `result` is null, `terminal_at` is null
- `collecting` or `evaluating`: `started_at` is not null, `result` is null, `terminal_at` is null
- `healthy`: `started_at` is not null, `result = 'PASS'`, `terminal_at` is not null
- `findings`: `started_at` is not null, `result in ('FAIL', 'UNKNOWN')`, `terminal_at` is not null
- `failed`: `started_at` is not null, `result` is null, `terminal_at` is not null
- `cancelled`: `result` is null, `terminal_at` is not null, `started_at` is null if cancelled from `queued` and not null if cancelled from `collecting`

### 2. Lease fencing scope

Lease owner, `lease_epoch`, expiry and expected `leased` state fence **worker-originated** writes only:

- observation insert
- finding and citation insert
- step outcome (`succeeded` / retryable `ready` / `failed`)
- run transitions driven by a step outcome (`collecting → evaluating`, `evaluating → healthy|findings|failed`, collect-path `failed`)
- events that record those worker outcomes

Enqueue and cancellation are control-plane commands. They are guarded by expected run and step state, grant consumption, idempotency keys and row locks. They do not require a worker lease. Cancellation increments collect `lease_epoch` in the same transaction so a previous collect lease cannot commit afterwards.

### 3. Global lock order

Every transaction that touches more than one of these rows acquires locks in this order:

1. `authorisation_grants` (enqueue consume only)
2. `assurance_runs` (`FOR UPDATE`)
3. `run_steps` for that run: `collect` then `evaluate`
4. Event append uses `MAX(sequence)+1` while the run row (the aggregate) is already locked

Claim uses `FOR UPDATE OF assurance_runs SKIP LOCKED` first, then locks the candidate step. It never locks a step before its run. Cancel, exhaustion, completion and recovery use the same order.

The event aggregate for a run is the `assurance_runs` row. There is no separate aggregate lock table.

### 4. Build 0 registered fake detector

Findings come only from a registered deterministic detector. Build 0 ships `GRD-FAKE-001` version `1` in `packages/test-support`. It is development and test only. It is not `GRD-ECS-001` or `GRD-OBS-001`. Those remain Build 1.

The fixture profile pins `GRD-FAKE-001` / `1` onto the grant and the run. The detector:

- requires a `fake.inventory` observation (or a same-kind inaccessible observation)
- returns `UNKNOWN` when required evidence is missing, stale, truncated or inaccessible
- returns `FAIL` when the inventory payload has `fixtureResult: "FAIL"`
- returns `PASS` otherwise
- always cites at least one observation through `finding_citations`

### 5. Migration ledger

Domain tables stay as specified. The migrator owns `schema_migrations` (`id text primary key`, `applied_at timestamptz not null`). That table is not a domain entity. Readiness is true only when PostgreSQL accepts a connection and every expected Build 0 migration id is present.

### 6. Scripts

`pnpm verify` runs every genuine Build 0 check. `test:contract` and `test:e2e` are omitted until Build 1 has real suites. No placeholder suite may exit 0.

### 7. Grant-bound run columns are immutable

On insert, `assurance_runs.resource_scope` must equal the consumed grant's `resource_scope` JSON, not only `resource_scope_digest`. The same equality applies to organisation, profile version, evidence window and detector versions.

After insert, these columns are immutable: `organisation_id`, `profile_version_id`, `authorisation_grant_id`, `resource_scope`, `resource_scope_digest`, `evidence_window_from`, `evidence_window_to`, `detector_versions`, `client_idempotency_key`, `request_digest`, `run_identity_digest`, `created_at`.

Mutable run columns are only: `state`, `result`, `cancel_requested_at`, `collector_attempt_count`, `started_at` (null to timestamp once), `updated_at`, `terminal_at`.

This ADR's lock order (run then step) supersedes the lock-acquisition sentence in ADR-0002. Fencing checks on the step row still apply to worker-originated writes.

### 8. Missing inventory still produces a citable observation

If `ResourceInventoryPort` returns nothing, throws, or otherwise yields no usable `fake.inventory` payload, collect persists a same-kind normalised inaccessible observation (`kind = 'fake.inventory'`, `inaccessible = true`). `GRD-FAKE-001` then returns cited `UNKNOWN`. Citation-less findings cannot commit.

### 9. Closed error messages

`error_class` maps to exactly one `error_message`. Enforced by a table check constraint:

| error_class           | error_message                      |
| --------------------- | ---------------------------------- |
| `attempts_exhausted`  | `step attempts exhausted`          |
| `persist_failure`     | `durable persist failed`           |
| `invariant_violation` | `orchestration invariant violated` |
| `cancelled`           | `run cancelled`                    |

Both null, or both equal to one of those pairs. Arbitrary, provider, stack or secret text is rejected.

## Consequences

- SQL migrations must include `started_at` and the correlated checks above.
- Worker code paths always lock run then step. Tests must include cancel-versus-claim, cancel-versus-completion and exhaustion-versus-recovery.
- No AWS SDK, adapter, Build 1 detector, web UI, HTTP write route, case write or outbox write lands in this milestone.

## Tests required

In addition to ADR-0001 through 0004:

- `started_at` set once on `queued → collecting` and unchanged thereafter
- cross-organisation digest distinction and query isolation
- expired grant cannot enqueue; concurrent grant consumption creates one run
- non-development identity mode refuses to bind a listen port
- inaccessible or truncated required evidence yields `UNKNOWN` from `GRD-FAKE-001`
- citation-less finding commit fails; cross-run citation fails; later citation addition after commit fails; citation update and delete fail
- run insert **and** update tampering of grant-bound fields is rejected, including `resource_scope` JSON substitution that keeps the original digest, equivalent-grant substitution, and `run_identity_digest` tampering
- every `error_class` / `error_message` pair is accepted; arbitrary, provider, stack or secret `error_message` text is rejected
- cancel versus claim, cancel versus collect completion, exhaustion versus expired-lease recovery: valid terminal state, no duplicate logical event
- readiness: PostgreSQL unavailable, before migrations, after partial migration, after full migration
- forced worker crash after observation insert and before step completion recovers with no duplicate runs, observations, findings or events
