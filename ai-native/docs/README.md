# Docs Index

This directory contains current design and operations documents for the unified
product.

## Current Source Of Truth

Use
[`new-api-centered-crm-monorepo-governance.md`](new-api-centered-crm-monorepo-governance.md)
as the active product architecture and repository governance source of truth.

Current detailed design and rollout docs:

- [`unified-new-api-crm-design.md`](unified-new-api-crm-design.md)
- [`unified-new-api-crm-implementation.md`](unified-new-api-crm-implementation.md)

The current direction is:

- `new-api` is the account, session, role, quota, model routing, and billing
  execution source of truth.
- CRM is an internal distribution module in `naimage`, not a separate
  browser product.
- The unified frontend can call New API native APIs and CRM distribution APIs.
- The root monorepo stays organized around `services/*` and `packages/*`.
- The embedded `new-api` frontend is the only GUI.
- CRM only adds distribution, ledger, risk, and operations capabilities.

Use [`crm-production-runbook.md`](crm-production-runbook.md) for production
deployment and smoke-check operations.

Use [`crm-ui-mobile-validation.md`](crm-ui-mobile-validation.md) for repeatable
desktop/mobile browser screenshots, overflow checks, and CRM dialog validation.

The executable deployment source of truth, including Docker Compose, Caddy,
installer verification, auto-deploy, and SSH/Fail2ban hardening, is
[`../deploy/production`](../deploy/production/README.md).
