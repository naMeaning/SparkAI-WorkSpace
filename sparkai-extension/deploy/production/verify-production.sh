#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

SOURCE_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/runtime"
ENV_FILE="${RUNTIME_DIR}/.env"
COMPOSE_ENV_COMPAT_FILE="${SCRIPT_DIR}/compose-env-compat.env"
STATE_FILE="${RUNTIME_DIR}/deployed-main.sha"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
CADDY_SOURCE="${SCRIPT_DIR}/Caddyfile"
CADDY_TARGET="/opt/forgejo/caddy/Caddyfile"
BRANCH="${NAIMAGE_PRODUCTION_BRANCH:-${IIIMAGE_PRODUCTION_BRANCH:-main}}"
BASE_URL="${NAIMAGE_PRODUCTION_URL:-${IIIMAGE_PRODUCTION_URL:-https://image.aieyra.cn}}"
PRODUCTION_HOST="${NAIMAGE_PRODUCTION_HOST:-${IIIMAGE_PRODUCTION_HOST:-image.aieyra.cn}}"
TLS_MIN_SECONDS="${NAIMAGE_TLS_MIN_SECONDS:-${IIIMAGE_TLS_MIN_SECONDS:-1209600}}"
MAX_DISK_PERCENT="${NAIMAGE_MAX_DISK_PERCENT:-${IIIMAGE_MAX_DISK_PERCENT:-85}}"
REQUIRE_WATCHER="${NAIMAGE_REQUIRE_WATCHER:-${IIIMAGE_REQUIRE_WATCHER:-1}}"
REQUIRE_HOST_SECURITY="${NAIMAGE_REQUIRE_HOST_SECURITY:-${IIIMAGE_REQUIRE_HOST_SECURITY:-1}}"
EXPECTED_ORIGIN="${NAIMAGE_PRODUCTION_ORIGIN:-${IIIMAGE_PRODUCTION_ORIGIN:-/opt/forgejo/data/git/repositories/aieyra/ai-native.git}}"

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

skip() {
  printf '[SKIP] %s\n' "$1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

expect_http_status() {
  local label="$1"
  local expected="$2"
  shift 2
  local actual
  actual="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$@")"
  [[ "$actual" == "$expected" ]] || fail "${label}: expected HTTP ${expected}, got ${actual}"
  pass "${label}: HTTP ${actual}"
}

require_header() {
  local headers="$1"
  local expression="$2"
  local label="$3"
  grep -Eiq "$expression" <<<"$headers" || fail "missing or invalid ${label} header"
  pass "${label} header"
}

require_healthy_container() {
  local name="$1"
  local status
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] || fail "container ${name} is ${status:-missing}, expected healthy"
  pass "container ${name} is healthy"
}

require_running_container() {
  local name="$1"
  local running
  running="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)"
  [[ "$running" == "true" ]] || fail "container ${name} is not running"
  pass "container ${name} is running"
}

require_restricted_container() {
  local name="$1"
  local cap_drop
  local pids_limit
  local security_options
  local effective_capabilities
  cap_drop="$(docker inspect -f '{{join .HostConfig.CapDrop ","}}' "$name")"
  pids_limit="$(docker inspect -f '{{.HostConfig.PidsLimit}}' "$name")"
  security_options="$(docker inspect -f '{{join .HostConfig.SecurityOpt ","}}' "$name")"
  effective_capabilities="$(docker exec "$name" sh -lc "awk '/^CapEff:/ { print \$2 }' /proc/1/status")"
  [[ "$cap_drop" == "ALL" ]] || fail "container ${name} does not drop all Linux capabilities"
  [[ "$pids_limit" =~ ^[0-9]+$ && "$pids_limit" -gt 0 && "$pids_limit" -le 256 ]] || fail "container ${name} has unsafe PID limit: ${pids_limit}"
  grep -q 'no-new-privileges:true' <<<"$security_options" || fail "container ${name} lacks no-new-privileges"
  [[ "$effective_capabilities" == "0000000000000000" ]] || fail "container ${name} PID 1 still has effective capabilities: ${effective_capabilities}"
  pass "container ${name} capability and PID limits"
}

for command_name in awk cmp curl cut df docker find git grep head openssl sha256sum ss stat tar timeout tr; do
  require_command "$command_name"
done

[[ "$REQUIRE_WATCHER" =~ ^[01]$ ]] || fail "NAIMAGE_REQUIRE_WATCHER (or legacy IIIMAGE_REQUIRE_WATCHER) must be 0 or 1"
[[ "$REQUIRE_HOST_SECURITY" =~ ^[01]$ ]] || fail "NAIMAGE_REQUIRE_HOST_SECURITY (or legacy IIIMAGE_REQUIRE_HOST_SECURITY) must be 0 or 1"
if [[ "$REQUIRE_WATCHER" == "1" || "$REQUIRE_HOST_SECURITY" == "1" ]]; then
  require_command systemctl
fi
if [[ "$REQUIRE_HOST_SECURITY" == "1" ]]; then
  require_command fail2ban-client
  require_command sshd
fi

[[ -f "$ENV_FILE" ]] || fail "missing runtime environment: ${ENV_FILE}"
[[ -f "$COMPOSE_ENV_COMPAT_FILE" ]] || fail "missing Compose environment compatibility map: ${COMPOSE_ENV_COMPAT_FILE}"
[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || fail "runtime environment must have mode 600"
[[ "$(stat -c '%U' "$ENV_FILE")" == "root" ]] || fail "runtime environment must be owned by root"
if grep -q 'replace-with-' "$ENV_FILE"; then
  fail "runtime environment still contains placeholder values"
fi
pass "runtime environment ownership and permissions"

cd "$REPO_DIR"
[[ "$(git symbolic-ref --short HEAD)" == "$BRANCH" ]] || fail "production checkout is not on ${BRANCH}"
[[ -z "$(git status --porcelain)" ]] || fail "production source tree is not clean"
[[ "$(git remote get-url origin)" == "$EXPECTED_ORIGIN" ]] || fail "production origin is not the trusted Forge repository"

local_head="$(git rev-parse HEAD)"
origin_head="$(git ls-remote origin "refs/heads/${BRANCH}" | awk 'NR == 1 { print $1 }')"
[[ -n "$origin_head" ]] || fail "cannot resolve origin/${BRANCH}"
[[ -f "$STATE_FILE" ]] || fail "missing deployed state: ${STATE_FILE}"
deployed_head="$(tr -d '\r\n' <"$STATE_FILE")"
[[ "$local_head" == "$origin_head" ]] || fail "local HEAD does not match origin/${BRANCH}"
[[ "$local_head" == "$deployed_head" ]] || fail "deployed state does not match local HEAD"
pass "source, origin and deployed commit agree at ${local_head:0:12}"

cmp -s "${SCRIPT_DIR}/releases/desktop-release.json" "${RUNTIME_DIR}/releases/desktop-release.json" || fail "tracked and runtime desktop release manifests differ"
"${SCRIPT_DIR}/verify-installer.sh" >/dev/null
pass "desktop release manifest signature and artifact SHA-256 values"

docker compose --env-file "$ENV_FILE" --env-file "$COMPOSE_ENV_COMPAT_FILE" -f "$COMPOSE_FILE" config --quiet
pass "Docker Compose configuration"

[[ -f "$CADDY_TARGET" ]] || fail "missing live Caddyfile: ${CADDY_TARGET}"
cmp -s "$CADDY_SOURCE" "$CADDY_TARGET" || fail "project and live Caddyfile differ"
docker exec forgejo-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || fail "live Caddy configuration is invalid"
pass "project and live Caddy configuration"

require_healthy_container iiimage-mysql
require_healthy_container iiimage-crm-api
require_healthy_container iiimage-new-api
require_restricted_container iiimage-crm-api
require_restricted_container iiimage-new-api
require_running_container forgejo-caddy
require_running_container forgejo

for private_container in iiimage-mysql iiimage-crm-api iiimage-new-api; do
  [[ -z "$(docker port "$private_container" 2>/dev/null || true)" ]] || fail "${private_container} publishes a host port"
done
if ss -H -lnt | awk '{ print $4 }' | grep -Eq ':(17860|17861|3306|33060)$'; then
  fail "a private application or database port is listening on the host"
fi
pass "private application and database ports are not published"

if [[ "$REQUIRE_WATCHER" == "1" ]]; then
  systemctl is-active --quiet iiimage-ai-native-sync.service || fail "automatic deployment watcher is inactive"
  systemctl is-enabled --quiet iiimage-ai-native-sync.service || fail "automatic deployment watcher is not enabled"
  watcher_unit_path="$(systemctl show iiimage-ai-native-sync.service -p FragmentPath --value)"
  [[ -f "$watcher_unit_path" ]] || fail "automatic deployment watcher unit file is missing"
  cmp -s "${SCRIPT_DIR}/systemd/iiimage-ai-native-sync.service" "$watcher_unit_path" || fail "live watcher unit differs from project configuration"
  [[ "$(systemctl show iiimage-ai-native-sync.service -p NeedDaemonReload --value)" == "no" ]] || fail "systemd must reload the watcher unit"
  pass "automatic deployment watcher and unit configuration"
else
  skip "automatic deployment watcher check disabled for deployment bootstrap"
fi

if [[ "$REQUIRE_HOST_SECURITY" == "1" ]]; then
  [[ -s /root/.ssh/authorized_keys ]] || fail "root has no authorized SSH key"
  cmp -s "${SCRIPT_DIR}/security/99-iiimage-hardening.conf" /etc/ssh/sshd_config.d/99-iiimage-hardening.conf || fail "live SSH hardening differs from project configuration"
  cmp -s "${SCRIPT_DIR}/security/iiimage-jail.conf" /etc/fail2ban/jail.d/iiimage.local || fail "live Fail2ban jail differs from project configuration"
  sshd -t
  effective_ssh="$(sshd -T)"
  for required_setting in \
    'port 22' \
    'logingracetime 30' \
    'maxauthtries 3' \
    'pubkeyauthentication yes' \
    'passwordauthentication no' \
    'kbdinteractiveauthentication no' \
    'x11forwarding no'; do
    grep -qxF "$required_setting" <<<"$effective_ssh" || fail "SSH setting is not active: ${required_setting}"
  done
  grep -Eq '^permitrootlogin (without-password|prohibit-password)$' <<<"$effective_ssh" || fail "root SSH login is not restricted to keys"
  pass "SSH key-only hardening"

  systemctl is-active --quiet fail2ban || fail "Fail2ban is inactive"
  systemctl is-enabled --quiet fail2ban || fail "Fail2ban is not enabled"
  fail2ban-client ping >/dev/null
  fail2ban-client status sshd >/dev/null
  pass "Fail2ban SSH jail"
else
  skip "SSH and Fail2ban checks disabled for deployment bootstrap"
fi

disk_percent="$(df -P "$REPO_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
[[ "$disk_percent" =~ ^[0-9]+$ ]] || fail "cannot determine disk usage"
(( disk_percent < MAX_DISK_PERCENT )) || fail "disk usage ${disk_percent}% exceeds limit ${MAX_DISK_PERCENT}%"
pass "disk usage ${disk_percent}% is below ${MAX_DISK_PERCENT}%"

latest_backup="$(find "${RUNTIME_DIR}/backups" -maxdepth 1 -type f -name 'ai_native_crm-*.sql' -size +0c -print -quit)"
[[ -n "$latest_backup" ]] || fail "no non-empty CRM database backup found"
pass "non-empty CRM database backup exists"

latest_new_api_backup="$(find "${RUNTIME_DIR}/backups" -maxdepth 1 -type f -name 'new-api-state-*.tar.gz' -size +0c -printf '%T@ %p\n' | sort -rn | head -n 1 | cut -d' ' -f2-)"
[[ -n "$latest_new_api_backup" ]] || fail "no non-empty New API state backup found"
"${SCRIPT_DIR}/verify-new-api-backup.sh" "$latest_new_api_backup" "aieyra/iiimage-new-api:local" >/dev/null
pass "New API SQLite and managed image response backup"

expect_http_status "homepage" 200 "$BASE_URL/"
expect_http_status "public status endpoint" 200 "$BASE_URL/api/status"
expect_http_status "anonymous captcha denial" 401 -X POST "$BASE_URL/api/desktop-download/captcha"
expect_http_status "anonymous desktop update denial" 401 "$BASE_URL/api/desktop-update/check?current_version=1.0.0&platform=win32&architecture=x64&compatibility=probe"
expect_http_status "anonymous desktop telemetry denial" 401 -X POST "$BASE_URL/api/desktop-client/events"
expect_http_status "anonymous installer denial" 401 "$BASE_URL/downloads/naimage-studio/windows"

oversized_status="$(head -c 40000 /dev/zero | tr '\0' x | curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary @- "$BASE_URL/api/desktop-download/captcha")"
[[ "$oversized_status" == "413" ]] || fail "oversized download API body: expected HTTP 413, got ${oversized_status}"
pass "oversized download API body: HTTP 413"

oversized_update_status="$(head -c 40000 /dev/zero | tr '\0' x | curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary @- "$BASE_URL/api/desktop-update/authorize")"
[[ "$oversized_update_status" == "413" ]] || fail "oversized update API body: expected HTTP 413, got ${oversized_update_status}"
pass "oversized update API body: HTTP 413"

oversized_telemetry_status="$(head -c 40000 /dev/zero | tr '\0' x | curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary @- "$BASE_URL/api/desktop-client/events")"
[[ "$oversized_telemetry_status" == "413" ]] || fail "oversized desktop telemetry body: expected HTTP 413, got ${oversized_telemetry_status}"
pass "oversized desktop telemetry body: HTTP 413"

headers="$(curl -sS --max-time 30 -I "$BASE_URL/")"
require_header "$headers" '^strict-transport-security:[[:space:]]*max-age=' 'HSTS'
require_header "$headers" '^x-content-type-options:[[:space:]]*nosniff' 'X-Content-Type-Options'
require_header "$headers" '^x-frame-options:[[:space:]]*deny' 'X-Frame-Options'
require_header "$headers" '^referrer-policy:[[:space:]]*strict-origin-when-cross-origin' 'Referrer-Policy'

certificate="$(timeout 20 openssl s_client -servername "$PRODUCTION_HOST" -connect "${PRODUCTION_HOST}:443" </dev/null 2>/dev/null | openssl x509 -outform PEM)" || fail "cannot read production TLS certificate"
printf '%s\n' "$certificate" | openssl x509 -checkend "$TLS_MIN_SECONDS" -noout >/dev/null || fail "production TLS certificate expires too soon"
certificate_expiry="$(printf '%s\n' "$certificate" | openssl x509 -enddate -noout | cut -d= -f2-)"
pass "TLS certificate remains valid beyond ${TLS_MIN_SECONDS}s (${certificate_expiry})"

printf '\nproduction verification passed at %s\n' "$(date -Is)"
