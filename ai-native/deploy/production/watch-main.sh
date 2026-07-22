#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_SCRIPT="${SCRIPT_DIR}/deploy-main.sh"
RUNTIME_DIR="${SCRIPT_DIR}/runtime"
STATE_FILE="${RUNTIME_DIR}/deployed-main.sha"
LOG_FILE="${RUNTIME_DIR}/logs/deploy/watch-main.log"
BRANCH="main"
POLL_SECONDS="${POLL_SECONDS:-15}"

mkdir -p "$(dirname "$LOG_FILE")"
cd "$REPO_DIR"
echo "[$(date -Is)] watcher start branch=${BRANCH} poll=${POLL_SECONDS}s" | tee -a "$LOG_FILE"

while true; do
  remote_head="$(git ls-remote origin "refs/heads/${BRANCH}" 2>>"$LOG_FILE" | awk '{print $1}' || true)"
  deployed_head="$(cat "$STATE_FILE" 2>/dev/null || true)"
  if [[ -n "$remote_head" && "$remote_head" != "$deployed_head" ]]; then
    echo "[$(date -Is)] detected ${BRANCH} ${deployed_head:-none} -> ${remote_head}" | tee -a "$LOG_FILE"
    if "$DEPLOY_SCRIPT" >>"$LOG_FILE" 2>&1; then
      echo "[$(date -Is)] deploy finished ${remote_head}" | tee -a "$LOG_FILE"
    else
      echo "[$(date -Is)] deploy failed for ${remote_head}; retrying later" | tee -a "$LOG_FILE"
      sleep 60
    fi
  fi
  sleep "$POLL_SECONDS"
done
