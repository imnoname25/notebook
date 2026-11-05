# Studio 4.4-E.3 — Staging release on Unraid

## Идентификация

- Release base: `b7c4ef6a3f6d8f15325d63740c82e638330b7493` (E/E.1/E.2, HTTP94/94).
- Branch: `staging/studio-4.4-e`; main не изменяется и merge не выполняется.
- Build revision, Actions URL, digest: **ожидаются после CI**. Не запускать по mutable tag вместо подтверждённого digest.
- Studio4.5.1 Schema Engine fix унаследован через `abcac2961a0c7c08403b51be4db82da40a15c37e`: engine копируется в `/app/prisma/schema-engine`, entrypoint проверяет executable и ограничивает migrate deploy по времени. Приложение не стартует при ошибке migration.
- Deployment на Unraid **не выполнялся**; ниже только ручной runbook. Production notebook:3100, notebook-postgres, их mounts/env не изменялись.

## Публикация и проверки

Docker image workflow запускает validate → smoke → publish-staging. Staging publish разрешён только точной staging-ветке и не для PR. Production publish guard остаётся только main/v-tags. Staging tags: `staging-4.4-e` и `staging-4.4-e-<full-build-sha>`; main/edge/latest не публикуются staging job.

В staging переносится **тот же** amd64 image, который проверен smoke: docker save / artifact / docker load, без rebuild. Smoke проверяет packaged engine без сети, standalone build, non-root server, writable staging smoke volumes, миграции на PostgreSQL17, readiness, restart и startup failure gates. Registry readback проверяет digest обоих staging tags, linux/amd64 и OCI revision. Артефакт `notebook-staging-image-<sha>` связывает digest с source/migration identity.

Новая ветка сканируется Gitleaks относительно merge-base с origin/main, не игнорируя release commit. `.gitleaksignore` содержит только три точных fingerprints E.2 source SHA-256 metadata из b7c4ef6, подтверждённых как хеш файла, не credentials. Broad exclusions нет. Docs-only push игнорируется Docker workflow, чтобы запись проверенного digest не пересобирала image циклически. Build SHA и последующий documentation SHA могут различаться; для image использовать именно build SHA.

## Изоляция

| Ресурс | Staging |
|---|---|
| Compose project | notebook-staging |
| App container / port | notebook-staging / private-IP:3101 → 3000 |
| Database | notebook-staging-postgres / PostgreSQL17, notebook_staging role + DB |
| PostgreSQL ports | не публикуются |
| Network | notebook-staging-net, internal:true, только два staging services |
| Data | /mnt/user/appdata/note-staging/{postgres,uploads,backups} |
| Config | /mnt/user/appdata/note-staging/config/.env.staging, mode600 |
| Hostname | отдельный notebook-staging.home.arpa или notebook-staging.<ваш-домен> |

**Cookies не разделяются портами.** Не открывать staging на том же hostname/IP, что production, только с другим портом. Использовать отдельный DNS hostname; APP_ORIGIN должен совпадать с URL браузера. Для Windows добавить отдельную DNS/hosts запись, для Fold — LAN/VPN DNS запись на роутере/резолвере. Production hostname не менять.

По умолчанию bind 127.0.0.1, исходящая сеть закрыта internal bridge. Внешние интеграции и remote backup не настраиваются. Используется новая синтетическая БД, production dump не копируется. Нельзя добавлять production network, PostgreSQL port, env_file production, uploads/backups mounts или Docker socket. Internal network не является полной sandbox против Docker administrator: доступ к Docker daemon остаётся доверенной границей.

## 1. Подготовка вручную в Unraid Terminal

Скачать `docker-compose.staging.yml` и `.env.staging.example` из **проверенного build SHA**, указанного выше, через GitHub. Если используется git checkout, он должен находиться в отдельном staging config каталоге. Не использовать production Compose/.env. Все команды ниже выполнять только после проверки digest и CI.

Сначала read-only проверить mounts production, без вывода secrets/env:

```bash
docker inspect notebook notebook-postgres --format '{{.Name}} {{json .Mounts}}'
```

Убедиться, что выбранный staging root не является production path, symlink или существующей папкой с чужими данными. Если staging уже существует, перейти к разделу обновления, не перезаписывать env/data.

```bash
umask 077
# Resolve proposed paths BEFORE creating anything.
for proposed in /mnt/user/appdata/note-staging /mnt/user/appdata/note-staging/{config,postgres,uploads,backups}; do
  case "$(readlink -m "$proposed")" in
    /mnt/user/appdata/note-staging|/mnt/user/appdata/note-staging/*) ;;
    *) echo 'Stop: unexpected resolved staging path'; exit 1 ;;
  esac
done
mkdir -p /mnt/user/appdata/note-staging/{config,postgres,uploads,backups}
for item in /mnt/user/appdata/note-staging /mnt/user/appdata/note-staging/{config,postgres,uploads,backups}; do
  test ! -L "$item" || { echo 'Stop: staging path is a symlink'; exit 1; }
  case "$(readlink -f "$item")" in
    /mnt/user/appdata/note-staging|/mnt/user/appdata/note-staging/*) ;;
    *) echo 'Stop: unexpected resolved staging path'; exit 1 ;;
  esac
done
cd /mnt/user/appdata/note-staging/config
```

Не выполнять recursive chmod/chown вне staging. Compose create_host_path:false намеренно запрещает молча создавать путь с опечаткой. PUID:PGID99:100, umask002; штатный entrypoint назначит владельца только uploads/backups. PostgreSQL image управляет своим datadir отдельно.

Создать `.env.staging` один раз (не копировать production secrets); `PINNED_IMAGE_FROM_REPORT` заменить на полный проверенный ghcr.io/...@sha256:... из этого отчёта. Секреты не вводятся как литералы команды и не печатаются:

```bash
test ! -e .env.staging || { echo 'Stop: existing staging env; use update procedure'; exit 1; }
{
  printf 'STAGING_IMAGE=%s\n' 'PINNED_IMAGE_FROM_REPORT'
  printf 'STAGING_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
  printf 'STAGING_SETTINGS_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'STAGING_BIND_IP=127.0.0.1\n'
  printf 'STAGING_ORIGIN=http://notebook-staging.home.arpa:3101\n'
} > .env.staging
chmod 600 .env.staging
```

Значения переменных: STAGING_IMAGE — pinned digest; STAGING_DB_PASSWORD — отдельный URL-safe password, STAGING_SETTINGS_KEY — независимый32-byte hex key; STAGING_BIND_IP — loopback, затем конкретный private LAN/VPN IPv4; STAGING_ORIGIN — отдельный staging hostname, без path. Не использовать 0.0.0.0 или production address как browser origin.

## 2. Проверка конфигурации и первый старт

```bash
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging config --quiet
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging pull
staging_image=$(sed -n 's/^STAGING_IMAGE=//p' .env.staging)
# Read-only validation; stdin contains config/secrets, so do not tee or log it.
set -o pipefail
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging config --format json |
  docker run --rm -i --network none --entrypoint node "$staging_image" /app/scripts/check-staging-deployment.mjs
```

Только если validation PASS: сверить OCI revision с build SHA и фактический image digest. Pull должен использовать ghcr.io/imnoname25/notebook@sha256:..., не :main/:edge. Если GHCR private, использовать отдельные read-only package credentials и интерактивный docker login; не помещать token в env приложения или Git.

```bash
docker image inspect "$staging_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.Os}}/{{.Architecture}}'
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging up -d
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging ps
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging logs --tail=100 notebook
```

depends_on ждёт здоровый staging PostgreSQL; entrypoint ждёт БД, применяет migrate deploy с deadline, затем запускает standalone non-root. Никаких prisma db push, server.js bypass или ручных production migrations.

## 3. Создание первого staging admin до открытия LAN

Loopback bind сохраняется до завершения setup. В Unraid Terminal выполнить следующий блок; пароль вводится скрыто, передаётся stdin, не argv/env, response body/cookies не печатаются. Это существующий /api/auth/setup только внутри staging. Если admin уже создан, HTTP409 означает stop, не reset чужих данных.

```bash
(
  read -r -p 'Staging admin email: ' staging_admin_email
  read -r -s -p 'New staging password (12+ characters): ' staging_admin_password
  printf '\n'
  printf '%s\n%s\n' "$staging_admin_email" "$staging_admin_password" |
    docker exec -i notebook-staging node --input-type=module -e '
      let input=""; for await (const chunk of process.stdin) input+=chunk;
      const [email,password]=input.split("\n");
      const response=await fetch("http://127.0.0.1:3000/api/auth/setup", {
        method:"POST",headers:{"content-type":"application/json",origin:process.env.APP_ORIGIN},
        body:JSON.stringify({email,password,name:"Staging admin"})
      });
      console.log("Staging setup HTTP",response.status);
      process.exit(response.status===201?0:1);
    '
)
```

После HTTP201 настроить DNS для отдельного staging hostname, заменить STAGING_BIND_IP в .env.staging на **конкретный LAN/VPN IP Unraid**, снова выполнить config validation и up -d. Не открывать router port-forward/UPnP и не публиковать 3101 в интернет. Для внешнего доступа требуется отдельный HTTPS vhost, сетевое ограничение/VPN и штатная авторизация; TLS verification не отключать. Reverse proxy должен иметь маршрут именно в staging; его настройка не выполняется автоматически этим заданием.

## 4. Ручная проверка Windows/Fold после запуска

```bash
docker exec notebook-staging node -e 'fetch("http://127.0.0.1:3000/api/health").then(async r=>{console.log(r.status,await r.json());process.exit(r.ok?0:1)})'
docker inspect notebook-staging notebook-staging-postgres --format '{{.Name}} {{json .Mounts}} {{json .NetworkSettings.Networks}}'
docker network inspect notebook-staging-net --format '{{.Internal}} {{json .Containers}}'
docker exec notebook-staging-postgres psql -U notebook_staging -d notebook_staging -c 'select current_database(),current_user;'
```

Ожидается health200, database connected, migrations ok; только staging mounts/network, БД/роль notebook_staging. DATABASE_URL намеренно не выводить: он содержит пароль. Не выводить целиком docker inspect Config.Env.

Checklist на синтетических данных: login, дерево; создать заметку; многострочный Notepad paste с пустой строкой; вставка в середину; преобразование нескольких blocks; Single/Split; wide table и horizontal scroll; autosave/reload; history/backlinks; Graphite/Atelier; Fold outer/inner, IME, selection, resize/rotation. Проверить, что production browser session и notebook:3100 продолжают работать, без изменений production notes. Android APK и его production server setting этим этапом не меняются.

После фактического запуска пользователь подтверждает результаты. Ни CI smoke, ни Chrome viewport emulation не считаются проверкой физического Fold или уже работающего Unraid staging.

## 5. Обновление staging

Публиковать только в staging branch, дождаться validate/smoke/publish-staging и verified digest. Сохранить текущий digest, staging PG dump + uploads, приватную env. В .env.staging изменить **только STAGING_IMAGE** на новый pinned digest; не регенерировать пароли для существующей БД. Повторить pull, read-only isolation validator, OCI revision и compose up -d. Затем health и smoke checklist. Это не меняет production.

Для rollback staging использовать прежний digest только при совместимой схеме; иначе остановить staging и восстановить **отдельную staging** БД/файлы из его backup. Не подключать production volumes или restore production.

## 6. Остановка и удаление staging

```bash
cd /mnt/user/appdata/note-staging/config
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging down
```

Удаляются только staging containers и его network; bind data сохраняется. Не использовать docker system/volume prune, wildcard rm, down production project или -v ради очистки. Данные можно оставить для следующего теста либо архивировать; окончательное удаление только после проверки exact resolved staging root и backup, отдельным решением пользователя. Production mounts и containers не трогать.

## Ограничения и фактические результаты

- E.2 app gate: HTTP94/94, unit450 passed /70 DB-gated skipped, integration69/69; app исходники не меняются E.3.
- Staging isolation/CI guards: 12/12 local checks, validate:docker and validate:unraid PASS, Unraid42 tests PASS, Windows runner58 safeguards PASS (без SSH).
- Новый npm run check PASS: version contract, lint, typecheck, unit450 passed /70 skipped, production build. GitHub Docker/Compose/PG17 smoke: результаты дополняются после завершения.
- Локальный Docker engine отсутствует; настоящий Docker/Compose gate выполняется в GitHub Actions, не объявляется локально пройденным.
- На Unraid ничего не запускалось; health/auth/edit/Fold acceptance остаются ручными.
