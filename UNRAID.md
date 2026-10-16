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

`latest` is convenient for Unraid; record the image digest for a fixed rollback reference. Version/SHA tags remain registry tags and are not intrinsically immutable.

For normal installations use `ghcr.io/imnoname25/notebook:latest` (`stable`). `main`/`edge` are testing channels; main also publishes full `sha-<commit>` tags. Before any update use the migration review and backup procedure below. Startup runs `prisma migrate deploy` before the non-root server starts, so clicking **Update** is already permission to apply the candidate migrations. Disable external auto-update tools for Notebook until this review has happened. Notebook has no self-updater.

## Безопасное ручное обновление и откат

Production deploy из GitHub Actions не подключён. CI проверяет миграции на чистой временной
БД: это проверка установки, а не доказательство безопасности upgrade существующих данных.
Entrypoint остаётся единственным местом `prisma migrate deploy`; не запускать candidate
image против production БД «только для проверки» — даже старт контейнера применит миграции.

### До остановки приложения

1. Дождаться успешных Docker и Android workflow нужного релиза. Выбрать конкретный
   `ghcr.io/imnoname25/notebook@sha256:...` из GHCR; не использовать плавающий latest для
   согласования и последующей установки. Скачать его через `docker pull <digest>`.
2. Зафиксировать текущие image ID/digest и reference без вывода environment:

   ```bash
   docker inspect --format '{{.Image}}' notebook
   docker image inspect --format '{{json .RepoDigests}}' "$(docker inspect --format '{{.Image}}' notebook)"
   ```

   Сохранить digest и существующий XML template/Compose configuration в защищённом месте.
   Не удалять предыдущий image и не выполнять image prune до окончания периода наблюдения.
3. Сравнить `prisma/migrations` текущего и candidate image. Candidate можно создать через
   `docker create --name notebook-update-review --entrypoint /bin/true <digest>` и прочитать
   `docker cp notebook-update-review:/app/prisma/migrations ./candidate-migrations` БЕЗ запуска.
   Текущие файлы доступны через `docker cp notebook:/app/prisma/migrations ./current-migrations`.
   Удалить только этот временный review-контейнер: `docker rm notebook-update-review`.
   Проверить новые SQL, отсутствие изменения старых миграций, destructive DROP/TRUNCATE,
   ALTER TYPE, NOT NULL, unique constraints, data rewrites и длительные locks на больших таблицах.
   Просмотреть связанные изменения приложения и Prisma schema. Отсутствие опасного ключевого
   слова само по себе не означает безопасность миграции.
4. Восстановить свежий SQL dump и копию uploads в отдельную тестовую БД/директории, применить
   candidate на этих копиях, проверить данные, healthcheck и сценарий отката. Не подключать
   staging к production mounts или remote backup targets. Зафиксировать одобрение миграций
   именно для выбранного digest. При сомнении остановить обновление.

### Согласованный safety backup

В maintenance window остановить только Notebook, PostgreSQL оставить работающим. Имена
ниже соответствуют XML templates; для Compose использовать имена контейнеров своей установки.
Резервную копию хранить вне исходного backups mount, приватно, на persistent appdata:

```bash
set -eu
umask 077
safety_dir="/mnt/user/appdata/notebook-update-safety/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$safety_dir"
docker stop notebook
docker exec notebook-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$safety_dir/database.dump"
tar -czf "$safety_dir/uploads.tgz" -C /mnt/user/appdata/notebook/uploads .
tar -czf "$safety_dir/backups.tgz" -C /mnt/user/appdata/notebook/backups .
test -s "$safety_dir/database.dump"
tar -tzf "$safety_dir/uploads.tgz" > /dev/null
tar -tzf "$safety_dir/backups.tgz" > /dev/null
```

Проверить `pg_restore --list` и пробное восстановление dump в отдельную БД. При ошибке backup
не продолжать update. Сохранить защищённую копию прежних env/XML отдельно; пароли,
`SETTINGS_ENCRYPTION_KEY`, signing keys и другие секреты не менять и не выводить в логи.
SQL dump содержит auth-данные: это приватный disaster-recovery backup, не portable application export.
Не удалять PostgreSQL volume/bind directory, uploads или backups. Не использовать `down -v`.

### Применение проверенного образа

Для XML установки в **Edit → Repository** существующего Notebook контейнера задать
проверенный digest. Сохранить container name, network, ports, env и все path mappings.
Apply пересоздаёт только Notebook; PostgreSQL template не переустанавливать.

Для уже существующей Compose установки использовать тот же project name, `.env` и compose
directory. Сначала проверить конфигурацию без печати секретов и скачать image; затем
явно задать согласованный digest (подстановка `<digest>` ниже обязательна):

```bash
export NOTEBOOK_UPDATE_IMAGE='ghcr.io/imnoname25/notebook@sha256:<digest>'
docker compose -f docker-compose.yml -f docker-compose.update.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.update.yml pull notebook
docker compose -f docker-compose.yml -f docker-compose.update.yml up -d --no-deps --no-build --pull never --wait --wait-timeout 180 notebook
```

Overlay меняет только reference образа Notebook. PostgreSQL, volumes, uploads/backups и secrets
остаются из существующей конфигурации. После успешного тестирования закрепить тот же digest
в `NOTEBOOK_IMAGE` существующего `.env`, иначе следующий запуск без overlay может вернуть latest.
`NOTEBOOK_UPDATE_IMAGE` требуется только overlay; не хранить в нём credentials.

Проверить `docker inspect --format '{{.State.Health.Status}}' notebook` (ожидается `healthy`),
`/api/health/ready`, вход, чтение/редактирование и загрузку существующего вложения.
Healthcheck проверяет БД, migrations и writable storage. Если startup/health не прошёл,
не считать update завершённым; сохранить безопасные diagnostics и оставить maintenance window открытым.

### Откат

Если проверено, что текущая schema и новые записи совместимы с прежним приложением,
в XML Repository вернуть сохранённый прежний digest. Для Compose задать его в
`NOTEBOOK_UPDATE_IMAGE` и повторить команду `up` выше. Не изменять mounts, DB credentials
или encryption key. Дождаться readiness и повторить smoke-проверки.

Если миграция несовместима или уже частично изменила данные, смены image недостаточно.
Остановить Notebook. Перед восстановлением сделать отдельную копию текущего состояния
для сохранения новых записей; согласовать потерю изменений после safety backup.
Отдельно одобрить восстановление согласованной пары database dump + uploads в проверенные
новые restore paths/БД, переключить mappings и вернуть прежний digest. Сохранить исходные
production directories и backups до подтверждения восстановления. Автоматического down-migrate,
SQL rollback или удаления volumes нет. Entrypoint не откатывает Prisma migrations.

## Что нужно для будущего автоматического деплоя

- Версия Unraid, архитектура CPU, режим установки (XML или Compose), фактические имена
  контейнеров, compose project/directory и Docker network.
- Существующие persistent пути PostgreSQL/uploads/backups, UID/GID и свободное место
  для safety copies; проверенная процедура restore и допустимое maintenance window.
- Текущий digest, выбранный stable channel, readiness URL, reverse proxy/TLS и правила доступа.
- Отдельно одобренный канал доступа к Unraid (например, ограниченный SSH через private network),
  host-key fingerprint и отдельные deployment credentials в GitHub Environment Secrets.
  При private GHCR — read-only registry credential. Секреты передавать через защищённое хранилище, не чат.
- Protected GitHub Environment с ручным approval миграций для точного digest, сериализация
  deploy, backup/restore rehearsal, health timeout и политика совместимого отката.

До отдельного решения не добавлять self-hosted runner/SSH secrets в workflows, не открывать
Docker socket и не включать production auto-update.

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
