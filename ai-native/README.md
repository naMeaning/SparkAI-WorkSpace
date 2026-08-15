# SparkAI Extension

`ai-native` is now the lightweight extension service for SparkAI WorkSpace. It does not contain the active New API deployment and does not require a customized New API build.

Your existing stock New API continues to own accounts, model keys, channels, quota, billing, and usage. The extension adds only:

- Pro redemption codes and device activation under `/api/naimage/license/*`.
- Cloudflare-safe image jobs under `/v1/image-tasks/*`.

Public routing keeps both services on the same API hostname:

```text
/api/naimage/license/*  -> SparkAI Extension
/v1/image-tasks/*       -> SparkAI Extension
everything else         -> existing stock New API
```

The image worker calls the existing synchronous `/v1/images/generations` endpoint through a private origin. It retains the caller's model API key only in memory; SQLite stores an HMAC owner identity. A restart fails unfinished tasks without replaying them.

## Active structure

```text
services/sparkai-extension/   Node.js 24 HTTP service, SQLite, License admin page/CLI and tests
deploy/sparkai-extension/     Docker Compose and Caddy routing example
scripts/                      active workspace validation
```

Historical New API/CRM sources remain temporarily as cleanup input, but no root command builds or starts them. Remove them only after this service is deployed and its data backup/rollback path has been verified.

## Run and verify

```powershell
corepack pnpm run check
corepack pnpm run dev
corepack pnpm run package:extension
```

Configuration is documented in [`services/sparkai-extension/.env.example`](services/sparkai-extension/.env.example). Deployment steps are in [`deploy/sparkai-extension/README.md`](deploy/sparkai-extension/README.md).

After the reverse proxy is configured, open `/api/naimage/license/admin` on the public API hostname and enter `SPARKAI_EXTENSION_ADMIN_TOKEN`. The page can create permanent or time-limited codes, set the number of devices allowed per code, set a redemption deadline, inspect usage, and disable a code with all of its issued device licenses.

`package:extension` creates a standalone ZIP and TAR.GZ under `release/`. The bundle contains a deployment-specific root `AGENTS.md`, Docker-network Compose, both Caddy layouts, source checks, file manifests and SHA-256 sums. It never includes the legacy New API/CRM trees, local `.env`, databases or diagnostics.
