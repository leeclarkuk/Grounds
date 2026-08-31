# Build 0 data model

Design artefact for the architecture gate. SQL migrations in `migrations/` will implement this exactly. Do not treat this file as applied schema.

Clock authority: PostgreSQL `now()` for lease expiry, grant expiry, freshness and `collected_at`.

`profile_versions` are insert-only. A trigger rejects `UPDATE` and `DELETE`.

`cases` and `outbox` exist. Builds 0 and 1 write no case rows and no outbox rows.

The migrator owns `schema_migrations` (`id text primary key`, `applied_at timestamptz not null`). It is not a domain table. See [ADR-0006](../decisions/0006-build-0-implementation.md).

## Tables

### profile_versions

Immutable run configuration.

- `id` uuid primary key
- `organisation_id` text not null
- `profile_id` text not null
- `version` integer not null
- `scope` jsonb not null
- `detector_versions` jsonb not null
- `freshness_policy` jsonb not null
- `detector_parameters` jsonb not null
- `content_digest` text not null unique
- `created_at` timestamptz not null default now()

Unique `(organisation_id, profile_id, version)`.
Unique `(id, organisation_id)` to support composite foreign keys.

### authorisation_grants

Exact, single-use, expiring grant.

- `id` uuid primary key
- `organisation_id` text not null
- `actor_id` text not null
- `profile_version_id` uuid not null
- `resource_scope` jsonb not null
- `resource_scope_digest` text not null
- `evidence_window_from` timestamptz not null
- `evidence_window_to` timestamptz not null
- `detector_versions` jsonb not null
- `action` text not null check (action = 'assurance_run')
- `granted_at` timestamptz not null
- `expires_at` timestamptz not null
- `consumed_at` timestamptz null
- `client_idempotency_key` text not null
- `request_digest` text not null
- `created_at` timestamptz not null default now()

Unique `client_idempotency_key`. Application returns 409 when the key exists with a different `request_digest`.
Unique `(id, organisation_id)` and unique `(id, organisation_id, profile_version_id)`.
Check `evidence_window_from < evidence_window_to`.
Foreign key `(profile_version_id, organisation_id)` references `profile_versions (id, organisation_id)`.
Trigger: the only permitted update is `consumed_at` from null to a timestamp. All other grant columns are immutable. Delete is rejected.

### assurance_runs

- `id` uuid primary key
- `organisation_id` text not null
- `profile_version_id` uuid not null
- `authorisation_grant_id` uuid not null unique
- `resource_scope` jsonb not null
- `resource_scope_digest` text not null
- `evidence_window_from` timestamptz not null
- `evidence_window_to` timestamptz not null
- `detector_versions` jsonb not null
- `state` text not null check (state in (
  'queued', 'collecting', 'evaluating',
  'healthy', 'findings', 'failed', 'cancelled'
  ))
- `result` text null check (result is null or result in ('PASS', 'FAIL', 'UNKNOWN'))
- `client_idempotency_key` text not null unique
- `request_digest` text not null
- `run_identity_digest` text not null unique
- `cancel_requested_at` timestamptz null
- `collector_attempt_count` integer not null default 0 check (collector_attempt_count >= 0)
- `created_at` timestamptz not null default now()
- `started_at` timestamptz null
- `updated_at` timestamptz not null default now()
- `terminal_at` timestamptz null

Check `evidence_window_from < evidence_window_to`.
Check correlated terminal truth:

- `state = 'queued'` implies `started_at` is null, `result` is null and `terminal_at` is null
- `state in ('collecting', 'evaluating')` implies `started_at` is not null, `result` is null and `terminal_at` is null
- `state = 'healthy'` implies `started_at` is not null, `result = 'PASS'` and `terminal_at` is not null
- `state = 'findings'` implies `started_at` is not null, `result in ('FAIL', 'UNKNOWN')` and `terminal_at` is not null
- `state = 'failed'` implies `started_at` is not null, `result` is null and `terminal_at` is not null
- `state = 'cancelled'` implies `result` is null, `terminal_at` is not null, and `started_at` is null when cancelled from `queued`

`started_at` is set exactly once with PostgreSQL `now()` on `queued → collecting`. Duration remains `terminal_at - created_at`.

`pending_authorisation` is not persisted in Builds 0 and 1.
Unique `(id, organisation_id)` and unique `(id, profile_version_id)`.
Foreign key `(profile_version_id, organisation_id)` references `profile_versions (id, organisation_id)`.
Foreign key `(authorisation_grant_id, organisation_id, profile_version_id)` references `authorisation_grants (id, organisation_id, profile_version_id)`.
Trigger: on insert and update, run `resource_scope`, `resource_scope_digest`, evidence window, `organisation_id`, `profile_version_id` and `detector_versions` must equal the consumed grant. `resource_scope` is compared as JSON equality, not digest-only.

Trigger: after insert, organisation, profile version, grant id, resource scope, scope digest, evidence window, detector versions, client idempotency key, request digest, run identity digest and `created_at` are immutable. `started_at` may change only from null to a timestamp.

### run_steps

- `id` uuid primary key
- `run_id` uuid not null references assurance_runs(id)
- `step_type` text not null check (step_type in ('collect', 'evaluate'))
- `state` text not null check (state in ('blocked', 'ready', 'leased', 'succeeded', 'failed', 'cancelled'))
- `attempt` integer not null default 0 check (attempt >= 0 and attempt <= 5)
- `next_attempt_at` timestamptz null
- `lease_owner` text null
- `lease_expires_at` timestamptz null
- `lease_epoch` bigint not null default 0 check (lease_epoch >= 0)
- `error_class` text null check (error_class is null or error_class in (
  'attempts_exhausted', 'persist_failure', 'invariant_violation', 'cancelled'
  ))
- `error_message` text null

Check: `error_class` and `error_message` are both null, or they match exactly one pair:

- `attempts_exhausted` / `step attempts exhausted`
- `persist_failure` / `durable persist failed`
- `invariant_violation` / `orchestration invariant violated`
- `cancelled` / `run cancelled`
- `updated_at` timestamptz not null default now()

Unique `(run_id, step_type)`.
Check: if `state = 'leased'` then `lease_owner` is not null, `lease_expires_at` is not null and `lease_epoch >= 1`.
Check: if `state in ('blocked', 'ready')` then `lease_owner` is null.

### observations

- `id` uuid primary key
- `run_id` uuid not null references assurance_runs(id)
- `organisation_id` text not null
- `schema_version` integer not null default 1
- `resource` jsonb not null
- `kind` text not null
- `collected_at` timestamptz not null
- `window_from` timestamptz not null
- `window_to` timestamptz not null
- `source_adapter` text not null
- `source_operation` text not null
- `request_digest` text not null
- `freshness` text not null check (freshness in ('FRESH', 'STALE'))
- `payload` jsonb not null
- `payload_digest` text not null
- `redaction_version` text not null
- `truncated` boolean not null default false
- `inaccessible` boolean not null default false
- `content_identity` text not null
- `created_at` timestamptz not null default now()

Unique `(run_id, content_identity)`. Unique `(id, run_id)`.
Foreign key `(run_id, organisation_id)` references `assurance_runs (id, organisation_id)`.
Trigger rejects `UPDATE` and `DELETE`.

### findings

- `id` uuid primary key
- `run_id` uuid not null references assurance_runs(id)
- `detector_id` text not null
- `detector_version` text not null
- `profile_version_id` uuid not null
- `resource` jsonb not null
- `result` text not null check (result in ('PASS', 'FAIL', 'UNKNOWN'))
- `severity` text not null check (severity in ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
- `title` text not null
- `explanation` text not null
- `fingerprint` text not null
- `citation_count` integer not null check (citation_count >= 1)
- `evaluated_at` timestamptz not null

Unique `(run_id, fingerprint)`. Unique `(id, run_id)`.
Foreign key `profile_version_id` references `profile_versions (id)`.
Foreign key `(run_id, profile_version_id)` references `assurance_runs (id, profile_version_id)`.
Trigger rejects `UPDATE` and `DELETE`.
Deferred constraint trigger: `citation_count` equals `count(*)` from `finding_citations` for that finding at commit.

### finding_citations

- `finding_id` uuid not null
- `observation_id` uuid not null
- `run_id` uuid not null
- primary key `(finding_id, observation_id)`
- foreign key `(finding_id, run_id)` references `findings (id, run_id)`
- foreign key `(observation_id, run_id)` references `observations (id, run_id)`

A finding cannot cite a missing observation or an observation from another run.
Trigger rejects `UPDATE` and `DELETE`. Tests must cover empty citations, cross-run citations, later addition after commit, update and deletion.

### cases

Schema only. No Build 0 or Build 1 writes.

- `id` uuid primary key
- `organisation_id` text not null
- `fingerprint` text not null
- `status` text not null default 'open'
- `created_at` timestamptz not null default now()

Unique `(organisation_id, fingerprint)`.

### events

- `id` uuid primary key
- `aggregate_type` text not null
- `aggregate_id` uuid not null
- `sequence` bigint not null
- `type` text not null
- `operation_id` text not null
- `payload` jsonb not null
- `actor_id` text null
- `occurred_at` timestamptz not null default now()

Unique `(aggregate_type, aggregate_id, sequence)`.
Unique `(aggregate_type, aggregate_id, type, operation_id)`.
Trigger rejects `UPDATE` and `DELETE`.

### outbox

- `id` uuid primary key
- `idempotency_key` text not null unique
- `kind` text not null
- `payload` jsonb not null
- `created_at` timestamptz not null default now()
- `processed_at` timestamptz null

Lag metric: count of rows where `processed_at` is null. Expected zero in Builds 0 and 1.

## Indexes for claim

`run_steps (state, lease_expires_at, next_attempt_at, attempt)` plus `run_id`. Claim SQL always joins `assurance_runs` to enforce eligible run state and absence of collect-cancel, and includes `attempt < 5` and due `next_attempt_at`.

## Payload digest

`payload_digest` is SHA-256 of the full redacted canonical payload before any truncation envelope is substituted. The persisted JSON may be the envelope. Detectors that require that payload therefore see `truncated = true` and return `UNKNOWN`.
