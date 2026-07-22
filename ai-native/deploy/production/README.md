# Production deployment

This directory is the source of truth for `image.aieyra.cn` deployment and host hardening. Runtime secrets, the Windows installer, deployment state, logs, and backups live under `runtime/`, which is intentionally ignored by Git.

## Runtime layout

1. Copy `.env.example` to `runtime/.env` and fill the existing production secrets.
2. Put every installer/restart artifact named by the tracked
   `releases/desktop-release.json` in `runtime/releases/`.
3. Run `./verify-installer.sh` before building.
4. Run `./deploy-main.sh` to build, health-check, reload Caddy, and run the application-level production acceptance gate.
5. Run `./verify-production.sh` after deployment for the complete read-only acceptance check.

Every full application deployment creates a transactional CRM SQL backup and runs `./verify-crm-backup.sh` before migrations. The verifier only accepts backup files inside `runtime/backups`, restores into a uniquely named temporary database, requires every core table and the migration history, runs `CHECK TABLE`, and removes the temporary database before the deployment can continue. It can also be run manually without an argument to verify the newest CRM backup.

Deployments are component-aware. A New API-only diff builds, backs up, and
switches only New API; it does not rebuild CRM, run MySQL migrations, or restart
the CRM service. CRM migration and backup work runs only when CRM/shared paths
are part of the pending diff.

The New API container has no published host port. Caddy reaches it through the external `forgejo` Docker network, and `TRUSTED_PROXIES` explicitly trusts only that network. The installer directory is mounted read-only.

`verify-installer.sh` validates the manifest schema, release identity, versioned
artifact names, sizes, SHA-256 digests, and its Ed25519 signature against the
same tracked public key embedded by iiimage Studio. `deploy-main.sh` verifies
the tracked candidate before touching runtime state and promotes it atomically
only after application and Caddy work succeeds. A failed final acceptance check
now restores the prior runtime manifest and Caddyfile. For a New API-only
release it also restores the pre-switch SQLite database and
`managed-image-idempotency` directory, retags the preserved previous container
image, and waits for the previous New API service to become healthy. The
production checkout intentionally remains at the target commit so every retry
runs the hardened deployment code; the deployed-state marker remains at the
previous successful application commit and causes the watcher to retry without
leaving the failed application live.

Before preserving or building any New API image, the deployer atomically writes
`runtime/manual-recovery-required.env` with
`reason=new-api-deployment-in-progress`. This is a crash/power-loss guard: a
later watcher invocation fails closed while the sentinel exists instead of
guessing whether SQLite, the managed image directory, or the image tag was
partially switched. The sentinel is removed only after full deployment
acceptance or after a verified complete rollback. Failed or incomplete recovery
keeps (or atomically updates) the sentinel for operator review.

CRM migrations remain forward-only. The automatic watcher therefore refuses a
pending diff that touches CRM/shared contract paths before it advances the
checkout or changes runtime state. It records
`runtime/manual-recovery-required.env` with the deployed and target commits for
an operator-reviewed release. While this sentinel exists, automatic deployment
fails closed before fetching or changing runtime state; an operator must review
the recorded evidence and explicitly remove it. If a manually initiated CRM migration ever fails
after DDL may have committed, the same sentinel preserves the backup and image
references and the script does not claim an automatic rollback.

Before merging an application release, inspect the component and rollback plan:

```bash
./deploy-main.sh --plan
./deploy-main.sh --self-test
```

`--plan` fetches Forge metadata and classifies the pending diff without changing
the checkout, database, containers, Caddyfile, release manifest, or deployed
state. `--self-test` exercises the pure path-classification and rollback-policy
state machine.

The rollback hardening must be released before the New API source upgrade. The
watcher starts `deploy-main.sh` from the currently deployed checkout, so a
single commit containing both a new deploy script and application source would
still execute under the old in-memory script. Publish the hardening changes
(`deploy-main.sh`, `backup-new-api-state.sh`, `verify-new-api-backup.sh` and this
runbook) as an operations-only commit, verify that commit is deployed, and only
then merge the New API upgrade.

The production checkout must remain on `main` and its `origin` must be the
trusted local Forge repository. Both deployment and acceptance scripts reject a
different branch or remote before application state is changed.

Production base images are pinned by digest. Upgrading Node, MySQL, Bun, Go, Debian, or the Caddy validation image is therefore an explicit reviewed release change instead of an implicit tag drift during a later rebuild.

The CRM and New API containers run with `no-new-privileges`, all Linux capabilities dropped, and a bounded PID budget. The production acceptance script checks both the Docker configuration and PID 1's effective capability mask after every deployment.

## Download security

The homepage sends anonymous users to login and returns them to the download dialog. An authenticated user must solve a new raster captcha for each authorization. Challenges and tickets are short-lived and bound to user, signed session, IP, and User-Agent. Successful authorizations are persistently audited and limited by both user and IP rolling hour/day windows.

## Desktop client events

`POST /api/desktop-client/events` accepts authenticated, rate-limited desktop
health metadata. Its schema intentionally allows only a stable event name,
application version, Windows/x64 platform fields, release channel, component,
stable error code, bounded duration, and an aggregate count. It does not accept
or persist prompts, image paths, project names, raw error text, machine IDs, or
arbitrary log bodies. Records use the existing New API system-log source so
operators can review them without duplicating identity or telemetry data in CRM.
Desktop download, update, telemetry, and managed Agent relay requests also
re-read the current New API user status, so an account disabled by an operator
is rejected on its next request even if an older browser session still exists.

## Host hardening

Run `security/harden-host.sh` only from an already verified SSH key session. It creates a timestamped backup in `runtime/backups`, validates SSH and Fail2ban configuration before reload, retains root key login, disables password login, and enables a conservative SSH jail. Keep a second SSH key session open until a new connection succeeds.

## Production acceptance

Run `./verify-production.sh` as root after a release or infrastructure change. It does not modify application data or deployment state. It fails closed unless the project checkout, Forge `main`, and deployed commit agree; the installer and database backup are present; Compose, Caddy, containers, private ports, automatic deployment, SSH, Fail2ban, disk headroom, public endpoints, download authorization boundaries, security headers, and TLS certificate all pass. `deploy-main.sh` automatically runs the same gate after a deployment while explicitly skipping only the watcher and host-security prerequisites needed during initial bootstrap; if that gate fails, it restores the previous deployment-state marker so the watcher retries instead of recording a false success.

The full acceptance check also compares the installed systemd watcher unit with the version in this directory and rejects a pending `daemon-reload`, preventing an edited unit file from being mistaken for the configuration that is actually running.

The deployment script conservatively classifies a small, explicit allowlist of documentation, diagnostics, and production-operations files as operations-only. Those commits still run Caddy synchronization and the complete application-level acceptance gate, but skip image builds, database migrations, and container restarts. New API paths use the isolated New API backup/build/switch flow. CRM, shared, unknown, and `FORCE_BUILD=1` releases fail closed into the manual-review sentinel instead of silently broadening an automatic deployment.
