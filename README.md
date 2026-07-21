# WooCommerce Cloud Platform

Phase 0 monorepo scaffold for the WooCommerce Cloud Platform. The repository is
organized by domain boundaries from `Blueprint/03-DDD.md`; implementation is
intentionally deferred until the foundation contracts are reviewed.

## Layout

- `apps/` contains deployable applications, including the Go Agent.
- `packages/` contains shared libraries and contracts.
- `platform/` contains SaaS control-plane bounded contexts.
- `runtime/` contains WordPress distribution and data-plane components.
- `infra/`, `docs/`, and `scripts/` contain operations, contracts, and tooling.

The draft distribution manifest is in `runtime/distribution/`, and the draft
Agent API contracts are in `docs/api/`.
# ooio
