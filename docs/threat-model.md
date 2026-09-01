# Threat model

Scope: Builds 0 and 1. Read-only ECS assurance. No model provider, no MCP, no AWS mutation, no merge, no deploy, no public deployment.

## Trust boundaries

1. Browser to API (loopback by default).
2. API to PostgreSQL.
3. Worker to PostgreSQL.
4. Worker to AWS STS and read APIs.
5. CI to the repository.

The API and browser never receive AWS credentials. Detectors never see AWS SDK types.

## Assets

- Short-lived AWS credentials in worker memory.
- Authorisation grants and pinned run scope.
- Immutable observations and findings.
- Development actor identity.

## Threats and mitigations

| Threat                                | Mitigation                                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofed actor header                  | Development actor is server-configured. Client actor headers are ignored.                                                                                                                                                          |
| Grant replay / concurrent reuse       | Single-use consume, unique grant-to-run, expiry checked in SQL against `now()`.                                                                                                                                                    |
| Cross-scope collection                | Application deny before first provider call. Adapter rejects out-of-scope responses rather than filtering. Missing or unparsable service, cluster or target-group ARNs are out of scope, not a match.                              |
| Mutator AWS capability                | Exact static command allowlist. Architecture test. Dedicated IAM role, not `ReadOnlyAccess`.                                                                                                                                       |
| Credential leakage                    | Worker-only credentials. Redaction matches access-key ids and presigned URL parameters anywhere in a string, not only at position zero, including persist, AWS ingest, logs and closed error detail. No credentials in API errors. |
| Stale worker writes                   | Lease owner, epoch and expiry checked on every durable write.                                                                                                                                                                      |
| Cancel ignored                        | Cancel increments collect `lease_epoch` in the same transaction as run cancel.                                                                                                                                                     |
| Duplicate durable outcomes            | Grant uniqueness, run idempotency key, observation `(run_id, content_identity)`, finding `(run_id, fingerprint)`, event sequence uniqueness.                                                                                       |
| UNKNOWN hidden as healthy             | Mixed UNKNOWN cannot terminate `healthy`. Truncated, inaccessible or stale evidence needed to rule out FAIL is `UNKNOWN`, never `PASS`.                                                                                            |
| Injection via AWS strings             | Untrusted data. Never concatenated into SQL, shell or policy.                                                                                                                                                                      |
| Non-development anonymous API         | Process refuses to listen without `GROUNDS_IDENTITY_MODE=development` in this build.                                                                                                                                               |
| Deadlock at cancel or claim           | All multi-row transactions lock grant (enqueue only), then run, then collect step, then evaluate step.                                                                                                                             |
| Fake detector mistaken for ECS policy | `GRD-FAKE-001` is test-only, pinned on the fixture profile, and must not use Build 1 detector ids.                                                                                                                                 |

## Residual risk

- Development mode is not production identity. Binding the API to loopback is a default, not a substitute for OIDC/RBAC.
- Fixture AWS is the verified path. Optional live AWS smoke is out of CI and can still be mis-scoped by operator error; application and adapter checks still apply.
- PostgreSQL is trusted in v0.1. There is one organisation and no tenant isolation beyond `organisation_id` columns.
- No external penetration review has been done. Public deployment is forbidden until that review, OIDC, RBAC and CSRF protection exist.

## Out of scope for this document

Builds 2–6: investigation specialists, isolated Terraform, GitHub writes, scheduling, closed-loop verification.
