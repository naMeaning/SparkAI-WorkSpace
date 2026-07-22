# Repository Index

The repository is structured around one product: `IIIMAGE STUDIO`.

## Top Level

```text
services/
  ai-gateway/
  crm-api/
packages/
  crm-contracts/
  shared/
scripts/
docs/
```

## Primary Entry Points

- `package.json`: root scripts for the unified product.
- `scripts/dev-main.mjs`: starts the local New API gateway and internal CRM API together.
- `scripts/diagnostics/crm-ui-audit.mjs`: captures repeatable desktop/mobile UI evidence without storing credentials.
- `services/ai-gateway/server.cjs`: builds and starts the embedded New API runtime.
- `services/ai-gateway/new-api/`: Go backend and IIIMAGE STUDIO frontend.
- `services/ai-gateway/new-api/web/default/`: only frontend GUI.
- `services/crm-api/src/scripts/dev-memory.ts`: internal CRM API for local unified development.

## Important Packages

- `@ai-native/ai-gateway`: public backend entry and New API launcher.
- `@ai-native/crm-api`: internal CRM business service.
- `@ai-native/crm-contracts`: shared CRM DTOs, enums, and stable business constants.
- `@ai-native/shared`: generic shared runtime helpers.

## Structure Boundary

Do not add product code under a root `apps/` directory. The active GUI lives under the embedded New API frontend.
