#!/bin/sh
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"
UMASK="${UMASK:-002}"
FIX_PERMISSIONS="${FIX_PERMISSIONS:-0}"
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
APP_DIR=/app
MIGRATION_TIMEOUT_SECONDS="${MIGRATION_TIMEOUT_SECONDS:-180}"
PRISMA_SCHEMA_ENGINE_BINARY="${PRISMA_SCHEMA_ENGINE_BINARY:-$APP_DIR/prisma/schema-engine}"
export PRISMA_SCHEMA_ENGINE_BINARY

case "$MIGRATION_TIMEOUT_SECONDS" in
  ""|*[!0-9]*|????*) echo "MIGRATION_TIMEOUT_SECONDS must be an integer from 5 to 900" >&2; exit 1 ;;
esac
if [ "$MIGRATION_TIMEOUT_SECONDS" -lt 5 ] || [ "$MIGRATION_TIMEOUT_SECONDS" -gt 900 ]; then
  echo "MIGRATION_TIMEOUT_SECONDS must be an integer from 5 to 900" >&2
  exit 1
fi

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

if [ "$(id -u)" -ne 0 ]; then
  echo "Notebook must start as root for storage and migration bootstrap; the application process is dropped to PUID:PGID afterwards" >&2
  exit 1
fi

is_enabled() {
  case "${1:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

run_as_runtime_user() {
  gosu "$PUID:$PGID" env HOME=/tmp XDG_CACHE_HOME=/tmp/.cache "$@"
}

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

for storage_path in "$UPLOAD_DIR" "$BACKUP_DIR"; do
  if ! run_as_runtime_user sh -c 'test -d "$1" && test -w "$1"' sh "$storage_path"; then
    echo "Persistent storage is not writable by the configured PUID and PGID" >&2
    echo "Set FIX_PERMISSIONS=1 for one start if existing files have stale ownership" >&2
    exit 1
  fi
done
echo "Uploads storage writable"
echo "Backups storage writable"

node "$APP_DIR/docker/preflight.mjs"

echo "Running database migrations..."
echo "Migration deadline: ${MIGRATION_TIMEOUT_SECONDS}s (+10s forced termination grace)"
if [ ! -x "$PRISMA_SCHEMA_ENGINE_BINARY" ]; then
  echo "Packaged Prisma Schema Engine is missing or not executable; rebuild the image. Refusing runtime download or server startup." >&2
  exit 1
fi
if timeout --signal=TERM --kill-after=10s "${MIGRATION_TIMEOUT_SECONDS}s" "$APP_DIR/node_modules/.bin/prisma" migrate deploy; then
  :
else
  migration_status=$?
  case "$migration_status" in
    124|137) echo "Prisma migrations exceeded ${MIGRATION_TIMEOUT_SECONDS}s (or were killed). Server will not start. Check image engine, database locks and connectivity; do not bypass migrations." >&2 ;;
    *) echo "Prisma migrations failed (exit $migration_status). Server will not start; inspect the Prisma error above." >&2 ;;
  esac
  exit "$migration_status"
fi
echo "Migrations complete"

echo "Starting Notebook as UID $PUID and GID $PGID (umask $UMASK)"
exec gosu "$PUID:$PGID" env HOME=/tmp XDG_CACHE_HOME=/tmp/.cache "$@"
