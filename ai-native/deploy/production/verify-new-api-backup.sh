#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)"

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

verify_backup() (
  set -Eeuo pipefail
  local archive="$1"
  local image="$2"
  local checksum="${archive}.sha256"
  local listing
  local verify_dir
  local quick_check

  [[ -s "$archive" ]] || fail "New API state archive is missing or empty"
  [[ -s "$checksum" ]] || fail "New API state archive checksum is missing"
  (
    cd -- "$(dirname -- "$archive")"
    sha256sum -c "$(basename "$checksum")" >/dev/null
  ) || fail "New API state archive checksum mismatch"

  listing="$(tar -tzf "$archive")" || fail "New API state archive cannot be listed"
  grep -qx 'one-api.db' <<<"$listing" || fail "New API state archive has no SQLite database"
  grep -qx 'backup-metadata.txt' <<<"$listing" || fail "New API state archive has no metadata"
  grep -Eq '^managed-image-idempotency/?$' <<<"$listing" || fail "New API state archive has no managed image response directory"
  [[ "$(grep -xc 'one-api.db' <<<"$listing")" == "1" ]] || fail "New API state archive must contain exactly one SQLite database"
  [[ "$(grep -xc 'backup-metadata.txt' <<<"$listing")" == "1" ]] || fail "New API state archive must contain exactly one metadata file"
  while IFS= read -r entry; do
    case "$entry" in
      /* | ../* | */../* | */..)
        fail "New API state archive contains an unsafe path"
        ;;
      one-api.db | backup-metadata.txt | managed-image-idempotency | managed-image-idempotency/ | managed-image-idempotency/*)
        ;;
      *)
        fail "New API state archive contains an unexpected entry: ${entry}"
        ;;
    esac
  done <<<"$listing"

  verify_dir="$(mktemp -d)"
  trap 'rm -rf -- "$verify_dir"' EXIT
  tar -xzf "$archive" -C "$verify_dir" one-api.db backup-metadata.txt
  [[ -s "${verify_dir}/one-api.db" ]] || fail "extracted SQLite database is empty"
  grep -qx 'schema=1' "${verify_dir}/backup-metadata.txt" || fail "unsupported New API backup metadata"
  quick_check="$(docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --entrypoint sqlite3 \
    -v "${verify_dir}:/backup:ro" \
    "$image" \
    -readonly /backup/one-api.db 'PRAGMA quick_check;')"
  [[ "$quick_check" == "ok" ]] || fail "backed-up SQLite quick_check failed: ${quick_check}"
)

restore_backup() {
  local runtime_dir="$1"
  local archive="$2"
  local image="$3"
  local expected_source_commit="${4:-}"
  local container="${IIIMAGE_NEW_API_CONTAINER:-iiimage-new-api}"
  local backup_dir="${runtime_dir}/backups"
  local backup_root
  local archive_path
  local data_source
  local restore_dir
  local previous_dir
  local quick_check
  local managed_install_started=0
  local restore_committed=0

  [[ -d "$backup_dir" ]] || fail "missing backup directory: ${backup_dir}"
  backup_root="$(realpath "$backup_dir")"
  archive_path="$(realpath "$archive")"
  case "$archive_path" in
    "${backup_root}"/new-api-state-*.tar.gz) ;;
    *) fail "archive must be a New API state backup inside ${backup_root}" ;;
  esac

  verify_backup "$archive_path" "$image"
  [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" == "false" ]] || fail "${container} must be stopped before state restore"

  data_source="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container" 2>/dev/null || true)"
  [[ -n "$data_source" && -d "$data_source" ]] || fail "cannot resolve the ${container} /data mount"
  data_source="$(cd -- "$data_source" && pwd -P)"
  [[ "$data_source" != "/" ]] || fail "refusing to restore into filesystem root"
  [[ -s "${data_source}/one-api.db" ]] || fail "live New API SQLite database is missing or empty"

  restore_dir="$(mktemp -d "${data_source}/.iiimage-restore.XXXXXX")"
  previous_dir="$(mktemp -d "${data_source}/.iiimage-pre-restore.XXXXXX")"
  cleanup_restore() {
    local status=$?
    local cleanup_status=0
    local preserve_previous=0
    set +e
    if [[ "$restore_committed" != "1" ]]; then
      if [[ -e "${previous_dir}/one-api.db" ]]; then
        if ! rm -f -- "${data_source}/one-api.db" || ! mv -- "${previous_dir}/one-api.db" "${data_source}/one-api.db"; then
          printf '[CRITICAL] failed to put the pre-restore SQLite database back; preserved %s\n' "$previous_dir" >&2
          cleanup_status=1
          preserve_previous=1
        fi
      fi
      if [[ -e "${previous_dir}/one-api.db-wal" ]]; then
        if ! rm -f -- "${data_source}/one-api.db-wal" || ! mv -- "${previous_dir}/one-api.db-wal" "${data_source}/one-api.db-wal"; then
          printf '[CRITICAL] failed to put the pre-restore SQLite WAL back; preserved %s\n' "$previous_dir" >&2
          cleanup_status=1
          preserve_previous=1
        fi
      fi
      if [[ -e "${previous_dir}/one-api.db-shm" ]]; then
        if ! rm -f -- "${data_source}/one-api.db-shm" || ! mv -- "${previous_dir}/one-api.db-shm" "${data_source}/one-api.db-shm"; then
          printf '[CRITICAL] failed to put the pre-restore SQLite SHM back; preserved %s\n' "$previous_dir" >&2
          cleanup_status=1
          preserve_previous=1
        fi
      fi
      if [[ -d "${previous_dir}/managed-image-idempotency" ]]; then
        if ! rm -rf -- "${data_source}/managed-image-idempotency" || ! mv -- "${previous_dir}/managed-image-idempotency" "${data_source}/managed-image-idempotency"; then
          printf '[CRITICAL] failed to put the pre-restore managed image directory back; preserved %s\n' "$previous_dir" >&2
          cleanup_status=1
          preserve_previous=1
        fi
      elif [[ "$managed_install_started" == "1" ]]; then
        if ! rm -rf -- "${data_source}/managed-image-idempotency"; then
          printf '[CRITICAL] failed to remove the newly restored managed image directory\n' >&2
          cleanup_status=1
        fi
      fi
    fi
    case "$restore_dir" in
      "${data_source}"/.iiimage-restore.*) rm -rf -- "$restore_dir" || cleanup_status=1 ;;
      *) printf '[WARN] refusing to clean unexpected restore directory: %s\n' "$restore_dir" >&2; cleanup_status=1 ;;
    esac
    if [[ "$preserve_previous" == "1" ]]; then
      printf '[CRITICAL] retained pre-restore state for manual recovery: %s\n' "$previous_dir" >&2
    else
      case "$previous_dir" in
        "${data_source}"/.iiimage-pre-restore.*) rm -rf -- "$previous_dir" || cleanup_status=1 ;;
        *) printf '[WARN] refusing to clean unexpected previous-state directory: %s\n' "$previous_dir" >&2; cleanup_status=1 ;;
      esac
    fi
    set -e
    if [[ "$status" != "0" ]]; then
      return "$status"
    fi
    return "$cleanup_status"
  }
  trap cleanup_restore EXIT

  tar -xzf "$archive_path" -C "$restore_dir"
  [[ -s "${restore_dir}/one-api.db" ]] || fail "restored SQLite database is missing or empty"
  [[ -f "${restore_dir}/backup-metadata.txt" ]] || fail "restored backup metadata is missing"
  [[ -d "${restore_dir}/managed-image-idempotency" ]] || fail "restored managed image response directory is missing"
  if find -P "$restore_dir" \( -type l -o \( ! -type d ! -type f \) \) -print -quit | grep -q .; then
    fail "New API state archive extracted an unsupported file type"
  fi
  if [[ -n "$expected_source_commit" ]]; then
    grep -qxF "source_commit=${expected_source_commit}" "${restore_dir}/backup-metadata.txt" || fail "backup source commit does not match the previous deployment"
  fi

  mv -- "${data_source}/one-api.db" "${previous_dir}/one-api.db"
  if [[ -e "${data_source}/one-api.db-wal" ]]; then
    mv -- "${data_source}/one-api.db-wal" "${previous_dir}/one-api.db-wal"
  fi
  if [[ -e "${data_source}/one-api.db-shm" ]]; then
    mv -- "${data_source}/one-api.db-shm" "${previous_dir}/one-api.db-shm"
  fi
  if [[ -d "${data_source}/managed-image-idempotency" ]]; then
    mv -- "${data_source}/managed-image-idempotency" "${previous_dir}/managed-image-idempotency"
  fi

  mv -- "${restore_dir}/one-api.db" "${data_source}/one-api.db"
  managed_install_started=1
  mv -- "${restore_dir}/managed-image-idempotency" "${data_source}/managed-image-idempotency"

  quick_check="$(docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --entrypoint sqlite3 \
    -v "${data_source}:/data:ro" \
    "$image" \
    -readonly /data/one-api.db 'PRAGMA quick_check;')"
  [[ "$quick_check" == "ok" ]] || fail "restored live SQLite quick_check failed: ${quick_check}"

  restore_committed=1
  trap - EXIT
  cleanup_restore
  printf '[PASS] restored New API state from %s\n' "$(basename "$archive_path")"
}

for command_name in basename docker find grep mktemp mv realpath rm sha256sum tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: ${command_name}"
done

if [[ "${1:-}" == "--restore" ]]; then
  [[ $# -ge 4 && $# -le 5 ]] || fail "usage: $0 --restore RUNTIME_DIR ARCHIVE IMAGE [EXPECTED_SOURCE_COMMIT]"
  restore_backup "$2" "$3" "$4" "${5:-}"
else
  [[ $# -ge 1 && $# -le 2 ]] || fail "usage: $0 ARCHIVE [IMAGE]"
  verify_backup "$1" "${2:-aieyra/iiimage-new-api:local}"
  printf '[PASS] verified New API SQLite and managed image response backup\n'
fi
