# ADR-0003: Identity, grants and credential boundaries

Status: Accepted
Date: 2026-08-31
Milestone: Build 0 (schema and test actor), Build 1 (HTTP identity and grants)

## Context

The plan requires authorisation to be an object and forbids credentials in the API or browser. The first architecture gate rejected a client-supplied actor header as authentication, and rejected grants that did not bind organisation, evidence window, detector versions or single-use consumption.

## Decision

### Identity

- `GROUNDS_IDENTITY_MODE=development` is the only mode authorised in Builds 0 and 1.
- The development actor is `GROUNDS_DEV_ACTOR_ID`, configured on the server. The API ignores `X-Grounds-Actor` and any other client-supplied actor header.
- If `GROUNDS_IDENTITY_MODE` is unset, empty, or anything other than `development`, the API refuses to listen. There is no silent anonymous fallback.
- Build 0 tests inject the development actor through the application service, not HTTP headers.

### Grants

A grant is an immutable, expiring, single-use object. It binds:

- `organisation_id`
- `actor_id`
- `profile_version_id`
- `resource_scope_digest`
- `evidence_window`
- `detector_versions` copied from the profile at grant creation
- `action = assurance_run`
- `granted_at`, `expires_at`

`POST /v1/runs` consumes the grant in one statement equivalent to:

```sql
UPDATE authorisation_grants
SET consumed_at = now()
WHERE id = $1
  AND consumed_at IS NULL
  AND expires_at > now()
RETURNING *;
```

`assurance_runs.authorisation_grant_id` is unique. Concurrent reuse fails. Expired grants fail. The evidence window is chosen at authorisation time and cannot be widened later.

Scope is validated in application code before any provider port is called. The worker re-validates the pinned run scope before the first adapter call.

### Credentials

- Only the worker process may load AWS credentials or depend on `adapter-aws`.
- The API and web app must not import `adapter-aws` or read AWS session environment.
- Sessions are assumed with an external ID and a short duration (900 seconds). Credentials stay in worker memory.
- Credentials never enter logs, events, observations, prompts or browser responses.

### Trust

AWS responses, tags, names and log-like strings are untrusted data. They are never concatenated into SQL, shell or policy expressions.

## Consequences

- Local Mission Control uses the API's server-configured actor. There is no browser-side identity picker in v0.1.
- Production OIDC/RBAC remains a Build 5 concern. A non-development start fails until that work is authorised and implemented.

## Tests required

- Spoofed actor header is ignored; the server actor is used.
- Non-development start refuses to bind a listen port.
- Concurrent grant consumption creates one run.
- Expired grant cannot enqueue.
- Grant for service A cannot enqueue a run for service B, another account or another region.
- Out-of-scope request makes zero provider calls.
