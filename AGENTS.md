# Grounds Repository Instructions

## Purpose

Grounds is an evidence-first platform operations control plane. It turns authorised, time-bounded runtime evidence into deterministic assurance results. Later milestones may prepare governed infrastructure pull requests, but the current build is read-only.

The product rule is: **no change without grounds**.

Read `Grounds-Build-Ready-Plan.md` in full before planning or editing. Treat its binding invariants and milestone boundaries as acceptance criteria.

## Current authorised scope

Implement Build 0 and Build 1 only:

- the durable PostgreSQL control-plane skeleton;
- explicit run and step state machines;
- leases, heartbeats, lease-epoch fencing, retries and deterministic replay;
- immutable evidence, append-only events and idempotency;
- a least-privilege, read-only AWS adapter for one allowlisted ECS service;
- deterministic `GRD-ECS-001` and `GRD-OBS-001` detectors;
- the three-screen Mission Control UI; and
- the complete fixture, integration and end-to-end test matrix.

Do not begin Build 2 or later work unless the user explicitly authorises it in a new request.

## Agent operating model

The main Cursor agent using Grok 4.6 High is the sole writer and owns the build.

- Invoke `/architecture-reasoning` before implementing a milestone or changing domain, workflow, evidence, persistence, security or provider boundaries.
- Invoke `/independent-reviewer` after implementation and verification, and again after material fixes.
- Both specialists use **Composer 2.5** (configured in `.cursor/agents/`) and are read-only. Do not ask them to edit files, commit code or change external state.
- Do not create more custom subagents unless a new, distinct trust boundary appears and the user approves it.
- Use Cursor's built-in Explore, Bash and Browser agents for their intended work instead of duplicating them.

If a configured specialist model is unavailable or Cursor falls back to another model, stop and report the actual model. Do not quietly treat a substitute as the required architecture or release review.

## Binding engineering rules

1. Direct, normalised provider observations are the source of truth.
2. Detectors are deterministic and return `PASS`, `FAIL` or `UNKNOWN`.
3. Missing, stale, inaccessible or contradictory required evidence returns `UNKNOWN`, never `PASS`.
4. Every result, including `PASS`, cites immutable observations.
5. Runs pin profile version, resource scope, evidence window and detector versions.
6. AWS SDK types do not cross the adapter boundary.
7. Only the worker may receive short-lived AWS credentials.
8. Scope is validated before the first provider call. Out-of-scope responses are rejected.
9. No state-changing AWS SDK command may exist in the adapter dependency graph.
10. No raw shell or AWS CLI is exposed to a model.
11. Every durable step commit is protected by expected state and `lease_epoch`.
12. Retry, replay and worker death must not duplicate runs, observations, findings, events or external intent.
13. Credentials and unredacted sensitive data never enter logs, events, observations, prompts or browser responses.
14. Builds 0 and 1 cannot mutate AWS, edit infrastructure repositories, open pull requests, merge or deploy.
15. Do not add AWS DevOps Agent, MCP, model routing, Terraform remediation or autonomous scheduling to the authorised build.

## Code and repository rules

- Use Node.js 24, pnpm workspaces and strict TypeScript.
- Do not introduce unchecked `any` or suppress type errors to make a check pass.
- Keep domain and application packages independent of frameworks and provider SDKs.
- Put external validation at HTTP, configuration, database and provider boundaries.
- Use explicit SQL migrations. Never edit an applied migration; add a new one.
- Store normalised evidence, not arbitrary terminal output.
- Pin executable dependencies. Do not use `@latest`.
- Keep changes within the current milestone. Avoid speculative abstractions for later builds.
- Update ADRs, threat model and runbook when behaviour or a boundary changes.
- Never weaken, skip or delete a test to obtain a green build without documenting and fixing the underlying defect.

## Required top-level commands

The repository must provide these stable scripts as they become applicable:

- `pnpm format:check`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:contract`
- `pnpm test:e2e`
- `pnpm build`
- `pnpm verify`, which runs every required non-destructive release check

Tests that require PostgreSQL must use a disposable Testcontainers or Compose database and must not depend on a developer's existing data.

## Working method

1. Inspect the repository, current diff and relevant plan section before editing.
2. State the milestone and acceptance criteria being implemented.
3. Obtain the architecture verdict when required.
4. Make the smallest coherent change.
5. Run the narrowest relevant checks, then `pnpm verify` before review.
6. Record exact commands and exit statuses.
7. Run the independent review.
8. Fix every Critical and High finding without weakening verification, then re-review.
9. Stop at the authorised milestone boundary.

## Completion standard

File presence is not evidence of completion. Completion requires reproducible behaviour from a clean clone, passing real PostgreSQL concurrency and crash-recovery tests, deterministic fixture outcomes, cited evidence, zero provider calls for rejected scope, no mutator command in the AWS adapter and an independent reviewer `PASS` with no Critical or High findings.

If an acceptance criterion cannot be proved, report it as not evidenced. Do not relabel partial work as complete.

