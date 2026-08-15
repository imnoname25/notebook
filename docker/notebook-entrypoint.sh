#!/bin/sh
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"
UMASK="${UMASK:-002}"
FIX_PERMISSIONS="${FIX_PERMISSIONS:-0}"
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
APP_DIR=/app

case "$PUID" in
  ""|*[!0-9]*) echo "PUID must be a positive numeric UID" >&2; exit 1 ;;
esac
case "$PGID" in
  ""|*[!0-9]*) echo "PGID must be a positive numeric GID" >&2; exit 1 ;;
esac
if [ "$PUID" -eq 0 ] || [ "$PGID" -eq 0 ]; then
  echo "Notebook refuses to run the application as root; set positive PUID and PGID values" >&2
  exit 1
fi
case "$UMASK" in
  [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) ;;
  *) echo "UMASK must be a three- or four-digit octal value" >&2; exit 1 ;;
esac

umask "$UMASK"
cd "$APP_DIR"

is_enabled() {
  case "${1:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

run_as_notebook() {
  if [ "$(id -u)" -eq 0 ]; then
    gosu "$PUID:$PGID" env HOME=/tmp XDG_CACHE_HOME=/tmp/.cache "$@"
  else
    "$@"
  fi
}

if [ "$(id -u)" -eq 0 ]; then
  for storage_path in "$UPLOAD_DIR" "$BACKUP_DIR"; do
    mkdir -p "$storage_path"
    if is_enabled "$FIX_PERMISSIONS"; then
      echo "Repairing persistent storage ownership"
      chown -R "$PUID:$PGID" "$storage_path"
    else
      chown "$PUID:$PGID" "$storage_path"
    fi
    chmod 0770 "$storage_path"
  done
fi

for storage_path in "$UPLOAD_DIR" "$BACKUP_DIR"; do
  if ! run_as_notebook sh -c 'test -d "$1" && test -w "$1"' sh "$storage_path"; then
    echo "Persistent storage is not writable by the configured PUID and PGID" >&2
    echo "Set FIX_PERMISSIONS=1 for one start if existing files have stale ownership" >&2
    exit 1
  fi
done
echo "Uploads storage writable"
echo "Backups storage writable"

run_as_notebook node "$APP_DIR/docker/preflight.mjs"

echo "Running database migrations..."
run_as_notebook "$APP_DIR/node_modules/.bin/prisma" migrate deploy
echo "Migrations complete"

echo "Starting Notebook as UID $PUID and GID $PGID (umask $UMASK)"
if [ "$(id -u)" -eq 0 ]; then
  exec gosu "$PUID:$PGID" env HOME=/tmp XDG_CACHE_HOME=/tmp/.cache "$@"
fi
exec "$@"
