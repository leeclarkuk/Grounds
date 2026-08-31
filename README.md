# Grounds

An evidence-first platform operations control plane. It turns scoped runtime signals into deterministic findings and, later, policy-checked infrastructure pull requests that require exact human approval.

The product rule is: no change without grounds.

- Authorised scope and invariants: [AGENTS.md](AGENTS.md)
- Build-ready plan: [Grounds-Build-Ready-Plan.md](Grounds-Build-Ready-Plan.md)
- Binding amendments: [docs/decisions](docs/decisions/README.md)
- Local operator runbook: [docs/runbooks/local-operator.md](docs/runbooks/local-operator.md)

## Build 1

This repository implements Build 0 and Build 1: the durable control plane, a read-only AWS adapter, `GRD-ECS-001` and `GRD-OBS-001`, HTTP write routes, and the three Mission Control screens. It does not mutate AWS, open pull requests, or deploy.

Disposable Postgres is started with Testcontainers by default. Set `GROUNDS_TEST_DATABASE_URL` to use an already-running server instead.

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs format, typecheck, lint, unit, integration, contract, end-to-end fixture tests, SBOM, secret and licence scans, and the build. Live AWS is optional and out of CI.
