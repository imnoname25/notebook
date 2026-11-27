#!/usr/bin/env bash
set -Eeuo pipefail

image=${1:?Expected the smoke-tested image}
network=notebook-editor-ci
postgres=notebook-editor-ci-db
app=notebook-editor-ci-app
export E2E_BASE_URL=http://127.0.0.1:3100
export E2E_EXTERNAL_SERVER=1 E2E_RESET_DATABASE=1 E2E_BROWSER_CHANNEL=chromium
export TEST_RESET_DATABASE=1 TEST_SAVED_HTTP_ORIGIN=$E2E_BASE_URL
export SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 24)
export E2E_DATABASE_URL=postgresql://notebook:$POSTGRES_PASSWORD@127.0.0.1:55432/notebook
export TEST_DATABASE_URL=$E2E_DATABASE_URL
database=postgresql://notebook:$POSTGRES_PASSWORD@$postgres:5432/notebook
storage=$(mktemp -d "${RUNNER_TEMP:-/tmp}/notebook-editor-ci.XXXXXX")
export UPLOAD_DIR="$storage/uploads" BACKUP_DIR="$storage/backups"
mkdir -p "$UPLOAD_DIR" "$BACKUP_DIR"

cleanup() {
  status=$?
  docker logs "$app" > editor-ci-logs/container.log 2>&1 || true
  docker logs "$postgres" > editor-ci-logs/postgresql.log 2>&1 || true
  docker rm -fv "$app" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$storage"
  exit "$status"
}
mkdir -p editor-ci-logs
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" -p 127.0.0.1:55432:5432 \
  -e POSTGRES_PASSWORD -e POSTGRES_USER=notebook -e POSTGRES_DB=notebook \
  -e 'POSTGRES_INITDB_ARGS=--locale-provider=icu --icu-locale=und --locale=C.UTF-8' postgres:17-alpine >/dev/null

start_app() {
  docker run -d --name "$app" --network "$network" -p 127.0.0.1:3100:3000 --init \
    -e "DATABASE_URL=$database" -e "APP_ORIGIN=$E2E_BASE_URL" -e SETTINGS_ENCRYPTION_KEY \
    -e "SAVED_ITEM_TITLE_ORIGINS=$1" -e "PUID=$(id -u)" -e "PGID=$(id -g)" \
    --mount "type=bind,src=$UPLOAD_DIR,dst=/data/uploads" \
    --mount "type=bind,src=$BACKUP_DIR,dst=/data/backups" "$image" >/dev/null
  # The published port can reset connections before the entrypoint starts Next.js.
  curl --fail --retry 45 --retry-delay 2 --retry-all-errors --retry-max-time 90 --max-time 5 \
    --silent --show-error "$E2E_BASE_URL/api/health/ready" > editor-ci-logs/readiness.json
}

start_app 0
fts=$(docker exec "$postgres" psql -U notebook -d notebook -Atc \
  "SELECT to_tsvector('simple', 'телокварц') @@ plainto_tsquery('simple', 'телокварц')")
if [[ "$fts" != t ]]; then
  echo 'PostgreSQL text search fixture does not tokenize Cyrillic' >&2
  exit 1
fi
npx --no-install vitest run --config vitest.integration.config.mts | tee editor-ci-logs/integration.log
npx --no-install playwright test --output=editor-ci-logs/playwright-full | tee editor-ci-logs/playwright-full.log
npx --no-install playwright test \
  --grep 'page order persists|native block handle|page rows drag|native selection transforms|Ctrl.C copies the visible link text|light: mobile shell|studio-graphite: responsive composition|nord-studio: real workspace|studio-graphite: independent writers|studio-graphite: headings, native slash' \
  --output=editor-ci-logs/playwright-repeat | tee editor-ci-logs/playwright-repeat.log

docker logs "$app" > editor-ci-logs/container-default.log 2>&1
docker rm -fv "$app" >/dev/null
start_app 1
SAVED_ITEM_TITLE_ORIGINS=1 npx --no-install playwright test --grep 'adopts the website title' \
  --output=editor-ci-logs/playwright-feature-flags | tee editor-ci-logs/playwright-feature-flags.log
