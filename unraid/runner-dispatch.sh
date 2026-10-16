#!/bin/sh
# Install root-owned as /opt/notebook-deploy/dispatch on a separate, non-root runner VM.
# No checkout, Docker socket, sudo, dynamic hostnames or arbitrary remote command.
set -eu
test "$#" -eq 1
case "$1" in ''|*[!0-9]*) exit 64 ;; esac
test "${#1}" -le 20
test "$(id -u)" -ne 0
exec /usr/bin/ssh -T -F /etc/notebook-deploy/ssh_config \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/etc/notebook-deploy/known_hosts \
  -o ClearAllForwardings=yes -o ConnectTimeout=15 \
  -i /etc/notebook-deploy/id_ed25519 \
  notebook-production "dispatch $1"
