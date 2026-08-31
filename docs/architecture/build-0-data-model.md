# Build 0 data model

Design artefact for the architecture gate. SQL migrations in `migrations/` will implement this exactly. Do not treat this file as applied schema.

Clock authority: PostgreSQL `now()` for lease expiry, grant expiry, freshness and `collected_at`.

`profile_versions` are insert-only. A trigger rejects `UPDATE` and `DELETE`.

`cases` and `outbox` exist. Builds 0 and 1 write no case rows and no outbox rows.

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

### authorisation_grants

Exact, single-use, expiring grant.

- `id` uuid primary key
- `organisation_id` text not null
- `actor_id` text not null
- `profile_version_id` uuid not null references profile_versions(id)
- `resource_scope` jsonb not null
- `resource_scope_digest` text not null
- `evidence_window_from` timestamptz not null
- `evidence_window_to` timestamptz not null
- `detector_versions` jsonb not null
- `action` text not null check (action = 'assurance_run')
- `granted_at` timestamptz not null
- `expires_at` timestamptz not null
- `consumed_at` timestamptz null
- `idempotency_key` text not null
- `request_digest` text not null
- `created_at` timestamptz not null default now()

Unique `idempotency_key`. Unique `(idempotency_key, request_digest)` is enforced by storing both and rejecting digest mismatch in the application (409).

### assurance_runs

- `id` uuid primary key
- `organisation_id` text not null
- `profile_version_id` uuid not null references profile_versions(id)
- `authorisation_grant_id` uuid not null unique references authorisation_grants(id)
- `resource_scope` jsonb not null
- `resource_scope_digest` text not null
- `evidence_window_from` timestamptz not null
- `evidence_window_to` timestamptz not null
- `detector_versions` jsonb not null
- `state` text not null
- `result` text null
- `idempotency_key` text not null unique
- `request_digest` text not null
- `cancel_requested_at` timestamptz null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `terminal_at` timestamptz null

### run_steps

- `id` uuid primary key
- `run_id` uuid not null references assurance_runs(id)
- `step_type` text not null check (step_type in ('collect', 'evaluate'))
- `state` text not null
- `attempt` integer not null default 0
- `lease_owner` text null
- `lease_expires_at` timestamptz null
- `lease_epoch` bigint not null default 0
- `error_class` text null
- `error_message` text null
- `updated_at` timestamptz not null default now()

Unique `(run_id, step_type)`.

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

Unique `(run_id, content_identity)`. No updates. No deletes.

### findings

- `id` uuid primary key
- `run_id` uuid not null references assurance_runs(id)
- `detector_id` text not null
- `detector_version` text not null
- `profile_version_id` uuid not null
- `resource` jsonb not null
- `result` text not null check (result in ('PASS', 'FAIL', 'UNKNOWN'))
- `severity` text not null
- `title` text not null
- `explanation` text not null
- `observation_ids` uuid[] not null check (cardinality(observation_ids) >= 1)
- `fingerprint` text not null
- `evaluated_at` timestamptz not null

Unique `(run_id, fingerprint)`. No updates. No deletes.

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
- `payload` jsonb not null
- `actor_id` text null
- `occurred_at` timestamptz not null default now()

Unique `(aggregate_type, aggregate_id, sequence)`. Append-only.

### outbox

- `id` uuid primary key
- `idempotency_key` text not null unique
- `kind` text not null
- `payload` jsonb not null
- `created_at` timestamptz not null default now()
- `processed_at` timestamptz null

Lag metric: count of rows where `processed_at` is null. Expected zero in Builds 0 and 1.

## Indexes for claim

`run_steps (state, lease_expires_at)` plus `run_id` is sufficient for `FOR UPDATE SKIP LOCKED` claim. Claim SQL always joins `assurance_runs` to enforce eligible run state and absence of collect-cancel.
