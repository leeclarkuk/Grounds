# Grounds

An evidence-first platform operations control plane. It turns scoped runtime signals into deterministic findings and, later, policy-checked infrastructure pull requests that require exact human approval.

The product rule is: no change without grounds.

- Authorised scope and invariants: [AGENTS.md](AGENTS.md)
- Build-ready plan: [Grounds-Build-Ready-Plan.md](Grounds-Build-Ready-Plan.md)
- Binding amendments: [docs/decisions](docs/decisions/README.md)

## Build 0

This repository currently implements the Build 0 control-plane skeleton: domain types, PostgreSQL schema, lease-fenced workers, fake providers, and API liveness/readiness. It does not collect from AWS, run the ECS detectors, or serve Mission Control.

Requires Node.js 24 and pnpm 10. Integration tests start a disposable PostgreSQL 16 container.

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs format, typecheck, lint, unit tests, PostgreSQL integration tests, and the TypeScript build. There is no contract or end-to-end suite in this milestone.
