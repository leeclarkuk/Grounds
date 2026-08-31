# ADR-0007: Build 1 implementation amendments

Status: Accepted
Date: 2026-08-31
Milestone: Build 1

## Context

The Build 1 architecture gate blocked the first implementation proposal. Build 0 remains a sound schema and control-plane base for a stacked PR: fencing, enqueue, grants, and fake evaluation already exist. The gate found holes that would make freshness, clock authority, evidence scope, HTTP idempotency, credential bootstrap and multi-detector replay unverifiable. This ADR records the amendments. It does not add product scope beyond authorised Build 1.

## Decision

### 1. PostgreSQL remains the only claim clock

`claimWork` SQL already filters with `now()`. The in-memory `stepIsClaimable` helper must not use `Date.now()`. After the run and steps are locked, eligibility is re-checked against a single `SELECT now()` from that transaction. A test must freeze or skew the process clock while PostgreSQL time remains authoritative and still claim, retry and expire leases correctly.

### 2. Freshness is computed at persist against PostgreSQL `now()`

`CollectorObservation` carries:

- `kind`, `payload`, `inaccessible`, `operation`, `adapter`
- `requestDigest` supplied by the adapter (canonical JSON of operation, resource, window, and the request query including dimensions and pagination cursor)
- optional `observedAt` for metric evidence (the newest datapoint timestamp in the window)

Persistence sets `collected_at = now()`. Freshness:

- point-in-time inventory (no `observedAt`): `FRESH` when `now() - collected_at < freshnessMaxAgeSeconds`, otherwise `STALE` (at insert this is `FRESH` unless the policy is zero)
- metric evidence: `STALE` when `observedAt` is missing, or `now() - observedAt >= freshnessMaxAgeSeconds`, or there are no datapoints
- truncated required payloads remain unusable and yield `UNKNOWN`

The Build 0 branch that marked every observation `FRESH` whenever `freshnessMaxAgeSeconds > 0` is removed.

### 3. Migration `0003_build1_constraints`

Do not edit `0002`. `isSchemaReady` requires `0003`. The migration:

1. Adds a constraint trigger so an observation’s `organisation_id`, `resource` JSON and evidence window equal the parent run.
2. Adds a constraint trigger so a finding’s `resource` JSON equals the run, `profile_version_id` equals the run, and `(detector_id, detector_version)` is present in the run’s pinned `detector_versions`.
3. Creates `http_idempotency`:

   - `id` uuid primary key
   - `organisation_id` text not null
   - `actor_id` text not null
   - `method` text not null
   - `route` text not null
   - `client_idempotency_key` text not null
   - `request_digest` text not null
   - `response_status` integer not null
   - `response_body` jsonb not null
   - `created_at` timestamptz not null default now()
   - unique `(organisation_id, actor_id, method, route, client_idempotency_key)`
   - trigger: reject `UPDATE` and `DELETE`

All HTTP write routes (`POST /v1/authorisations`, `POST /v1/runs`, `POST /v1/runs/:id/cancel`) record this row in the same transaction as the domain write. Same key and digest replays the stored status and body. Same key and different digest returns RFC 9457 `409`. Grant and run unique `client_idempotency_key` columns remain as domain uniqueness.

### 4. Request digest, normalisation and observation events

`requestDigest` must change when scope, evidence window, metric dimensions, alarm query or pagination cursor change. Tests must prove that.

Collector payloads are deterministically normalised: sorted identifiers, dimensions, alarm actions and datapoints. Inaccessible payloads are `{ "inaccessible": true, "complete": false, "errorCode": <closed set> }` with no provider message, stack or secret. Closed `errorCode` values: `throttled`, `timeout`, `unavailable`, `denied`, `incomplete`, `invalid`.

Every newly inserted observation appends an event in the same fenced transaction. Payload is operation, request digest, payload digest, content identity, freshness and accessibility. Never the raw observation payload or credentials. Duplicate content identity does not append a second event (`operation_id` = `observe:<run_id>:<content_identity>`).

### 5. Credential bootstrap sequence

Before any STS or collector call the worker validates the pinned run against the immutable profile: organisation, account, region, cluster, service name, resource type and detector pin set.

Then, and only then:

1. `AssumeRole` with a required external ID and session duration exactly 900 seconds.
2. `GetCallerIdentity`.
3. If the caller account does not equal the authorised `accountId`, fail the step as `invariant_violation` with no collector calls.
4. Collectors run.

STS calls count as provider calls. An unapproved service makes zero provider calls, including AssumeRole and GetCallerIdentity.

Bounded credential or API unavailability (`AssumeRole` denied/unavailable, identity timeout, collector timeout/throttle exhaustion) persists same-kind inaccessible observations for every required kind and completes collect so evaluation can return cited `UNKNOWN`. Caller-account mismatch and out-of-scope collector responses remain immediate `invariant_violation` and are not filtered.

Fixture AWS lives in `packages/adapter-aws`. It uses the same validators, scope checks and normalisers as live AWS and must not construct SDK clients. Build 0 generic fakes stay in `packages/test-support`.

### 6. Ports

Replace `describeInventory` / `getTelemetry` with `collect(CollectContext)`. Do not keep parallel legacy methods.

`CollectContext` is `{ scope, window, onPage }`. `onPage` is the application heartbeat plus cancel/fence check. Adapters call it after every page and before return.

### 7. Resource identity

ECS `resourceId` is `{clusterName}/{serviceName}`: exactly one separator. Each name matches the AWS name grammar `^[A-Za-z0-9_-]{1,255}$`. Validation happens before any provider call. Cluster is not a new `ResourceRef` field.

Build 0 fixture service becomes `payments-cluster/payments`.

### 8. Identity, grants and evidence window (HTTP)

Development identity is server-configured:

- `GROUNDS_IDENTITY_MODE=development` (refuse to listen otherwise)
- `GROUNDS_DEV_ACTOR_ID`
- `GROUNDS_DEV_ORGANISATION_ID`

Client actor and organisation headers are ignored. Grant creation requires a same-organisation immutable profile, exact equality with the profile scope, detector versions copied from the profile (never the client), PostgreSQL-timed five-minute expiry (`expires_at = now() + 5 minutes`), and a historical evidence window with `to <= now()`, `from < to`, and duration at most one hour.

### 9. Detector registry and atomic evaluation

A Build 1 profile pins exactly `GRD-ECS-001` version `1` and `GRD-OBS-001` version `1`. A fake profile pins only `GRD-FAKE-001` version `1`. Mixed or empty pin sets are `invariant_violation` at enqueue and at evaluate, before writing findings.

Evaluate loads observations, resolves every pinned detector, computes every finding in memory, then in one fenced transaction persists all findings and citations and the terminal run transition. Unknown detector ids fail before any finding insert.

On `(run_id, fingerprint)` conflict, the existing row must match result, detector id/version, title, explanation, citation count and citation set. A mismatch is `invariant_violation`. Duplicate replay must load persisted citation ids, not the inbound list.

### 10. Target groups and GRD-OBS-001 cluster isolation

The GRD-ECS-001 fingerprint `condition` is:

```ts
{
  targetGroupSetDigest: string,
  healthCheckPath: string | null,
  matcher: string | null,
  failClause: "replacement" | "deficit" | "both" | null
}
```

`targetGroupSetDigest` is SHA-256 of RFC 8785 canonical JSON of the sorted unique target-group ARNs attached to the service. Zero or more than one attached target group makes GRD-ECS-001 `UNKNOWN`. Collectors do not pick a group silently.

GRD-OBS-001 ECS coverage requires both `ClusterName` and `ServiceName` dimensions matching the inspected resource. Service name alone is not coverage.

When the service has zero or multiple target groups, GRD-OBS-001 may `PASS` only if a covering `AWS/ECS` `RunningTaskCount` alarm exists with exact ClusterName and ServiceName. Otherwise it returns `UNKNOWN`, not `FAIL`. UnHealthyHostCount coverage requires the unique inspected target group.

Alarm inventory is complete only when `DescribeAlarms` pagination finishes without error, truncation or a documented page bound being hit. Hitting the bound yields `complete: false` and `UNKNOWN`.

GRD-OBS-001 wording claims configured alarm actions (non-empty `AlarmActions` ARN). It must not claim owner notification, SNS subscriptions or human delivery.

### 11. Verify, scans and SBOM

`pnpm verify` runs format, typecheck, lint, unit, integration, contract, e2e and build. Optional live AWS smoke is a documented script and is not in verify.

CI also runs dependency, secret and licence scans and produces an SBOM artefact. Failure of those scans fails verify. They are non-destructive.

## Tests required

In addition to the Build 1 matrix in the plan and ADR-0005:

- process-clock skew cannot hide a PostgreSQL-due retry or expired lease
- freshness: stale metric datapoints, missing datapoints, inventory at insert
- request digest changes with scope, window, dimensions and query
- shuffled AWS/fixture ordering still normalises identically
- incomplete alarm pagination and page-bound exhaustion are UNKNOWN
- AssumeRole failure yields inaccessible observations and UNKNOWN, not `failed`
- caller-account mismatch is `invariant_violation` with no collector calls
- external ID required; session duration 900 seconds
- unapproved service: zero provider calls including STS
- atomic multi-detector persist; conflicting fingerprint replay fails
- zero, one and multiple target groups
- alarm for the same service name in another cluster is not coverage
- concurrent idempotency on all three HTTP write routes
- worker child-process death after observation insert, restart, no duplicates
- cancel during pagination: no observation or step commit after cancel
- observation events contain provenance and never raw payloads
- architecture allowlist plus mutator-family rejection; `EnableAlarmActionsCommand` rejected
- dependency, secret and licence scans; SBOM produced

## Consequences

- Build 0 integration fixtures update `resourceId` to `payments-cluster/payments`.
- Fake ports implement `collect(CollectContext)`.
- Only `apps/worker` depends on `adapter-aws`.
- ADR-0005 fingerprint `targetGroupArn` is superseded by `targetGroupSetDigest` for GRD-ECS-001. Coverage rules for GRD-OBS-001 gain mandatory ClusterName. The detector boolean meaning is otherwise unchanged.
- No cases, outbox writes, models, MCP, scheduling, AWS mutation, repository writes, merge or deployment enter this milestone.
