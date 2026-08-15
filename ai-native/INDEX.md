# Repository Index

## Active entry points

- `services/sparkai-extension/src/main.mjs`: service process entry.
- `services/sparkai-extension/src/license-service.mjs`: redemption codes and device licenses.
- `services/sparkai-extension/src/image-task-service.mjs`: in-process queue and private New API forwarding.
- `services/sparkai-extension/src/license-admin.mjs`: operator CLI.
- `deploy/sparkai-extension/`: standalone deployment and same-domain routing.
- `scripts/verify-workspace.mjs`: prevents active root scripts from returning to the legacy fork.

## Legacy cleanup boundary

`services/ai-gateway`, `services/crm-api`, `packages/crm-contracts`, and `deploy/production` are no longer active runtime inputs. They remain temporarily so cleanup can occur after a verified extension deployment rather than as an unreviewed broad deletion.
