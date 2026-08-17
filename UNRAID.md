# Notebook on Unraid

Notebook is packaged as two independent containers:

```text
notebook             ghcr.io/imnoname25/notebook:latest
notebook-postgres    postgres:17-alpine
```

The application image is prebuilt. Unraid does not need the source code, Node.js, npm or Docker Compose. The templates live in [`unraid/notebook.xml`](unraid/notebook.xml) and [`unraid/notebook-postgres.xml`](unraid/notebook-postgres.xml). They are ready for a Community Applications submission, but the project is not claiming to be listed in Community Applications yet.

## Quick install through the Unraid GUI

### 1. Create the private Docker network

Unraid templates can select an existing custom network but do not create one. Run this once from the Unraid terminal:

```bash
docker network inspect notebook-net >/dev/null 2>&1 || docker network create notebook-net
```

### 2. Install Notebook PostgreSQL

Open **Apps / Docker → Add Container**, select the `Notebook PostgreSQL` template and fill in a strong `POSTGRES_PASSWORD`. Keep these defaults unless you intentionally update both containers:

```text
Container name: notebook-postgres
Network:        notebook-net
POSTGRES_DB:    notebook
POSTGRES_USER:  notebook
Data:           /mnt/user/appdata/notebook/postgres
```

The template does not publish port `5432` to the host.

`POSTGRES_PASSWORD` is consumed when an empty data directory is initialized. Editing the template value later does not rotate the password inside an existing database.

The less-preferred fallback is regular `bridge` networking with PostgreSQL port `5432` explicitly published and `DATABASE_URL` pointing to the Unraid LAN address. Use it only when a custom network is impossible, bind the port to a trusted LAN interface and never expose it through the router or reverse proxy.

### 3. Install Notebook

Select the `Notebook` template. The required values are:

```text
APP_ORIGIN=http://192.168.1.50:3000
DATABASE_URL=postgresql://notebook:YOUR_HEX_PASSWORD@notebook-postgres:5432/notebook?schema=public
TZ=Asia/Yekaterinburg
```

Generate and save a permanent encryption key:

```bash
openssl rand -hex 32
```

Put the result in `SETTINGS_ENCRYPTION_KEY`. Notebook can start without it, but WebDAV/S3 credentials and TOTP 2FA cannot be configured. Losing or changing an existing key makes remote-backup credentials and the enabled TOTP secret unreadable; preserve the key outside the container.

### 4. Open WebUI

Use **Docker → notebook → WebUI**. When the database has no users, the existing first-run screen creates the administrator; no default password is generated or printed to logs.

## Startup and updates

Every Notebook container start performs this bounded sequence:

1. validates `DATABASE_URL`, `APP_ORIGIN`, optional encryption key and runtime identity;
2. verifies writable uploads and backups;
3. retries PostgreSQL for up to 90 seconds without logging credentials;
4. runs `prisma migrate deploy`;
5. starts the Next.js standalone server as `PUID:PGID`.

Migration failure stops the container; the application is never started over a known incompatible schema. Prisma/PostgreSQL provide migration concurrency handling, so Notebook does not introduce its own migration lock.

Image updates are controlled by Unraid/Docker. Notebook does not pull or replace its own image. Before a major or minor update, create an application backup and retain an independent Unraid backup. A migration may make rolling back to an older image unsafe.

Published image tags are intended to be:

- `edge` and `sha-<commit>` for `main` builds;
- `v1.2.3`, `1.2` and `latest` for a release tag such as `v1.2.3`.

`latest` is convenient for Unraid, while the version and SHA tags provide immutable rollback references.

For normal installations use `ghcr.io/imnoname25/notebook:latest` (`stable`). Use `ghcr.io/imnoname25/notebook:edge` only for testing current `main`. After a stable `v*` release, open **Docker → Check for Updates → notebook → Update**. Unraid retains all environment variables and path mappings, pulls the new digest and recreates only the application container. Startup waits for PostgreSQL and runs `prisma migrate deploy` before the non-root server starts. Create an application backup before schema-changing releases; Notebook intentionally has no self-updater.

## Persistent data and permissions

Recommended appdata layout:

```text
/mnt/user/appdata/notebook/
├── postgres/
├── uploads/
└── backups/
```

Put `appdata`, especially PostgreSQL, on an SSD/NVMe pool when possible. Container mappings are deliberately narrow:

```text
/data/uploads                → /mnt/user/appdata/notebook/uploads
/data/backups                → /mnt/user/appdata/notebook/backups
/var/lib/postgresql/data     → /mnt/user/appdata/notebook/postgres
```

Notebook starts as root only for the bounded storage, PostgreSQL preflight and migration bootstrap. It then replaces the bootstrap process with the standalone server running under numeric `PUID=99`, `PGID=100` with `UMASK=002`. The application tree remains root-owned and is not writable by the runtime identity. Notebook never uses `chmod 777`. If migrated files have stale ownership, set `FIX_PERMISSIONS=1` for one successful startup and then return it to `0`.

PostgreSQL is different: its official entrypoint manages `PGDATA` using the image's own system user. Do not recursively change its directory to `99:100` and do not run a general Unraid permissions repair over the `appdata` share.

`/tmp` remains writable ephemeral storage for import/export archives and Next.js runtime work. It is intentionally not persistent. All important application data is in PostgreSQL and uploads; `/data/backups` contains operational backup archives.

A read-only root filesystem is not enabled by default because Next.js and archive operations require writable temporary space. The container instead uses narrow writable data mounts, a non-root application process, dropped capabilities and `no-new-privileges`.

Include `uploads` and `backups` in the Unraid backup strategy. Do not treat a file copy of a live PostgreSQL data directory as a reliable logical backup. Use Notebook application backup/restore or a consistent `pg_dump` plus uploads archive.

## Reverse proxy

For Nginx Proxy Manager on the same `notebook-net` (attach its container with `docker network connect notebook-net <npm-container-name>` when necessary):

```text
Scheme:                 http
Forward Hostname / IP:  notebook
Forward Port:           3000
WebSocket Support:      not required
```

Enable TLS and set Notebook `APP_ORIGIN` to the exact external origin, for example:

```text
https://notes.example.com
```

Do not add a trailing path. Standard `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto` headers are supported. `APP_ORIGIN=https://...` enables the `Secure` session-cookie flag; a LAN-only `http://192.168...` origin remains usable without it.

## Восстановление доступа администратора

Если единственный администратор забыл пароль или потерял TOTP-устройство и recovery-коды, запустите локальный recovery tool из терминала Unraid:

```bash
docker exec -it notebook node /app/scripts/admin-recovery.mjs
```

Инструмент показывает существующего администратора и предлагает сбросить пароль, отключить TOTP 2FA либо выполнить оба действия. Новый пароль вводится скрыто два раза и никогда не передаётся аргументом командной строки или environment variable. Перед изменением необходимо ввести `RESET`.

Если администраторов несколько, выберите нужного в интерактивном списке либо укажите точное имя, email или ID администратора:

```bash
docker exec -it notebook node /app/scripts/admin-recovery.mjs --user metroom
```

Пароль по-прежнему вводится только интерактивно. Не используйте `docker exec` без `-it` для сброса пароля. Recovery выполняется транзакционно через текущий `DATABASE_URL`, использует тот же scrypt service, что первоначальная настройка Notebook, и не создаёт HTTP endpoint. После любого recovery отзываются все sessions и незавершённые 2FA challenges. При отключении TOTP также удаляются encrypted/pending secrets и recovery-code hashes. Notebook, sections, pages, uploads и Vault не изменяются.

Доступ к Docker daemon фактически даёт административный доступ к приложению и базе данных. Ограничьте доступ к терминалу Unraid и не публикуйте Docker socket.

## Health and logs

The image healthcheck calls the local readiness endpoint and does not depend on `APP_ORIGIN`:

```text
http://127.0.0.1:3000/api/health/ready
```

Useful safe diagnostics:

```bash
docker inspect --format '{{.State.Health.Status}}' notebook
docker logs --tail 100 notebook
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://127.0.0.1:3000/api/health/ready
docker exec notebook sh -c 'id; test -w /data/uploads; test -w /data/backups'
```

Startup logs report validation, database availability, migrations and writable storage without printing `DATABASE_URL`, passwords, encryption keys or note content.

## Diagnostic `docker run` equivalent

The GUI templates are the primary installation method. For diagnostics, their essential equivalent is:

```bash
docker network create notebook-net
mkdir -p /mnt/user/appdata/notebook/{postgres,uploads,backups}

docker run -d --name notebook-postgres \
  --network notebook-net --restart unless-stopped \
  --health-cmd='pg_isready -U notebook -d notebook' \
  -e POSTGRES_DB=notebook -e POSTGRES_USER=notebook \
  -e POSTGRES_PASSWORD='YOUR_HEX_PASSWORD' \
  -v /mnt/user/appdata/notebook/postgres:/var/lib/postgresql/data \
  postgres:17-alpine

docker run -d --name notebook \
  --network notebook-net --restart unless-stopped --init \
  --cap-drop=ALL --cap-add=CHOWN --cap-add=DAC_OVERRIDE --cap-add=FOWNER --cap-add=SETGID --cap-add=SETUID \
  --security-opt=no-new-privileges:true \
  -p 3000:3000 \
  -e APP_ORIGIN='http://192.168.1.50:3000' \
  -e DATABASE_URL='postgresql://notebook:YOUR_HEX_PASSWORD@notebook-postgres:5432/notebook?schema=public' \
  -e SETTINGS_ENCRYPTION_KEY='YOUR_64_HEX_CHARACTER_KEY' \
  -e TZ='Asia/Yekaterinburg' -e PUID=99 -e PGID=100 -e UMASK=002 \
  -v /mnt/user/appdata/notebook/uploads:/data/uploads \
  -v /mnt/user/appdata/notebook/backups:/data/backups \
  ghcr.io/imnoname25/notebook:latest
```

Publishing the templates through Community Applications is a separate moderation/submission step. Until the GHCR package and templates are published from the final GitHub repository, maintainers can test them from their raw template URLs; end users should not be told that a CA listing already exists.

Before Community Applications submission, the maintainer must publish this repository at the URLs embedded in the templates, run the GHCR workflow, create at least one stable `v*` release, verify both templates on real Unraid hardware, provide a stable support destination and submit the raw XML URLs through the current CA moderation process.
