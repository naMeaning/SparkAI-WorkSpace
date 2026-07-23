#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/runtime"
ENV_FILE="${RUNTIME_DIR}/.env"
COMPOSE_ENV_COMPAT_FILE="${SCRIPT_DIR}/compose-env-compat.env"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
LOG_DIR="${RUNTIME_DIR}/logs/deploy"
STATE_FILE="${RUNTIME_DIR}/deployed-main.sha"
RECOVERY_SENTINEL="${RUNTIME_DIR}/manual-recovery-required.env"
LOCK_FILE="${RUNTIME_DIR}/deploy.lock"
CADDY_SOURCE="${SCRIPT_DIR}/Caddyfile"
CADDY_TARGET="/opt/forgejo/caddy/Caddyfile"
CADDY_VALIDATOR_IMAGE="caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
VERIFY_SCRIPT="${SCRIPT_DIR}/verify-production.sh"
VERIFY_CRM_BACKUP_SCRIPT="${SCRIPT_DIR}/verify-crm-backup.sh"
BACKUP_NEW_API_SCRIPT="${SCRIPT_DIR}/backup-new-api-state.sh"
VERIFY_NEW_API_BACKUP_SCRIPT="${SCRIPT_DIR}/verify-new-api-backup.sh"
RELEASE_MANIFEST_SOURCE="${SCRIPT_DIR}/releases/desktop-release.json"
RELEASE_MANIFEST_TARGET="${RUNTIME_DIR}/releases/desktop-release.json"
BRANCH="main"
EXPECTED_ORIGIN="${NAIMAGE_PRODUCTION_ORIGIN:-${IIIMAGE_PRODUCTION_ORIGIN:-/opt/forgejo/data/git/repositories/aieyra/ai-native.git}}"
PLAN_ONLY="${NAIMAGE_DEPLOY_PLAN_ONLY:-${IIIMAGE_DEPLOY_PLAN_ONLY:-0}}"
SELF_TEST=0
case "${1:-}" in
  --plan) PLAN_ONLY=1 ;;
  --self-test) SELF_TEST=1 ;;
  "") ;;
  *) printf 'usage: %s [--plan|--self-test]\n' "$0" >&2; exit 1 ;;
esac

naimage_is_operations_only_path() {
  case "$1" in
    .gitignore | AGENTS.md | README.md | docs/* | scripts/diagnostics/* | \
      deploy/production/.env.example | \
      deploy/production/Caddyfile | \
      deploy/production/README.md | \
      deploy/production/releases/* | \
      deploy/production/deploy-main.sh | \
      deploy/production/backup-new-api-state.sh | \
      deploy/production/verify-crm-backup.sh | \
      deploy/production/verify-new-api-backup.sh | \
      deploy/production/verify-production.sh)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

naimage_is_crm_code_path() {
  case "$1" in
    services/crm-api/* | \
      packages/crm-contracts/* | \
      packages/shared/* | \
      deploy/production/Dockerfile.crm-api | \
      deploy/production/docker-compose.yml | \
      package.json | pnpm-lock.yaml | pnpm-workspace.yaml)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

naimage_is_new_api_code_path() {
  case "$1" in
    services/ai-gateway/* | deploy/production/Dockerfile.new-api | deploy/production/docker-compose.yml)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

naimage_rollback_mode() {
  local source_was_advanced="${1:-0}"
  local crm_was_changed="${2:-0}"
  local crm_migration_was_started="${3:-0}"
  local state_backup_is_ready="${4:-0}"
  local application_mutation_was_started="${5:-0}"

  if [[ "$crm_was_changed" == "1" && "$crm_migration_was_started" == "1" ]]; then
    printf 'blocked\n'
  elif [[ "$state_backup_is_ready" == "1" ]]; then
    printf 'full\n'
  elif [[ "$source_was_advanced" == "1" || "$application_mutation_was_started" == "1" ]]; then
    printf 'runtime-only\n'
  else
    printf 'none\n'
  fi
}

naimage_requires_manual_crm_release() {
  [[ "${1:-0}" == "1" ]]
}

naimage_requires_new_api_sentinel() {
  [[ "${1:-0}" == "1" ]]
}

naimage_may_clear_recovery_sentinel() {
  [[ "${1:-0}" == "1" || "${2:-0}" == "1" ]]
}

run_policy_self_test() {
  local failures=0
  naimage_is_operations_only_path "deploy/production/deploy-main.sh" || failures=$((failures + 1))
  naimage_is_operations_only_path "scripts/diagnostics/new-api-sqlite-compat-rehearsal.ps1" || failures=$((failures + 1))
  naimage_is_operations_only_path "scripts/release/unknown-runtime-change.ps1" && failures=$((failures + 1))
  naimage_is_operations_only_path "services/ai-gateway/new-api/main.go" && failures=$((failures + 1))
  naimage_is_crm_code_path "services/crm-api/src/server.ts" || failures=$((failures + 1))
  naimage_is_crm_code_path "services/ai-gateway/new-api/main.go" && failures=$((failures + 1))
  naimage_is_new_api_code_path "services/ai-gateway/new-api/main.go" || failures=$((failures + 1))
  naimage_is_crm_code_path "deploy/production/docker-compose.yml" || failures=$((failures + 1))
  naimage_is_new_api_code_path "deploy/production/docker-compose.yml" || failures=$((failures + 1))
  [[ "$(naimage_rollback_mode 0 0 0 0 0)" == "none" ]] || failures=$((failures + 1))
  [[ "$(naimage_rollback_mode 1 0 0 0 0)" == "runtime-only" ]] || failures=$((failures + 1))
  [[ "$(naimage_rollback_mode 0 0 0 0 1)" == "runtime-only" ]] || failures=$((failures + 1))
  [[ "$(naimage_rollback_mode 0 0 0 1 1)" == "full" ]] || failures=$((failures + 1))
  [[ "$(naimage_rollback_mode 0 1 1 1 1)" == "blocked" ]] || failures=$((failures + 1))
  # FORCE_BUILD/same-HEAD and stop-attempted paths have no source advance but
  # still require runtime rollback once image mutation begins.
  [[ "$(naimage_rollback_mode 0 0 0 0 1)" == "runtime-only" ]] || failures=$((failures + 1))
  naimage_requires_manual_crm_release 1 || failures=$((failures + 1))
  naimage_requires_manual_crm_release 0 && failures=$((failures + 1))
  naimage_requires_new_api_sentinel 1 || failures=$((failures + 1))
  naimage_requires_new_api_sentinel 0 && failures=$((failures + 1))
  naimage_may_clear_recovery_sentinel 1 0 || failures=$((failures + 1))
  naimage_may_clear_recovery_sentinel 0 1 || failures=$((failures + 1))
  naimage_may_clear_recovery_sentinel 0 0 && failures=$((failures + 1))
  [[ "$failures" == "0" ]] || { printf '[FAIL] deployment policy self-test failures=%s\n' "$failures" >&2; return 1; }
  printf '[PASS] deployment rollback policy self-test\n'
}

if [[ "$SELF_TEST" == "1" ]]; then
  run_policy_self_test
  exit 0
fi

release_manifest_backup=""
release_manifest_candidate=""
release_manifest_changed=0
release_manifest_committed=0
caddy_backup=""
caddy_changed=0
previous_head=""
new_head=""
previous_deployed_head=""
previous_state_existed=0
state_marker_changed=0
source_advanced=0
requires_application_deploy=1
crm_code_changed=0
new_api_code_changed=0
crm_migration_started=0
image_build_started=0
new_api_service_stopped=0
new_api_backup_ready=0
new_api_backup=""
new_api_backup_result=""
new_api_switch_started=0
rollback_new_api_image=""
rollback_new_api_image_ready=0
deployment_complete=0
rollback_running=0
rollback_completed=0
rollback_new_api_image_id=""
failed_new_api_image_id=""
deployment_sentinel_owned=0
crm_backup=""
compose=(docker compose --env-file "$ENV_FILE" --env-file "$COMPOSE_ENV_COMPAT_FILE" -f "$COMPOSE_FILE")

cleanup_release_manifest() {
  local cleanup_ok=1
  if [[ "$release_manifest_changed" == "1" && "$release_manifest_committed" != "1" ]]; then
    if [[ -n "$release_manifest_backup" && -f "$release_manifest_backup" ]]; then
      if mv -f "$release_manifest_backup" "$RELEASE_MANIFEST_TARGET"; then
        release_manifest_backup=""
      else
        printf '[CRITICAL] failed to restore the previous desktop release manifest; preserved %s\n' "$release_manifest_backup" >&2
        cleanup_ok=0
      fi
    else
      rm -f "$RELEASE_MANIFEST_TARGET" || cleanup_ok=0
    fi
  fi
  if [[ -n "$release_manifest_candidate" ]]; then
    rm -f "$release_manifest_candidate" || cleanup_ok=0
    [[ -e "$release_manifest_candidate" ]] || release_manifest_candidate=""
  fi
  if [[ "$release_manifest_committed" == "1" && -n "$release_manifest_backup" ]]; then
    rm -f "$release_manifest_backup" || cleanup_ok=0
    [[ -e "$release_manifest_backup" ]] || release_manifest_backup=""
  fi
  if [[ "$cleanup_ok" == "1" ]]; then
    release_manifest_changed=0
  fi
  [[ "$cleanup_ok" == "1" ]]
}

restore_previous_state_marker() {
  if [[ "$state_marker_changed" != "1" ]]; then
    return 0
  fi
  if [[ "$previous_state_existed" == "1" ]]; then
    printf '%s\n' "$previous_deployed_head" > "$STATE_FILE" || return 1
  else
    rm -f "$STATE_FILE" || return 1
  fi
  state_marker_changed=0
}

wait_health() {
  local name="$1"
  local status=""
  for _ in $(seq 1 100); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    echo "[$(date -Is)] ${name} status=${status}"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return 0
    fi
    sleep 3
  done
  docker logs --tail 180 "$name" || true
  return 1
}

restore_previous_caddy() {
  if [[ "$caddy_changed" != "1" || -z "$caddy_backup" || ! -f "$caddy_backup" ]]; then
    return 0
  fi
  echo "[$(date -Is)] rollback: restoring live Caddyfile from ${caddy_backup}"
  cp "$caddy_backup" "$CADDY_TARGET" || return 1
  chmod 0644 "$CADDY_TARGET" || return 1
  docker exec forgejo-caddy caddy validate --config /etc/caddy/Caddyfile || return 1
  docker exec forgejo-caddy caddy reload --config /etc/caddy/Caddyfile || return 1
  caddy_changed=0
}

write_recovery_sentinel() {
  local reason="$1"
  local target="${2:-${new_head:-unknown}}"
  local sentinel_tmp
  sentinel_tmp="$(mktemp "${RUNTIME_DIR}/.manual-recovery-required.XXXXXX")" || return 1
  chmod 0600 "$sentinel_tmp" || { rm -f "$sentinel_tmp"; return 1; }
  if ! printf 'schema=1\ncreated_at=%s\nreason=%s\ncheckout_head=%s\ndeployed_head=%s\ntarget_head=%s\ncrm_backup=%s\nnew_api_backup=%s\nrollback_image=%s\n' \
    "$(date -Is)" "$reason" "${previous_head:-unknown}" "${previous_deployed_head:-unknown}" "$target" \
    "${crm_backup:-}" "${new_api_backup:-}" "${rollback_new_api_image:-}" > "$sentinel_tmp"; then
    rm -f "$sentinel_tmp"
    return 1
  fi
  if ! mv -f "$sentinel_tmp" "$RECOVERY_SENTINEL"; then
    rm -f "$sentinel_tmp"
    return 1
  fi
}

clear_recovery_sentinel() {
  if [[ "$deployment_sentinel_owned" != "1" ]]; then
    return 0
  fi
  rm -f "$RECOVERY_SENTINEL" || return 1
  deployment_sentinel_owned=0
}

rollback_deployment() {
  if [[ "$rollback_running" == "1" ]]; then
    return 1
  fi
  rollback_running=1

  local mode
  local restore_ok=1
  local application_ok=1
  local control_ok=1
  mode="$(naimage_rollback_mode "$source_advanced" "$crm_code_changed" "$crm_migration_started" "$new_api_backup_ready" "$image_build_started")"
  echo "[$(date -Is)] rollback mode=${mode} previous=${previous_head:-none} failed=${new_head:-none}"

  if [[ "$mode" == "blocked" ]]; then
    if ! write_recovery_sentinel "crm-forward-migration-started" "${new_head:-unknown}"; then
      echo "[CRITICAL] failed to update the recovery sentinel after CRM migration" >&2
    fi
    if ! restore_previous_state_marker; then
      echo "[CRITICAL] failed to restore the previous deployment marker" >&2
    fi
    echo "[CRITICAL] automatic rollback blocked: CRM-affecting code began a forward migration; runtime evidence is preserved in ${RECOVERY_SENTINEL}" >&2
    [[ -z "$crm_backup" ]] || echo "[CRITICAL] preserved CRM backup: ${crm_backup}" >&2
    [[ -z "$new_api_backup" ]] || echo "[CRITICAL] preserved New API backup: ${new_api_backup}" >&2
    [[ "$rollback_new_api_image_ready" != "1" ]] || echo "[CRITICAL] preserved New API image: ${rollback_new_api_image}" >&2
    return 1
  fi

  if ! cleanup_release_manifest; then
    control_ok=0
  fi
  if ! restore_previous_state_marker; then
    echo "[CRITICAL] failed to restore the previous deployment marker" >&2
    control_ok=0
  fi
  if ! restore_previous_caddy; then
    echo "[CRITICAL] failed to restore the previous Caddy configuration" >&2
    control_ok=0
  fi

  if [[ "$mode" == "none" ]]; then
    if [[ "$control_ok" == "1" ]]; then
      if naimage_may_clear_recovery_sentinel 0 1 && ! clear_recovery_sentinel; then
        echo "[CRITICAL] runtime rollback succeeded but the recovery sentinel could not be cleared" >&2
        return 1
      fi
      rollback_completed=1
      return 0
    fi
    if ! write_recovery_sentinel "runtime-rollback-incomplete" "${new_head:-unknown}"; then
      echo "[CRITICAL] failed to update the recovery sentinel for an incomplete runtime rollback" >&2
    fi
    return 1
  fi
  if [[ "$new_api_service_stopped" == "1" || "$new_api_switch_started" == "1" ]]; then
    "${compose[@]}" stop -t 30 iiimage-new-api || true
  fi

  if [[ "$mode" == "full" ]]; then
    if [[ "$rollback_new_api_image_ready" != "1" || -z "$rollback_new_api_image" ]]; then
      echo "[CRITICAL] previous New API image was not preserved" >&2
      restore_ok=0
    elif ! "$VERIFY_NEW_API_BACKUP_SCRIPT" --restore "$RUNTIME_DIR" "$new_api_backup" "$rollback_new_api_image" "$previous_deployed_head"; then
      echo "[CRITICAL] New API state restore failed; leaving the service stopped" >&2
      restore_ok=0
    fi
  fi

  if [[ "$image_build_started" == "1" || "$new_api_service_stopped" == "1" || "$new_api_switch_started" == "1" ]]; then
    if [[ "$rollback_new_api_image_ready" == "1" && -n "$rollback_new_api_image" ]]; then
      failed_new_api_image_id="$(docker image inspect -f '{{.Id}}' aieyra/iiimage-new-api:local 2>/dev/null || true)"
      if ! docker image tag "$rollback_new_api_image" aieyra/iiimage-new-api:local; then
        echo "[CRITICAL] failed to restore previous New API image tag" >&2
        application_ok=0
      fi
    elif [[ "$image_build_started" == "1" ]]; then
      echo "[CRITICAL] previous New API image was not preserved before the build" >&2
      application_ok=0
    fi
  fi

  if [[ "$new_api_service_stopped" == "1" || "$new_api_switch_started" == "1" ]]; then
    if [[ "$restore_ok" == "1" && "$application_ok" == "1" ]]; then
      echo "[$(date -Is)] rollback: restarting previous New API application"
      if [[ "$new_api_switch_started" != "1" ]] && docker inspect iiimage-new-api >/dev/null 2>&1; then
        previous_container_running="$(docker inspect -f '{{.State.Running}}' iiimage-new-api 2>/dev/null || true)"
        if [[ "$previous_container_running" != "true" ]]; then
          docker start iiimage-new-api >/dev/null || application_ok=0
        fi
      elif ! "${compose[@]}" up -d --no-deps iiimage-new-api; then
        application_ok=0
      fi
      if [[ "$application_ok" != "1" ]] || ! wait_health iiimage-new-api; then
        echo "[CRITICAL] previous New API application did not recover" >&2
        application_ok=0
      fi
    else
      application_ok=0
    fi
  fi

  if [[ "$restore_ok" == "1" && "$application_ok" == "1" && "$control_ok" == "1" ]]; then
    echo "[$(date -Is)] runtime rollback complete; checkout remains at the target commit and the previous deployment marker will trigger a retry"
    if naimage_may_clear_recovery_sentinel 0 1 && ! clear_recovery_sentinel; then
      echo "[CRITICAL] verified rollback completed but the recovery sentinel could not be cleared" >&2
      return 1
    fi
    rollback_completed=1
    return 0
  fi
  echo "[CRITICAL] rollback incomplete; keep the preserved state backup and rollback image for manual recovery" >&2
  if ! write_recovery_sentinel "new-api-rollback-incomplete" "${new_head:-unknown}"; then
    echo "[CRITICAL] failed to update the recovery sentinel for an incomplete New API rollback" >&2
  fi
  return 1
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$status" != "0" && "$deployment_complete" != "1" ]]; then
    if ! rollback_deployment; then
      status=1
    fi
  else
    if ! cleanup_release_manifest; then
      status=1
    fi
  fi
  [[ -z "$new_api_backup_result" ]] || rm -f "$new_api_backup_result"
  if [[ "$rollback_new_api_image_ready" == "1" && -n "$rollback_new_api_image" && ( "$status" == "0" || "$image_build_started" != "1" ) ]]; then
    docker image rm "$rollback_new_api_image" >/dev/null 2>&1 || true
  elif [[ "$rollback_completed" == "1" && "$rollback_new_api_image_ready" == "1" && -n "$rollback_new_api_image" ]]; then
    docker image rm "$rollback_new_api_image" >/dev/null 2>&1 || true
  fi
  if [[ "$rollback_completed" == "1" && -n "$failed_new_api_image_id" && "$failed_new_api_image_id" != "$rollback_new_api_image_id" ]]; then
    docker image rm "$failed_new_api_image_id" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap on_exit EXIT

mkdir -p "$LOG_DIR" "${RUNTIME_DIR}/backups" "${RUNTIME_DIR}/releases"
touch "$LOCK_FILE"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] deploy already running"
  exit 0
fi

log_file="${LOG_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$log_file") 2>&1

echo "[$(date -Is)] deploy start"
if [[ "$PLAN_ONLY" != "1" && -f "$RECOVERY_SENTINEL" ]]; then
  echo "automatic deployment is blocked by ${RECOVERY_SENTINEL}; operator review and explicit removal are required" >&2
  deployment_complete=1
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing ${ENV_FILE}; copy .env.example and provide production secrets" >&2
  exit 1
fi
if [[ ! -f "$COMPOSE_ENV_COMPAT_FILE" ]]; then
  echo "missing ${COMPOSE_ENV_COMPAT_FILE}; refusing deployment without deterministic environment compatibility" >&2
  exit 1
fi

cd "$REPO_DIR"
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "production source tree contains uncommitted files; refusing destructive deployment" >&2
  git status --short >&2
  exit 1
fi
current_branch="$(git symbolic-ref --short HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "production checkout must be on ${BRANCH}; current branch is ${current_branch}" >&2
  exit 1
fi
origin_url="$(git remote get-url origin)"
if [[ "$origin_url" != "$EXPECTED_ORIGIN" ]]; then
  echo "production origin does not match the trusted Forge repository" >&2
  exit 1
fi

previous_head="$(git rev-parse HEAD)"
if [[ -f "$STATE_FILE" ]]; then
  previous_state_existed=1
  previous_deployed_head="$(tr -d '\r\n' < "$STATE_FILE")"
fi
git fetch origin "$BRANCH" --prune
target_head="$(git rev-parse "origin/${BRANCH}")"

requires_application_deploy=1
crm_code_changed=0
new_api_code_changed=0
if [[ "${FORCE_BUILD:-0}" != "1" && -n "$previous_deployed_head" ]] && \
  git cat-file -e "${previous_deployed_head}^{commit}" 2>/dev/null && \
  git merge-base --is-ancestor "$previous_deployed_head" "$target_head"; then
  requires_application_deploy=0
  while IFS= read -r changed_path; do
    path_classified=0
    [[ -z "$changed_path" ]] && continue
    if naimage_is_operations_only_path "$changed_path"; then
      continue
    fi
    echo "application-affecting change: ${changed_path}"
    requires_application_deploy=1
    if naimage_is_crm_code_path "$changed_path"; then
      crm_code_changed=1
      path_classified=1
    fi
    if naimage_is_new_api_code_path "$changed_path"; then
      new_api_code_changed=1
      path_classified=1
    fi
    if [[ "$path_classified" != "1" ]]; then
      echo "conservative CRM classification for shared/unknown path: ${changed_path}"
      crm_code_changed=1
      new_api_code_changed=1
    fi
  done < <(git diff --name-only "$previous_deployed_head" "$target_head" --)
else
  crm_code_changed=1
  new_api_code_changed=1
fi

printf 'deploy plan current=%s target=%s application=%s crm_code_changed=%s new_api_code_changed=%s rollback=%s\n' \
  "$previous_head" "$target_head" "$requires_application_deploy" "$crm_code_changed" "$new_api_code_changed" \
  "$(naimage_rollback_mode 1 "$crm_code_changed" 0 0)"
if [[ "$PLAN_ONLY" == "1" ]]; then
  echo "[$(date -Is)] plan-only complete; source and services were not changed"
  deployment_complete=1
  exit 0
fi

if naimage_requires_manual_crm_release "$crm_code_changed"; then
  if ! write_recovery_sentinel "automatic-crm-release-blocked" "$target_head"; then
    echo "failed to record the mandatory CRM manual-review sentinel" >&2
    exit 1
  fi
  echo "CRM/shared changes require an operator-reviewed release; recorded ${RECOVERY_SENTINEL}" >&2
  deployment_complete=1
  exit 1
fi

if [[ "$previous_head" != "$target_head" ]]; then
  source_advanced=1
  git merge --ff-only "origin/${BRANCH}"
fi
new_head="$(git rev-parse HEAD)"
echo "deploying=${new_head} previous=${previous_head}"

if [[ ! -f "$RELEASE_MANIFEST_SOURCE" ]]; then
  echo "missing tracked desktop release manifest: ${RELEASE_MANIFEST_SOURCE}" >&2
  exit 1
fi
NAIMAGE_ALLOW_FROZEN_HISTORICAL_RELEASE=0 "${SCRIPT_DIR}/verify-installer.sh" \
  "$RELEASE_MANIFEST_SOURCE" \
  "${RUNTIME_DIR}/releases" \
  "${SCRIPT_DIR}/releases/update-public-key.pem"

docker run --rm \
  -v "${CADDY_SOURCE}:/etc/caddy/Caddyfile:ro" \
  "$CADDY_VALIDATOR_IMAGE" caddy validate --config /etc/caddy/Caddyfile

if [[ "$requires_application_deploy" == "1" ]]; then
  if [[ -z "$previous_deployed_head" ]] || \
    ! git cat-file -e "${previous_deployed_head}^{commit}" 2>/dev/null || \
    ! git merge-base --is-ancestor "$previous_deployed_head" "$new_head"; then
    echo "cannot guarantee application rollback: deployed state is missing or is not an ancestor of the target" >&2
    exit 1
  fi
  if [[ "$crm_code_changed" != "1" && "$new_api_code_changed" != "1" ]]; then
    echo "application deployment was requested but no deployable component was classified" >&2
    exit 1
  fi

  if naimage_requires_new_api_sentinel "$new_api_code_changed"; then
    if ! write_recovery_sentinel "new-api-deployment-in-progress" "$new_head"; then
      echo "cannot begin New API deployment: failed to create ${RECOVERY_SENTINEL}" >&2
      exit 1
    fi
    deployment_sentinel_owned=1
  fi

  backup_stamp="$(date +%Y%m%d-%H%M%S)"
  if [[ "$new_api_code_changed" == "1" ]]; then
    rollback_new_api_image="aieyra/iiimage-new-api:rollback-${backup_stamp}-$$"
    previous_image_id="$(docker inspect -f '{{.Image}}' iiimage-new-api 2>/dev/null || true)"
    if [[ -n "$previous_image_id" ]] && docker image inspect "$previous_image_id" >/dev/null 2>&1; then
      docker image tag "$previous_image_id" "$rollback_new_api_image"
      rollback_new_api_image_id="$previous_image_id"
      rollback_new_api_image_ready=1
    elif docker image inspect aieyra/iiimage-new-api:local >/dev/null 2>&1; then
      docker image tag aieyra/iiimage-new-api:local "$rollback_new_api_image"
      rollback_new_api_image_id="$(docker image inspect -f '{{.Id}}' aieyra/iiimage-new-api:local)"
      rollback_new_api_image_ready=1
    fi
    if [[ "$rollback_new_api_image_ready" != "1" ]]; then
      echo "cannot guarantee New API rollback: previous application image is missing" >&2
      exit 1
    fi
  fi

  if [[ "$crm_code_changed" == "1" ]]; then
    crm_backup="${RUNTIME_DIR}/backups/ai_native_crm-${backup_stamp}.sql"
    echo "[$(date -Is)] backing up CRM database to ${crm_backup}"
    docker exec iiimage-mysql sh -lc 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -uroot --single-transaction --routines --triggers ai_native_crm' > "$crm_backup"
    test -s "$crm_backup"
    "$VERIFY_CRM_BACKUP_SCRIPT" "$crm_backup"
  fi

  echo "[$(date -Is)] docker compose build"
  build_services=()
  [[ "$crm_code_changed" != "1" ]] || build_services+=(iiimage-crm-api)
  if [[ "$new_api_code_changed" == "1" ]]; then
    image_build_started=1
    build_services+=(iiimage-new-api)
  fi
  "${compose[@]}" build "${build_services[@]}"

  if [[ "$crm_code_changed" == "1" ]]; then
    echo "[$(date -Is)] applying CRM migrations"
    "${compose[@]}" up -d iiimage-mysql
    wait_health iiimage-mysql
    crm_migration_started=1
    "${compose[@]}" run --rm --no-deps iiimage-crm-api pnpm --filter @ai-native/crm-api migrate
  fi

  if [[ "$new_api_code_changed" == "1" ]]; then
    echo "[$(date -Is)] creating a consistent New API SQLite and image-response backup"
    new_api_service_stopped=1
    "${compose[@]}" stop -t 30 iiimage-new-api
    new_api_backup_result="$(mktemp "${RUNTIME_DIR}/.new-api-backup-result.XXXXXX")"
    rm -f "$new_api_backup_result"
    if ! "$BACKUP_NEW_API_SCRIPT" "$RUNTIME_DIR" "$rollback_new_api_image" "$previous_deployed_head" "$new_api_backup_result"; then
      echo "New API backup failed; rollback will restart the previous service" >&2
      exit 1
    fi
    [[ -s "$new_api_backup_result" ]] || { echo "New API backup did not publish its archive path" >&2; exit 1; }
    new_api_backup="$(tr -d '\r\n' < "$new_api_backup_result")"
    [[ -s "$new_api_backup" ]] || { echo "New API backup archive is missing" >&2; exit 1; }
    new_api_backup_ready=1
  fi

  echo "[$(date -Is)] docker compose up"
  if [[ "$crm_code_changed" == "1" ]]; then
    "${compose[@]}" up -d iiimage-mysql iiimage-crm-api
    wait_health iiimage-mysql
    wait_health iiimage-crm-api
  fi
  if [[ "$new_api_code_changed" == "1" ]]; then
    new_api_switch_started=1
    "${compose[@]}" up -d --no-deps iiimage-new-api
    wait_health iiimage-new-api
  fi
else
  echo "[$(date -Is)] operations-only change set; skipping image rebuild, migration, and container restart"
fi

if ! cmp -s "$CADDY_SOURCE" "$CADDY_TARGET"; then
  caddy_backup="${RUNTIME_DIR}/backups/Caddyfile.$(date +%Y%m%d-%H%M%S)"
  cp -a "$CADDY_TARGET" "$caddy_backup"
  caddy_changed=1
  # Caddyfile is bind-mounted as a single file. Copy in place so the running
  # container keeps the same inode and can observe the new contents on reload.
  cp "$CADDY_SOURCE" "$CADDY_TARGET"
  chmod 0644 "$CADDY_TARGET"
  if ! docker exec forgejo-caddy caddy validate --config /etc/caddy/Caddyfile; then
    restore_previous_caddy || true
    echo "Caddy validation failed; restored ${caddy_backup}" >&2
    exit 1
  fi
  docker exec forgejo-caddy caddy reload --config /etc/caddy/Caddyfile
fi

if ! cmp -s "$RELEASE_MANIFEST_SOURCE" "$RELEASE_MANIFEST_TARGET"; then
  release_manifest_candidate="$(mktemp "${RUNTIME_DIR}/releases/.desktop-release.candidate.XXXXXX")"
  cp "$RELEASE_MANIFEST_SOURCE" "$release_manifest_candidate"
  chmod 0644 "$release_manifest_candidate"
  if [[ -f "$RELEASE_MANIFEST_TARGET" ]]; then
    release_manifest_backup="$(mktemp "${RUNTIME_DIR}/releases/.desktop-release.backup.XXXXXX")"
    cp -a "$RELEASE_MANIFEST_TARGET" "$release_manifest_backup"
  fi
  release_manifest_changed=1
fi
# Verify the staged canonical manifest before atomically promoting it.
manifest_for_verification="${release_manifest_candidate:-$RELEASE_MANIFEST_TARGET}"
NAIMAGE_ALLOW_FROZEN_HISTORICAL_RELEASE=0 "${SCRIPT_DIR}/verify-installer.sh" \
  "$manifest_for_verification" \
  "${RUNTIME_DIR}/releases" \
  "${SCRIPT_DIR}/releases/update-public-key.pem"
if [[ -n "$release_manifest_candidate" ]]; then
  mv -f "$release_manifest_candidate" "$RELEASE_MANIFEST_TARGET"
  release_manifest_candidate=""
fi

NAIMAGE_ALLOW_FROZEN_HISTORICAL_RELEASE=0 "${SCRIPT_DIR}/verify-installer.sh"

state_marker_changed=1
printf '%s\n' "$new_head" > "$STATE_FILE"
if ! NAIMAGE_REQUIRE_WATCHER=0 NAIMAGE_REQUIRE_HOST_SECURITY=0 "$VERIFY_SCRIPT"; then
  echo "post-deploy acceptance failed; starting verified rollback" >&2
  exit 1
fi
if naimage_may_clear_recovery_sentinel 1 0 && ! clear_recovery_sentinel; then
  echo "deployment acceptance passed but the recovery sentinel could not be cleared" >&2
  exit 1
fi
release_manifest_committed=1
deployment_complete=1
echo "[$(date -Is)] deploy success ${new_head}"
