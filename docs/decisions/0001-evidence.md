# ADR-0001: Evidence identity, freshness and UNKNOWN

Status: Accepted
Date: 2026-08-31
Milestone: Build 0 (schema and fakes), Build 1 (collectors and detectors)

## Context

The build-ready plan requires immutable, time-bounded, content-addressed observations. The first architecture gate found the identity, truncation and citation rules underspecified. A globally unique content identity without organisation or run relationship either leaks across tenants or blocks a second run from citing its own evidence. Byte-slicing JSON above 1 MiB can produce invalid payloads. Missing collectors had no immutable record for `UNKNOWN` to cite.

## Decision

1. Observations are run-scoped. Uniqueness is `(run_id, content_identity)`. `organisation_id` is stored on the row and included in digest inputs. v0.1 does not reuse observation rows across runs.
2. `content_identity` is SHA-256 over RFC 8785 canonical JSON of: `organisationId`, `kind`, `resource`, `window`, `source.operation`, `payloadDigest`, `redactionVersion`. Canonicalisation uses RFC 8785 with checked-in test vectors. PostgreSQL `now()` is the clock for `collectedAt`, freshness, grant expiry and leases.
3. Redact before digest and before persist. Never persist credentials, request signatures, environment variables or unredacted log lines. Access-key ids (`AKIA`/`ASIA`) and presigned-URL parameters (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-SignedHeaders`) match anywhere in a string, not only at position zero. The same rule applies at observation persist, event persist, AWS ingest, logs and errors.
4. Oversize input is not byte-sliced. If the redacted canonical payload exceeds 1 MiB, persist a bounded envelope `{ "truncated": true, "originalByteLength": n, "fullPayloadDigest": "..." }` and mark the observation truncated. Required truncated evidence yields `UNKNOWN`.
5. Freshness is `FRESH` or `STALE` against the pinned profile freshness policy. Detectors treat stale required evidence as `UNKNOWN`.
6. Inaccessible, partial, throttled-out or schema-invalid collector results persist as a normalised failure observation (`inaccessible: true` or equivalent kind) so every finding, including `UNKNOWN` and `PASS`, can cite at least one observation id.
7. Contradiction is detector-specific and yields `UNKNOWN`, never `PASS`. Examples: service target group does not match the inspected group; target-health response is for a different group; described running count disagrees with described running tasks.
8. `profile_versions` are insert-only. A database trigger rejects `UPDATE` and `DELETE`. Detector versions are constants copied onto the run at enqueue, not chosen by the client.
9. Observations, findings and events are append-only. Database triggers reject `UPDATE` and `DELETE`. Grants may change only by the single `consumed_at` null-to-timestamp transition; every other grant column is immutable.
10. Finding citations are rows in `finding_citations`, not an unconstrained uuid array. Each citation foreign-keys the finding and the observation through `(id, run_id)` so a finding cannot cite a missing observation or an observation from another run.

## Consequences

- Replay inside one run is an insert conflict on `(run_id, content_identity)`, keeping the original row.
- A second run of the same service stores its own observations for its own window.
- Truncation cannot produce a PASS from partial JSON.
- Build 0 fakes must be able to emit inaccessible and truncated observations, not only happy-path payloads.

## Tests required

- RFC 8785 vectors and stable SHA-256 digests.
- Redaction-before-digest: a secret in the raw payload, including a mid-string or suffix access-key id, must not appear in payload digest inputs, stored JSON or events.
- Bounded envelope for oversize input; required truncated evidence is `UNKNOWN`.
- Same content in one run inserts once; a second run may insert the same logical content under a different `run_id`.
- Cross-organisation isolation: organisation id participates in the digest and in queries.
