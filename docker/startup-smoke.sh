#!/usr/bin/env bash
# Isolated CI only. Uses the disposable notebook-smoke PostgreSQL/network from the workflow.
set -Eeuo pipefail
image=${1:?image required}
fixture=$(mktemp -d "${TMPDIR:-/tmp}/notebook-startup.XXXXXX")
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then docker logs notebook-startup-upgrade || true; fi
  docker rm -f notebook-startup-files notebook-startup-upgrade >/dev/null 2>&1 || true
  case "$fixture" in "${TMPDIR:-/tmp}"/notebook-startup.*) rm -rf -- "$fixture" ;; esac
  exit "$result"
}
trap cleanup EXIT
database='postgresql://notebook:notebook-smoke-password@notebook-smoke-postgres:5432/notebook'
common=(--rm --network notebook-smoke -e "DATABASE_URL=$database" -e APP_ORIGIN=http://127.0.0.1:3000 -e PUID=99 -e PGID=100 --tmpfs /data/uploads --tmpfs /data/backups)
expect_failure() {
  local expected=$1 pattern=$2; shift 2
  local status=0
  docker run "${common[@]}" "$@" >"$fixture/failure.log" 2>&1 || status=$?
  cat "$fixture/failure.log"
  [ "$status" -eq "$expected" ]
  grep -q "$pattern" "$fixture/failure.log"
  ! grep -q SERVER_SHOULD_NOT_START "$fixture/failure.log"
}
# Real preflight must reject an unavailable DB; server cannot start.
expect_failure 1 'PostgreSQL did not become available' -e DATABASE_URL=postgresql://notebook:synthetic@127.0.0.1:1/notebook -e DATABASE_WAIT_TIMEOUT_SECONDS=5 "$image" sh -c 'echo SERVER_SHOULD_NOT_START'
# Real entrypoint, synthetic CLI hangs/fails. No SQL mutation is attempted in these cases.
printf '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n' >"$fixture/hang.js"
chmod 0755 "$fixture/hang.js"
expect_failure 124 'migrations exceeded 5s' -e MIGRATION_TIMEOUT_SECONDS=5 -v "$fixture/hang.js:/app/node_modules/prisma/build/index.js:ro" "$image" sh -c 'echo SERVER_SHOULD_NOT_START'
printf '#!/usr/bin/env node\nprocess.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n' >"$fixture/ignore-term.js"
chmod 0755 "$fixture/ignore-term.js"
expect_failure 137 'migrations exceeded 5s' -e MIGRATION_TIMEOUT_SECONDS=5 -v "$fixture/ignore-term.js:/app/node_modules/prisma/build/index.js:ro" "$image" sh -c 'echo SERVER_SHOULD_NOT_START'
printf '#!/usr/bin/env node\nprocess.exit(23);\n' >"$fixture/fail.js"
chmod 0755 "$fixture/fail.js"
expect_failure 23 'migrations failed (exit 23)' -v "$fixture/fail.js:/app/node_modules/prisma/build/index.js:ro" "$image" sh -c 'echo SERVER_SHOULD_NOT_START'
printf 'missing engine fixture\n' >"$fixture/missing-engine"
chmod 0644 "$fixture/missing-engine"
expect_failure 1 'Schema Engine is missing' -v "$fixture/missing-engine:/app/prisma/schema-engine:ro" "$image" sh -c 'echo SERVER_SHOULD_NOT_START'

# Build a genuine previous migration state (all except the existing final backfill).
docker create --name notebook-startup-files --entrypoint sh "$image" >/dev/null
docker cp notebook-startup-files:/app/prisma/migrations "$fixture/migrations"
rm -rf -- "$fixture/migrations/202610270001_internal_links_backfill"
cat >"$fixture/prisma.config.ts" <<'CONFIG'
import { defineConfig } from "prisma/config";
export default defineConfig({schema:"/app/prisma/schema.prisma",migrations:{path:"/fixture/migrations"},datasource:{url:process.env.DATABASE_URL!}});
CONFIG
docker exec notebook-smoke-postgres psql -U notebook -d notebook -v ON_ERROR_STOP=1 -c 'CREATE DATABASE notebook_startup_upgrade'
upgrade='postgresql://notebook:notebook-smoke-password@notebook-smoke-postgres:5432/notebook_startup_upgrade'
docker run --rm --network notebook-smoke --entrypoint sh -e "DATABASE_URL=$upgrade" -v "$fixture:/fixture:ro" -v "$fixture/prisma.config.ts:/app/prisma-legacy.config.ts:ro" "$image" -c 'timeout --kill-after=5s 60s ./node_modules/.bin/prisma migrate deploy --config /app/prisma-legacy.config.ts'
docker exec -i notebook-smoke-postgres psql -U notebook -d notebook_startup_upgrade -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ('startup-user','startup@example.test','not-a-login-hash','Synthetic startup',NOW());
INSERT INTO "Notebook" (id,"userId",title,"updatedAt") VALUES ('startup-book','startup-user','Synthetic book',NOW());
INSERT INTO "Section" (id,"notebookId",title,"updatedAt") VALUES ('startup-section','startup-book','Synthetic section',NOW());
INSERT INTO "Page" (id,"sectionId",title,content,"updatedAt") VALUES
('startup-target','startup-section','Synthetic target','[]',NOW()),
('startup-source','startup-section','Synthetic source','[{"type":"paragraph","content":[{"type":"pageLink","props":{"pageId":"startup-target","text":"Alias","alias":true}}]}]',NOW());
SQL
before=$(docker exec notebook-smoke-postgres psql -U notebook -d notebook_startup_upgrade -Atc 'SELECT md5(content::text) FROM "Page" WHERE id = '\''startup-source'\''')
docker run -d --name notebook-startup-upgrade --network notebook-smoke -e "DATABASE_URL=$upgrade" -e APP_ORIGIN=http://127.0.0.1:3000 --tmpfs /data/uploads --tmpfs /data/backups "$image" >/dev/null
for attempt in $(seq 1 60); do
  if docker exec notebook-startup-upgrade node -e 'fetch("http://127.0.0.1:3000/api/health/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then break; fi
  [ "$attempt" -ne 60 ]; sleep 2
done
docker exec notebook-startup-upgrade node -e 'fetch("http://127.0.0.1:3000/api/health").then(async r=>{const h=await r.json();if(!r.ok||h.database!=="connected"||h.migrations!=="ok")process.exit(1)})'
after=$(docker exec notebook-smoke-postgres psql -U notebook -d notebook_startup_upgrade -Atc 'SELECT md5(content::text) FROM "Page" WHERE id = '\''startup-source'\''')
[ "$before" = "$after" ]
[ "$(docker exec notebook-smoke-postgres psql -U notebook -d notebook_startup_upgrade -Atc 'SELECT count(*) FROM "PageLink" WHERE "sourcePageId" = '\''startup-source'\'' AND "targetPageId" = '\''startup-target'\''')" = 1 ]
[ "$(docker logs notebook-smoke-app 2>&1 | grep -c 'Migrations complete')" -ge 2 ]
echo 'Startup recovery gate passed: offline CLI, empty database, current schema, restart, legacy upgrade/content/backlinks, failed DB, hung/failed CLI, missing engine and health.'
