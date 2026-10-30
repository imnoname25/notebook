# Studio 4.5.1 — Production Startup Recovery

База: `43a972d8542cc977879964439c4f8aceba005b10`. Аварийный фикс изолирован в `codex/startup-recovery-4-5-1`; Studio 4.4-E, локальные отчёты Studio 4.5 и пользовательская `.vscode/` в `C:\Project\Note` не включены. Production не подключался и не изменялся.

## Root cause и границы доказательств

Подтверждён дефект **упаковки Prisma Schema Engine**. Стадия `production-dependencies` выполняла `npm ci --omit=dev --ignore-scripts`. Это пропускало postinstall `@prisma/engines`, загружающий нативный engine. Стадия builder получала engine при `prisma generate`, но standalone tracing не включает CLI Schema Engine; runtime затем получает production node_modules без него.

Проверен непосредственно опубликованный amd64 образ, а не только Dockerfile:

- OCI index: `sha256:f8275ecc7f64b912c970947ce0c6cd7d00b6e800ce396cf82c861aae687cb36e`.
- amd64 manifest: `sha256:dda849059616fccf14b3eb5b6e5e4f638d877535f7a4474878200040dc2735cc`.
- OCI revision совпадает с `43a972d…`; CLI, Client и `@prisma/engines` — **7.9.1**.
- В проверенных tar-слоях standalone и production node_modules нет `schema-engine-*`. SHA256 скачанных слоёв проверены по OCI manifest. [Аудит](startup451-evidence/image-audit.json).

До подключения к PostgreSQL CLI обеспечивает наличие engine. На холодной системе без бинарника/кэша это сетевое обращение к engine CDN. Поэтому `Loaded Prisma config...` не доказывает, что CLI уже обращается к БД. JS Prisma Client приложения использует `@prisma/adapter-pg` и работает без этого migration engine: наблюдаемое успешное `node server.js` согласуется с дефектом.

Контролируемое воспроизведение с реальным Prisma 7.9.1 на Windows: отдельная копия CLI/engine package без бинарника, отдельные HOME/LOCALAPPDATA/XDG cache, test engine mirror, удерживающий HTTP-ответ, TCP proxy к выделенной PostgreSQL 18. CLI `migrate status` напечатал только `Loaded Prisma config...`, сделал **2 engine fetch requests**, **0 подключений к БД**, остановлен через 6s. С явным существующим engine: deploy на пустую БД — 0, повторный deploy — 0, **0 engine fetch requests**; недоступная БД — nonzero. [Результаты](startup451-evidence/native-reproduction.json). Это нативное воспроизведение механизма, не запуск Linux image и не тест PG17.

Тёплый локальный engine cache маскирует дефект; изоляция cache обязательна для воспроизведения. Старый CI имел public egress и запускал `prisma -v`: возможность скачать engine во время smoke скрывала отсутствие engine в исходном image. Запись в отдельном smoke-контейнере не исправляет опубликованный image.

`prisma.config.ts` использует env URL, dotenv и обычные schema/migrations paths. Версии CLI/Client совпадают, Node24/Bookworm уже содержит OpenSSL/CA. Права runtime, рабочий каталог и availability PG проходят preflight; они не признаны причиной этого зависания. Между `473c1e3` и `43a972d` Dockerfile/entrypoint/config не менялись: последнее UI-изменение не вводило новый механизм миграций. Точный SHA последнего работавшего production image неизвестен, поэтому сравнение с ним не выдумывается.

**Не установлено удалённо:** какая именно причина мешала CDN в production — DNS, TLS, proxy, filtering или другое. Воспроизведён тот же pre-DB stall при недоступном engine endpoint; отсутствие packaged engine подтверждено. Исправление устраняет runtime-зависимость от CDN, без отключения TLS/checksums и без обвинения PostgreSQL.

Официальные справки: [Prisma engine installation](https://docs.prisma.io/docs/orm/v6/more/internals/engines), [PRISMA_SCHEMA_ENGINE_BINARY](https://docs.prisma.io/docs/orm/v6/reference/environment-variables-reference). Для поведения 7.9.1 дополнительно проверены установленные `@prisma/engines` и `@prisma/fetch-engine`, не предполагались API последних версий.

## Изменения

1. Production dependency stage вызывает публичный `prisma --version` **при сборке**, получая/проверяя target-platform engine. Зависимости и lockfile не обновляются.
2. Engine копируется в `/app/prisma/schema-engine`; Docker ENV `PRISMA_SCHEMA_ENGINE_BINARY` указывает на этот файл. Для amd64/arm64 каждая target stage получает собственный native engine, host binary не копируется.
3. Entrypoint проверяет executable engine и отказывает до runtime download при дефектном image.
4. `MIGRATION_TIMEOUT_SECONDS=180` (5–900) ограничивает `prisma migrate deploy` через GNU timeout. По deadline — TERM группе процессов, через 10s — KILL; failure status сохраняется, сервер **не запускается**. Значение 0 не отключает ограничение. Значение и отказ отражаются в логах, DATABASE_URL не печатается wrapper-ом.
5. Автоматические миграции, root bootstrap → numeric PUID/PGID, storage checks и health readiness сохранены. Нет новых/изменённых SQL migrations, API, формата документов или auth.
6. CI проверяет `prisma -v` с `--network none`, а startup выполняет в internal network с PG17. Удалены условия, маскировавшие потребность в CDN.

Не использовать `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`, TLS bypass, `db push`, постоянный skip migrations или HTTP health вместо deploy. Локальной Windows/macOS разработке не задавать Docker Linux engine path.

## Проверки

| Gate | Результат |
|---|---|
| lint/typecheck/version contract/production build | passed локально, чистая база 43a972d + hotfix |
| Unit | 445 passed / 69 skipped в unit configuration |
| Entrypoint contract | 10/10: success, preflight failure, migrate failure, missing engine, invalid deadlines, hang; используются test doubles, это не Docker smoke |
| Native PostgreSQL integration | 68/68 passed, PG18.6, отдельная UTF8/ICU test DB; не PG17 |
| Native standalone `/api/health`, `/api/health/ready` | HTTP200; database connected; migrations ok, 17/17 — PG18, [evidence](startup451-evidence/native-health.json) |
| Linux Docker / PG17 | локально недоступны Docker daemon/CLI и WSL distro; авторитетный результат — новый CI smoke |
| Compose | проверяется отдельно; пропуск не считается успехом |

Первый integration запуск был некорректно подготовлен без schema, затем Windows libc-C test DB не обеспечивала Unicode case-folding (4 search/link assertions). В новой отдельной UTF8/ICU test DB после `migrate deploy` все 68 прошли. Production locale/config не менялись; это исправление подготовки нативного теста, не объяснение production startup bug.

`docker/startup-smoke.sh` дополняет существующий smoke: пустая PG17/повторный запуск/current schema (existing workflow), legacy16→17 с синтетическими Page и PageLink, неизменный hash content и построенный backlink index, недоступная БД, hung CLI, CLI ignoring TERM, failure23, missing engine, health. Все ресурсы disposable CI; production mounts не используются. Injection зависания/ошибки — обозначенный synthetic CLI, а не имитация настоящей миграции.

Первый CI #64 подтвердил offline CLI и реальное применение 17 migrations на PG17.11, после чего Node server сообщил Ready. Сам smoke gate не прошёл host-port health probe после перевода CI network в internal isolation. Probe перенесён внутрь контейнера (`docker exec` → настоящий HTTP localhost health), с теми же критериями HTTP200 и без увеличения ожидания. Это проверяет приложение в выбранной сетевой изоляции; внешний production proxy/host route здесь не считается протестированным. Полный startup gate должен пройти новый CI; первый run не выдаётся за успех.

Старый общий UI baseline на `43a972d`: 52 passed / 18 failed / 7 did not run (предыдущий Studio 4.5). Это не новый прогон hotfix. Среди baseline failures: first-run/login, устаревшие settings/search/Back selectors, shared fixtures и mouse-resize/target-size assertions. Они не отключаются этим исправлением. CI startup gate не объявляется доказательством зелёного общего UI/E2E gate; Studio 4.4-E имеет отдельное незакоммиченное состояние и сюда не переносится.

## Runbook Unraid — выполнять только после отдельного разрешённого maintenance window

### До остановки текущего временного процесса

Не перезапускать рабочий контейнер ради диагностики: текущий `docker exec -d node server.js` исчезнет после restart. Сначала получить исправленный image, проверить его CI и digest, подготовить backup и окно простоя.

Read-only inventory (не выводить `.Config.Env`, пароли или полное inspect в чат):

```sh
docker inspect notebook --format 'image={{.Image}} mounts={{json .Mounts}}'
docker image inspect "$(docker inspect notebook --format '{{.Image}}')" --format '{{json .RepoDigests}} {{json .Config.Labels}}'
docker ps --format '{{.Names}} {{.Image}}'
# Verify the actual PostgreSQL container name before using it below.
docker exec notebook-postgres psql -U notebook -d notebook -Atc 'SHOW server_version'
docker exec notebook-postgres psql -U notebook -d notebook -Atc 'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at'
```

Записать фактические uploads/backups/PGDATA binds, прежний digest и protected XML/config. Внешние auto-updaters должны быть остановлены на maintenance window. Actual production digest и mounts не заменяются registry digest из аудита.

### Backup и rehearsal

Полный пригодный backup production пока **не подтверждён**. ZIP страниц недостаточен. Выбрать защищённый каталог с `umask 077`; не использовать рабочий PGDATA как backup destination. Сохранить SQL dump (содержит приватные auth данные), uploads, backups/appdata и XML/config/secrets в защищённом хранилище.

Для согласованной копии без пользовательских записей: только когда fixed image уже проверен/скачан и согласовано окно, остановить notebook; PostgreSQL оставить работающим. Выполнить `pg_dump -Fc -U notebook -d notebook` через фактический PG-container с redirect в защищённый файл; проверить exit status, `pg_restore --list` и SHA256. Скопировать фактические mounts attachments/uploads и конфигурацию с сохранением ownership. Не копировать живой PGDATA обычным tar вместо pg_dump.

В изолированном PG17 восстановить dump в пустую test DB, uploads — в отдельный каталог; не монтировать production bind/volumes. Проверить вход, чтение страниц/вложений и health fixed image. Удалённый production backup/restore здесь не выполнялся; без пригодного backup production GO не выдается.

### Обновление

1. Использовать только проверенный `ghcr.io/imnoname25/notebook@sha256:<fixed-image-digest>` с OCI revision hotfix. Не повторно тянуть mutable main без сверки.
2. До Apply выполнить offline engine check исправленного image в отдельном контейнере: `docker run --rm --network none --entrypoint sh <fixed-reference> -c 'test -x "$PRISMA_SCHEMA_ENGINE_BINARY" && timeout --kill-after=5s 20s /app/node_modules/.bin/prisma -v'`. Это не обращается к production DB.
3. Сохранить старый image локально, конфигурацию, volumes и secrets. Менять только Repository на fixed reference и при необходимости добавить `MIGRATION_TIMEOUT_SECONDS=180`. Не менять application URLs, PUID/PGID, PG image, mounts или credentials.
4. Ручной Unraid Apply, один application process. Не запускать второй `node server.js` поверх штатного запуска.
5. Лог обязан пройти storage → preflight → database available → migration deadline/deploy → Migrations complete → non-root server. В текущем состоянии 17/17 новых SQL нет. При mismatch, failed history или timeout остановиться; не делать `migrate resolve`/ручную правку history без анализа.
6. Проверить `/api/health` и `/api/health/ready` HTTP200, database connected, migrations ok. Затем вход, дерево, чтение/редактирование synthetic smoke page, autosave, вложения, история/поиск. Не выполнять реальный restore поверх production.
7. Проверить повторный штатный restart только после успешных smoke tests в согласованном окне. Именно он подтверждает устранение зависимости от исчезающего manual exec.

### Откат без удаления данных

Hotfix не меняет SQL migrations/схему/формат данных, поэтому сам по себе не требует отката БД. Остановить только приложение, вернуть сохранённый Repository/config к проверенному прежнему image, сохранить те же volumes, ownership и secrets. Не удалять volumes и не восстанавливать dump поверх живой БД как автоматическую реакцию на failed startup.

**Ограничение:** известный `43a972d` image имеет этот startup defect и не является подтверждённым durable rollback. Если нет другого заранее проверенного исправно стартующего image, возврат к нему восстановит тот же migration hang. Уже проверенный пользователем manual `node server.js` может служить лишь временной аварийной доступностью при подтверждённых 17/17; он не исправляет restart и не заменяет миграции. Поэтому до production Apply нужен либо rehearsed durable fallback, либо явно принятый временный recovery plan и пригодный backup. При нарушении схемы/неожиданных pending migrations — остановиться, не подменять migrator запуском сервера.

## Публикация и изоляция

Изменён только startup/deployment boundary, его tests/docs/env descriptions. Нет изменений Studio 4.4-E, Prisma schema/SQL, зависимостей, UI, PostgreSQL server config или Android. Код проверяется на изолированной ветке; публикация/CI не являются разрешением на production deployment. Итог CI, commit SHA и image digest сообщаются отдельно; tags/production Apply не создаются автоматически.
