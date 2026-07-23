#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${1:?runtime directory is required}"
IMAGE="${2:-aieyra/iiimage-new-api:local}"
SOURCE_COMMIT="${3:-unknown}"
RESULT_FILE="${4:-}"
CONTAINER="${NAIMAGE_NEW_API_CONTAINER:-${IIIMAGE_NEW_API_CONTAINER:-iiimage-new-api}}"
BACKUP_DIR="${RUNTIME_DIR}/backups"
RETENTION="${NAIMAGE_NEW_API_BACKUP_RETENTION:-${IIIMAGE_NEW_API_BACKUP_RETENTION:-7}}"

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

for command_name in basename cut date docker find grep mkdir mktemp mv realpath rm sha256sum sort stat tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: ${command_name}"
done
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || fail "NAIMAGE_NEW_API_BACKUP_RETENTION (or legacy IIIMAGE_NEW_API_BACKUP_RETENTION) must be a positive integer"
[[ "$SOURCE_COMMIT" == "unknown" || "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "source commit must be a lowercase 40-character Git SHA or unknown"
if [[ -n "$RESULT_FILE" ]]; then
  result_path="$(realpath -m "$RESULT_FILE")"
  runtime_root="$(realpath "$RUNTIME_DIR")"
  case "$result_path" in
    "${runtime_root}"/*) ;;
    *) fail "backup result file must stay inside the production runtime" ;;
  esac
fi
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" == "false" ]] || fail "${CONTAINER} must be stopped before a consistent state backup"

data_source="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
[[ -n "$data_source" && -d "$data_source" ]] || fail "cannot resolve the ${CONTAINER} /data mount"
data_source="$(cd -- "$data_source" && pwd -P)"
[[ "$data_source" != "/" ]] || fail "refusing to back up from filesystem root"
[[ -s "${data_source}/one-api.db" ]] || fail "New API SQLite database is missing or empty"

mkdir -p "$BACKUP_DIR" "${data_source}/managed-image-idempotency"
case "$(cd -- "$BACKUP_DIR" && pwd -P)" in
  "$(cd -- "$RUNTIME_DIR" && pwd -P)"/backups) ;;
  *) fail "backup directory escapes the production runtime" ;;
esac
if find -P "${data_source}/managed-image-idempotency" \( -type l -o \( ! -type d ! -type f \) \) -print -quit | grep -q .; then
  fail "managed image response storage contains an unsupported file type"
fi

stamp="$(date +%Y%m%d-%H%M%S)-$$"
snapshot_dir="${data_source}/.iiimage-backup-${stamp}-$$"
archive="${BACKUP_DIR}/new-api-state-${stamp}.tar.gz"
archive_tmp="${archive}.tmp"
checksum="${archive}.sha256"
result_tmp=""
archive_verified=0
cleanup() {
  case "$snapshot_dir" in
    "$data_source"/.iiimage-backup-*) rm -rf -- "$snapshot_dir" ;;
    *) printf '[WARN] refusing to clean unexpected snapshot path: %s\n' "$snapshot_dir" >&2 ;;
  esac
  rm -f -- "$archive_tmp" "${archive_tmp}.sha256" "${checksum}.tmp"
  if [[ "$archive_verified" != "1" ]]; then
    rm -f -- "$archive" "$checksum"
  fi
  [[ -z "$result_tmp" ]] || rm -f -- "$result_tmp"
}
trap cleanup EXIT
mkdir -m 0700 "$snapshot_dir"

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 64 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  --entrypoint sqlite3 \
  -v "${data_source}:/data:rw" \
  "$IMAGE" \
  /data/one-api.db ".timeout 30000" ".backup '/data/$(basename "$snapshot_dir")/one-api.db'"

[[ -s "${snapshot_dir}/one-api.db" ]] || fail "SQLite backup is missing or empty"
quick_check="$(docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 64 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  --entrypoint sqlite3 \
  -v "${snapshot_dir}:/backup:ro" \
  "$IMAGE" \
  -readonly /backup/one-api.db 'PRAGMA quick_check;')"
[[ "$quick_check" == "ok" ]] || fail "SQLite quick_check failed: ${quick_check}"

printf 'schema=1\ncreated_at=%s\nsource_commit=%s\n' "$(date -Is)" "$SOURCE_COMMIT" > "${snapshot_dir}/backup-metadata.txt"
tar -C "$snapshot_dir" -czf "$archive_tmp" one-api.db backup-metadata.txt \
  -C "$data_source" managed-image-idempotency
[[ -s "$archive_tmp" ]] || fail "New API state archive is empty"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$(basename "$archive_tmp")" > "$(basename "${archive_tmp}.sha256")"
)
"${SCRIPT_DIR}/verify-new-api-backup.sh" "$archive_tmp" "$IMAGE" >/dev/null
rm -f -- "${archive_tmp}.sha256"
mv -- "$archive_tmp" "$archive"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$(basename "$archive")" > "$(basename "$checksum").tmp"
  mv -- "$(basename "$checksum").tmp" "$(basename "$checksum")"
)
archive_verified=1

mapfile -t archives < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'new-api-state-*.tar.gz' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
for ((index=RETENTION; index<${#archives[@]}; index++)); do
  old_archive="${archives[$index]}"
  case "$old_archive" in
    "$BACKUP_DIR"/new-api-state-*.tar.gz)
      rm -f -- "$old_archive" "${old_archive}.sha256"
      ;;
    *) fail "refusing to remove an unexpected backup path" ;;
  esac
done

if [[ -n "$RESULT_FILE" ]]; then
  result_tmp="${result_path}.tmp.$$"
  umask 077
  printf '%s\n' "$archive" > "$result_tmp"
  mv -f -- "$result_tmp" "$result_path"
  result_tmp=""
fi

printf '[PASS] New API state backup: %s\n' "$archive"
