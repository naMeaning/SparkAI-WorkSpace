# SparkAI Extension Repository Guide

## Product Boundary

This repository now owns one small service: `services/sparkai-extension`.

- The user's independently deployed stock New API remains authoritative for accounts, sessions, model API keys, channels, quota, billing, usage logs, and its web admin.
- SparkAI Extension owns only Pro device licenses and asynchronous image-task wrapping.
- Do not copy, patch, build, deploy, or fork New API as part of the active product.
- Do not accept a user Base URL or API key in the License API. Image-task Bearer keys may exist only in process memory long enough to forward one task to the configured private New API origin.

The historical `services/ai-gateway`, `services/crm-api`, `packages/crm-contracts`, and `deploy/production` trees are legacy cleanup inputs. Active root scripts and new code must not depend on them. Delete them only in a separately verified cleanup after the extension is deployed and backed up.

## Active Commands

Run from the repository root:

```bash
pnpm run dev
pnpm run build
pnpm run test
pnpm run check
pnpm run verify:workspace
```

License administration uses `SPARKAI_EXTENSION_URL` and `SPARKAI_EXTENSION_ADMIN_TOKEN`:

```bash
pnpm run license:create -- --name "Pro" --count 10 --valid-days 0 --max-devices 3
pnpm run license:list -- --page 1 --size 20
pnpm run license:disable -- --id 1
```

## Security And Reliability

- Keep `SPARKAI_EXTENSION_HASH_SECRET` stable and outside Git. Rotating it invalidates existing hashes.
- Route the worker to a loopback, Docker-network, or private New API origin that bypasses Cloudflare.
- Persist only SQLite and result files under the configured data directory. Never log or persist caller Bearer keys.
- Run one service replica. Queued/running tasks become failed after restart and are never replayed automatically.
- Use idempotency keys end to end. Do not recreate a task after an ambiguous create response.
- Do not run a real image request during tests without explicit authorization.

## Validation

Use `pnpm run check` for source syntax, isolated License tests, loopback image-task tests, workspace routing, and restart behavior. Deployment changes must also validate the Compose configuration and document the exact reverse-proxy order.
