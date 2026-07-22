# Repository Guide

This repository is now organized around one delivered product: `IIIMAGE STUDIO`.

## Product Boundary

- Unified backend entry: `services/ai-gateway`
- Embedded New API source: `services/ai-gateway/new-api`
- Unified frontend GUI: `services/ai-gateway/new-api/web/default`
- Internal CRM service: `services/crm-api`
- Shared CRM contracts: `packages/crm-contracts`
- Shared runtime helpers: `packages/shared`

## Commands

Run commands from the repository root.

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run check
```

Important scripts:

- `pnpm run dev` / `pnpm run start`: start the unified local stack.
- `pnpm run dev:main`: explicit unified local stack entry.
- `pnpm run build`: build the unified product.
- `pnpm run check`: verify workspace, CRM contracts, CRM API, and gateway smoke.
- `pnpm run crm:check`: check only the internal CRM API.

## Architecture Rules

- `services/ai-gateway` is the only public backend entry.
- `services/crm-api` remains an internal backend component and is reached through the New API CRM proxy in normal product use.
- `services/ai-gateway/new-api/web/default` is the only GUI.
- Do not add a second CRM frontend.
- Do not add root scripts that make CRM or image studio look like separate products.
- Product identity, roles, sessions, quota, model billing, and usage logs belong to New API.
- The unified GUI may call New API native APIs and CRM distribution APIs; do not duplicate New API native capabilities in CRM API.
- Keep CRM shared DTOs and constants in `packages/crm-contracts` before consuming them from `crm-api` or the New API frontend.
- Keep generic shared helpers in `packages/shared`; do not place business DTOs there.

## Generated And Runtime Files

Do not commit runtime data, build output, logs, diagnostics, binaries, or vendored generated dependency folders. Important generated/runtime paths include:

- `logs/`
- `.diagnostics/`
- `services/ai-gateway/config/`
- `services/ai-gateway/.diagnostics/`
- `services/ai-gateway/new-api/bin/`
- `services/ai-gateway/new-api/vendor/`
- `services/ai-gateway/new-api/logs/`
- `services/ai-gateway/new-api/data/`
- `services/ai-gateway/new-api/upload/`
- `services/ai-gateway/new-api/web/*/dist/`
- `services/crm-api/data/`

## Validation

Before pushing structural changes, run:

```bash
pnpm run verify:workspace
pnpm run check
```

If Go backend routes or controllers changed, also run the targeted New API build/test commands relevant to the change.
