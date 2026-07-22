#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)/runtime"
BACKUP_DIR="${RUNTIME_DIR}/backups/host-hardening-$(date +%Y%m%d-%H%M%S)"
SSHD_DROP_IN_DIR="/etc/ssh/sshd_config.d"
SSHD_TARGET="${SSHD_DROP_IN_DIR}/99-iiimage-hardening.conf"
FAIL2BAN_TARGET="/etc/fail2ban/jail.d/iiimage.local"

mkdir -p "$BACKUP_DIR" "$SSHD_DROP_IN_DIR" /etc/fail2ban/jail.d
cp -a /etc/ssh/sshd_config "$BACKUP_DIR/sshd_config"
if [[ -f "$SSHD_TARGET" ]]; then
  cp -a "$SSHD_TARGET" "$BACKUP_DIR/99-iiimage-hardening.conf.previous"
fi
if [[ -f "$FAIL2BAN_TARGET" ]]; then
  cp -a "$FAIL2BAN_TARGET" "$BACKUP_DIR/iiimage.local.previous"
fi

if [[ ! -s /root/.ssh/authorized_keys ]]; then
  echo "root has no authorized key; refusing to disable password authentication" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends fail2ban

install -m 0644 "${SCRIPT_DIR}/99-iiimage-hardening.conf" "$SSHD_TARGET"
sshd -t

install -m 0644 "${SCRIPT_DIR}/iiimage-jail.conf" "$FAIL2BAN_TARGET"
fail2ban-client -t

systemctl reload ssh
systemctl enable fail2ban
systemctl restart fail2ban

for attempt in {1..20}; do
  if fail2ban-client ping >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    systemctl status fail2ban --no-pager -l >&2 || true
    echo "fail2ban did not become ready" >&2
    exit 1
  fi
  sleep 0.5
done

echo "backup_dir=${BACKUP_DIR}"
sshd -T | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|logingracetime|x11forwarding) '
fail2ban-client status sshd
