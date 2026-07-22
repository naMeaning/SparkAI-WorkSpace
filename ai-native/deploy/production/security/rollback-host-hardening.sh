#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi
if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "usage: $0 /path/to/host-hardening-backup" >&2
  exit 1
fi

backup="$1"
cp -a "${backup}/sshd_config" /etc/ssh/sshd_config
if [[ -f "${backup}/99-iiimage-hardening.conf.previous" ]]; then
  cp -a "${backup}/99-iiimage-hardening.conf.previous" /etc/ssh/sshd_config.d/99-iiimage-hardening.conf
else
  rm -f /etc/ssh/sshd_config.d/99-iiimage-hardening.conf
fi
if [[ -f "${backup}/iiimage.local.previous" ]]; then
  cp -a "${backup}/iiimage.local.previous" /etc/fail2ban/jail.d/iiimage.local
else
  rm -f /etc/fail2ban/jail.d/iiimage.local
fi

sshd -t
systemctl reload ssh
if systemctl is-active --quiet fail2ban; then
  fail2ban-client reload
fi
echo "host hardening rolled back from ${backup}"
