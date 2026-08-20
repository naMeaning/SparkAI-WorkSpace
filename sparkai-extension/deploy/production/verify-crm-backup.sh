#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/runtime"
BACKUP_DIR="${RUNTIME_DIR}/backups"

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

for command_name in awk basename cut date docker find grep head realpath sha256sum sort; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: ${command_name}"
done

[[ $# -le 1 ]] || fail "usage: $0 [crm-backup.sql]"
[[ -d "$BACKUP_DIR" ]] || fail "missing backup directory: ${BACKUP_DIR}"

if [[ $# -eq 1 ]]; then
  backup_candidate="$1"
else
  backup_candidate="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ai_native_crm-*.sql' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
[[ -n "$backup_candidate" ]] || fail "no CRM backup found"

backup_root="$(realpath "$BACKUP_DIR")"
backup_path="$(realpath "$backup_candidate")"
case "$backup_path" in
  "${backup_root}"/ai_native_crm-*.sql) ;;
  *) fail "backup must be an ai_native_crm SQL file inside ${backup_root}" ;;
esac
[[ -s "$backup_path" ]] || fail "backup is empty: ${backup_path}"

mysql_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' iiimage-mysql 2>/dev/null || true)"
[[ "$mysql_status" == "healthy" ]] || fail "iiimage-mysql is ${mysql_status:-missing}, expected healthy"

verify_database="iiimage_restore_verify_$(date +%Y%m%d%H%M%S)_$$"
database_created=0

mysql_query() {
  local query="$1"
  docker exec iiimage-mysql sh -lc 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot --batch --skip-column-names -e "$1"' sh "$query"
}

cleanup() {
  if [[ "$database_created" == "1" ]]; then
    mysql_query "DROP DATABASE IF EXISTS \`${verify_database}\`" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mysql_query "CREATE DATABASE \`${verify_database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" >/dev/null
database_created=1

if ! docker exec -i iiimage-mysql sh -lc 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot "$1"' sh "$verify_database" <"$backup_path"; then
  fail "backup import failed"
fi

expected_tables=(
  crm_account_events
  crm_agent_relationships
  crm_agents
  crm_audit_logs
  crm_commissions
  crm_effective_customers
  crm_enterprise_monthly_settlements
  crm_ledger_entries
  crm_offline_recharge_requests
  crm_risk_cases
  crm_schema_migrations
  crm_settings
  crm_user_profiles
  crm_users
  crm_withdrawal_commission_allocations
  crm_withdrawals
)

actual_tables="$(mysql_query "SELECT table_name FROM information_schema.tables WHERE table_schema = '${verify_database}' AND table_type = 'BASE TABLE' ORDER BY table_name")"
for expected_table in "${expected_tables[@]}"; do
  grep -qxF "$expected_table" <<<"$actual_tables" || fail "restored backup is missing table: ${expected_table}"
done

migration_count="$(mysql_query "SELECT COUNT(*) FROM \`${verify_database}\`.crm_schema_migrations")"
[[ "$migration_count" =~ ^[0-9]+$ && "$migration_count" -ge 3 ]] || fail "restored migration history is incomplete: ${migration_count}"

check_targets=""
for expected_table in "${expected_tables[@]}"; do
  check_targets+="\`${verify_database}\`.\`${expected_table}\`,"
done
check_output="$(mysql_query "CHECK TABLE ${check_targets%,} QUICK")"
ok_count="$(awk -F '\t' '$3 == "status" && $4 == "OK" { count += 1 } END { print count + 0 }' <<<"$check_output")"
[[ "$ok_count" -eq "${#expected_tables[@]}" ]] || fail "only ${ok_count}/${#expected_tables[@]} restored tables passed CHECK TABLE"

restored_user_count="$(mysql_query "SELECT COUNT(*) FROM \`${verify_database}\`.crm_users")"
backup_sha256="$(sha256sum "$backup_path" | awk '{ print $1 }')"

mysql_query "DROP DATABASE \`${verify_database}\`" >/dev/null
database_created=0
remaining_database="$(mysql_query "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${verify_database}'")"
[[ "$remaining_database" == "0" ]] || fail "temporary restore database was not removed"

printf '[PASS] CRM backup restore: file=%s sha256=%s tables=%s migrations=%s users=%s\n' \
  "$(basename "$backup_path")" \
  "$backup_sha256" \
  "${#expected_tables[@]}" \
  "$migration_count" \
  "$restored_user_count"
