# naimage final merge, deployment, and E2E checklist

This is the release-owner runbook for the unified `ai-native` backend, CRM,
desktop download, and managed Agent gateway. It deliberately separates client
artifact freezing from server deployment so an incomplete installer can never
become the public update target.

## 1. Fixed production topology

The only supported automatic path is:

```text
developer clone
  -> ssh://git@git.aieyra.cn:2222/aieyra/ai-native.git
  -> Forge main
  -> /opt/forgejo/data/git/repositories/aieyra/ai-native.git
  -> /opt/iiimage/src (main)
  -> iiimage-ai-native-sync.service
  -> deploy/production/watch-main.sh
  -> deploy/production/deploy-main.sh
  -> image.aieyra.cn
```

The watcher observes `main` only. Never force-push `main`, deploy from another
branch, or replace the server checkout's local Forge `origin`.

## 2. Freeze the desktop release first

Do not edit the tracked server manifest pair until all of these are true:

- The Studio source tree is frozen at the intended version.
- The complete client release gate passes without relaxed thresholds.
- The packaged application, modern installer/uninstaller, upgrade, uninstall,
  and restart-update E2E tests use that same frozen source.
- `naimage-Setup-<version>-x64.exe` and
  `naimage-Restart-Update-<version>-x64.asar` were produced in the same
  release run.
- `desktop-release.json` and `desktop-release-legacy.json` were independently
  signed by the release private key and verified against the public key embedded
  in the client; they differ only in `product` and `signature`.
- The installer, restart ASAR, both manifests, sidecar, and `SHA256SUMS.txt`
  agree.

The release private key must never enter this repository, a command line, a
ticket, a log, or the production server.

## 3. Validate the backend merge candidate

From the repository root:

```bash
git status --short --branch
git fetch origin main --prune
git rev-list --left-right --count origin/main...HEAD
git diff --check
pnpm run verify:workspace
pnpm run check
pnpm run build:gateway
```

For New API controller/router changes, also run:

```bash
cd services/ai-gateway/new-api
go test ./...
cd web/default
bun test
bun run build:check
```

Review every dirty and untracked file before committing. Runtime data,
diagnostics, logs, binaries, installer artifacts, and private keys must not be
committed.

## 4. Stage versioned client artifacts without changing production state

Upload only the final, versioned installer and restart ASAR to
`/opt/iiimage/src/deploy/production/runtime/releases/`. Upload each file under a
temporary `.uploading` name, verify its size and SHA-256, and then rename it to
the final basename. Existing versioned artifacts and the live runtime manifests
must remain untouched during upload.

Copy both candidate manifests to temporary server paths and verify the pair
against the staged artifacts and tracked public key:

```bash
cd /opt/iiimage/src
deploy/production/verify-installer.sh \
  /tmp/desktop-release.candidate.json \
  /opt/iiimage/src/deploy/production/runtime/releases \
  /opt/iiimage/src/deploy/production/releases/update-public-key.pem \
  /tmp/desktop-release-legacy.candidate.json
```

This must report valid artifact hashes, two valid signatures, and
`desktop release manifest pair verified`. Delete both temporary candidates
afterward. Do not manually overwrite either runtime manifest; deployment
promotes and rolls back the tracked pair as one release operation.

## 5. Merge through Forge

Update both tracked desktop release manifests only with the verified pair.
Commit the reviewed backend, CRM, deployment, public verification
key, and manifest changes on the release branch. Push the branch and merge it
into Forge `main` using a normal reviewed fast-forward or pull request. Never
use a forced update.

Immediately before merge, require:

```bash
git rev-list --left-right --count origin/main...HEAD
git diff --check
git status --short --branch
```

The release branch must not be behind `origin/main`, and its worktree must be
clean after the release commit.

## 6. Observe automatic deployment

On the production server:

```bash
systemctl is-active iiimage-ai-native-sync.service
systemctl is-enabled iiimage-ai-native-sync.service
journalctl -u iiimage-ai-native-sync.service -n 120 --no-pager
tail -n 200 /opt/iiimage/src/deploy/production/runtime/logs/deploy/watch-main.log
```

Confirm all three commits agree:

```bash
cd /opt/iiimage/src
git rev-parse HEAD
git ls-remote origin refs/heads/main
cat deploy/production/runtime/deployed-main.sha
```

The deploy script rejects a dirty checkout, a non-`main` branch, an untrusted
origin, an invalid signed manifest, failed backups, unhealthy containers,
invalid Caddy configuration, or failed post-deploy acceptance. Do not bypass
these gates with manual container restarts.

## 7. Run the production acceptance scripts

```bash
cd /opt/iiimage/src/deploy/production
./verify-installer.sh
./verify-production.sh
```

The result must include source/origin/deployed commit agreement, signed desktop
release verification, Compose and Caddy validation, healthy restricted
containers, private ports, watcher, SSH key-only policy, Fail2ban, disk
headroom, CRM and New API backups, public endpoint boundaries, 32 KiB request
limits, security headers, and TLS validity.

## 8. Authenticated desktop download E2E

Use a dedicated non-admin release-test account and a normal browser or packaged
client. Do not paste session cookies into issue trackers or shell history.

Verify in order:

1. Anonymous homepage is available; anonymous download, update, telemetry, and
   installer requests are rejected.
2. Login returns to the client download dialog.
3. A fresh captcha is required for every authorization.
4. The issued ticket is bound to the current user, session, IP, and User-Agent.
5. A ticket succeeds once and replay is rejected.
6. A full installer download and an HTTP Range resume both work.
7. The downloaded byte count and SHA-256 equal the signed manifest.
8. Repeated challenges/downloads hit the documented user and IP limits without
   affecting unrelated authenticated users.
9. Disabling the release-test account invalidates the next download/update/
   telemetry/managed request; re-enable it after the test.

## 9. Desktop update E2E

Test from the last public version and from the new version:

- Compatible patch update selects the restart ASAR and does not request a
  captcha.
- Compatibility or minimum-version changes select the full installer and do
  require a fresh captcha.
- Tampered manifest, ASAR, installer, hash, size, filename, or signature is
  rejected before apply.
- Restart update applies only the signed ASAR, restarts once, reports the new
  version, and preserves projects, settings, login, and memory.
- Full installer update downloads inside the program, upgrades successfully,
  clears obsolete pending files, and preserves user data.

## 10. Managed Agent and image E2E

Using the packaged client and its authenticated New API session, perform real
requests through these managed routes:

- `GET /naimage/v1/models`
- `POST /naimage/v1/responses`
- `POST /naimage/v1/images/generations`
- `POST /naimage/v1/images/edits`

Confirm the upstream receives `/v1/*`, never the public `/naimage/v1/*` prefix.
Also verify one legacy `/iiimage/v1/*` request reaches the same handler without
a redirect. For image calls,
send a unique printable `Idempotency-Key`, then repeat the exact request with
the same key and confirm the stored result is replayed without a second charge
or generation. Reusing the key with a different payload must return conflict.
For a single generation, use only the top-level `prompt` and `count=1`; do not
send `items`.

Verify at least one real response, one image generation, and one image edit;
confirm usage, quota, channel attribution, and CRM/New API logs agree.

## 11. Privacy-limited desktop telemetry E2E

With the authenticated release-test session:

1. Send one allowed aggregate event containing schema version, event,
   application version, Windows/x64, release channel, component, stable error
   code, optional duration, and count. Expect HTTP 200 and one system-log row.
2. Send the same request with `prompt`, `project_path`, raw error text, machine
   identifier, or any other unknown field. Expect HTTP 400 and no stored row.
3. Send malformed, concatenated, oversized, invalid-platform, and invalid-count
   requests. Expect the documented 400 or 413 response and no sensitive log
   body.

## 12. Final release evidence

Archive, outside Git:

- Client full release-gate report.
- Installer/uninstaller and update E2E reports.
- Final `SHA256SUMS.txt`.
- Server deployment log and `verify-production.sh` output.
- Authenticated download/update, managed relay, telemetry, usage, and billing
  E2E timestamps and request IDs, with credentials and user content redacted.

Only after every section passes may the installer and checksum file be copied
to the operator desktop or announced as the public release.
