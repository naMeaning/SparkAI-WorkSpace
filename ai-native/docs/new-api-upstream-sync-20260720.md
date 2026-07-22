# New API upstream sync — 2026-07-20

## Scope

This release updates the embedded New API source without replacing the
IIIMAGE product shell, CRM integration, desktop download flow, or managed
image relay. Production is updated only through Forge `main` and the existing
watcher; no application files are edited directly on the server.

## Provenance

- Previous embedded upstream: `0b7ae4ea794682830e0216ec51ffb8c7b923ab6d`
- Previous upstream release line: `v1.0.0-rc.14-2`
- Integrated upstream: `5a6c53d4966b2e34690ab49f3dd19be01c88fdbe`
- Target release line: `v1.0.0-rc.21` plus 12 upstream commits
- IIIMAGE build version: `v1.0.0-rc.21+iiimage.20260720`
- Reviewed range: 175 commits and 1,143 changed paths
- Isolated semantic merge commit: `7f54fc3061f8a4a217236cad319f0d76feb6aa7c`

The merge was prepared outside the production checkout. All 206 textual
conflicts were resolved before the resulting New API tree was applied to this
repository.

## Material upstream changes

- Prevent duplicate streamed tool calls when converting Responses output to
  Chat Completions.
- Delete authentication records when an account is permanently deleted.
- Saturate quota calculations safely instead of overflowing large balances.
- Harden protected URL fetching and SSRF checks.
- Improve pre-consumption, settlement, image-stream disconnect handling, and
  multi-image billing.
- Discover models from Codex and advanced custom channels.
- Add system-task, system-instance, and authorization infrastructure.
- Move user sorting to the server and repair quota/table rendering edge cases.

## IIIMAGE behavior intentionally preserved

- The IIIMAGE `web/default` product UI remains the shipped frontend;
  `web/classic` remains absent.
- Homepage, authenticated desktop download, captcha, update, and client-event
  routes remain available.
- CRM routes, contracts, attribution, and managed relay behavior remain intact.
- Managed Image2 generation/edit idempotency and persisted replay state remain
  intact.
- The internal `crm-relay` token stays hidden from normal token listings.
- IIIMAGE branding and production routing are not replaced by upstream assets.

## Release safety

The deployment/rollback hardening is released as a separate operations-only
commit before this source update. This is required because the production
watcher invokes `deploy-main.sh` from the currently deployed checkout.

Before the source update was approved, a verified production SQLite backup was
tested in isolation:

1. The upgraded binary migrated the copied database and became healthy.
2. SQLite `PRAGMA quick_check` returned `ok`.
3. The previous deployed New API binary opened the migrated copy and became
   healthy.
4. A second `PRAGMA quick_check` returned `ok`.
5. All temporary processes and extracted production data were removed.

The reusable rehearsal is implemented in
`scripts/diagnostics/new-api-sqlite-compat-rehearsal.ps1`. It accepts explicit
backup and binary paths and emits only a redacted JSON result.

## Verification completed locally

- `pnpm run verify:workspace`
- `pnpm run check` (15 CRM contract tests; 139 CRM API tests passed, 2 skipped)
- `pnpm run build:gateway`
- `go test -mod=vendor ./...`
- Responses/Chat duplicate-tool-call regression tests
- Managed relay, hidden-token, desktop download/update, and managed image
  idempotency tests
- OpenAI image relay and full relay package tests
- Static assertions for IIIMAGE custom routes and security boundaries
- `git diff --check`

Production acceptance additionally verifies container health, `/iiimage/v1`
model access, Responses tool-call behavior, managed Image2 generation/edit,
CRM usage attribution, and that the website still distributes the signed
iiimage Studio `1.0.3` release.
