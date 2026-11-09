# Studio 4.4-F — Themes, Typography & Main Integration

## Объём и интеграция

Studio E/E.1/E.2/E.3 интегрированы merge-коммитом `de92bcc`. История staging сохранена. В основной линии остаются startup recovery 4.5.1, локальный Prisma Schema Engine и ограниченное ожидание миграций. Незавершённые материалы Studio 4.5 и пользовательская `.vscode/` исключены из релиза.

Push в main выполняет проверки, но публикация production-образа требует отдельного ручного `workflow_dispatch` с `promote_production=true`. Значение по умолчанию false. Для staging сохранена ветка `staging/studio-4.4-e`, новый канал образов `staging-4.4-f` и неизменяемый тег с полным SHA. Старый образ E.3 доступен по прежнему digest.

## Архитектура тем

`src/lib/themes.ts` содержит единый реестр. Шесть Studio-тем используют общий CSS в `src/app/studio.css` и семантические токены поверх существующих компонентов. Новые темы добавляют наборы токенов без копирования каркаса. Режимы system/light/dark/atmospheric продолжают поддерживаться. Неизвестный browser theme восстанавливается в system, остаточный неизвестный класс удаляется после применения next-themes.

| Тема | Фон | Редактор | Текст | Акцент | Типографика по умолчанию |
|---|---|---|---|---|---|
| Studio Graphite | #14181C | #181D22 | #E5E7E9 | #A4BAC9 | прежний системный sans |
| Studio Atelier | #F3EEE4 | #F8F4EB | #292820 | #786137 | прежний sans, Georgia для заголовка |
| Midnight Ink | #101A28 | #152133 | #DCE8F7 | #78A9E5 | IBM Plex Sans |
| Paper & Coffee | #F1E9DA | #FFF9ED | #40372E | #835734 | Source Sans 3 / Literata |
| Forest Terminal | #0F211C | #142B23 | #E1EBDD | #83B99D | Geist / Inter |
| Nord Studio | #F5F6F8 | #FFFFFF | #292D3D | #5C6498 | Manrope / Inter |

У Paper и Nord акцент и вторичный текст затемнены относительно ориентиров ТЗ для контраста AA. Проверяются пары основного/вторичного текста, навигации, выбранных строк и интерактивных элементов. Подсветка кода использует светлую/тёмную схему Shiki соответственно теме. Выделение, focus, меню, таблицы, история, поиск и стикеры наследуют общие токены. Graphite и Atelier сохраняют свои палитры и особенности.

## Шрифты и лицензии

Семь variable WOFF2 поставляются локально через `next/font/local`, display swap, без внешнего CDN и без изменения зависимостей. Inter, Geist, IBM Plex Sans, Manrope, Source Sans 3, Literata и JetBrains Mono получены из официального google/fonts на закреплённом коммите `5bb28733cec313b63fbd415b574b5ae35c8aa8b8`.

Точные URL, SHA-256 и source commit каждого файла находятся в `src/app/fonts/manifest.json`. Проверка cmap подтвердила АЯаяЁёЖй у всех семи файлов. Исходные OFL notices сохранены рядом с файлами. Полный набор notices также включён в `public/font-licenses.txt`, доступен из настроек и попадает в Docker runtime. Шрифт кода новых тем — JetBrains Mono, старые Studio-темы сохраняют прежний monospace fallback.

## Настройки и синхронизация

`AppearanceProvider` обслуживает авторизованного пользователя. Независимые UI/editor font allowlists и строгая Zod-валидация определены в `appearance-preferences.ts`. Размеры 14/15/18 px соответствуют компактному/стандартному/увеличенному вариантам, пользовательский диапазон 12–28 px. Интервалы 1.45/1.7/1.95. Reset сохраняет выбранную тему и возвращает её шрифты, размер 15 и стандартный интервал.

Предпросмотр меняет CSS variables без пересоздания редактора. Выделение, открытый документ, ширина панелей и font overrides сохраняются при смене темы. CSS typography применяется к редактору и оболочке, содержимое BlockNote остаётся прежним.

Сервер — источник настроек аккаунта. GET выполняется при загрузке Workspace и при возвращении фокуса окна. Между устройствами изменения появляются при следующей загрузке или focus, постоянного realtime-канала нет. Browser cache разделён по userId. Для прежних аккаунтов без настройки однократно импортируется допустимая browser theme, marker последнего пользователя предотвращает перенос темы между аккаунтами.

PATCH выполняются последовательно, устаревшие GET отбрасываются через AbortController и generation. Частичные изменения разных клиентов объединяются атомарно в PostgreSQL JSONB. Для одного и того же поля действует последний успешно записанный запрос. При сетевой ошибке предпросмотр сохраняется, выводится состояние ошибки и действие повтора. После неудачной записи повтор отправляет актуальный полный appearance. Серверная загрузка при ожидающей/ошибочной записи не затирает локальный выбор.

Стабильный adapter next-themes предотвращает abort ожидающего PATCH при смене темы. Это проверяется управляемой задержкой настоящего HTTP-запроса. При смене аккаунта provider размонтируется, его запросы отменяются, cache другого пользователя не применяется.

## Минимальная миграция

В существующем UserSettings отсутствовало расширяемое поле оформления. Добавлена совместимая миграция `202611090001_user_appearance` с JSONB appearance и default {}. Она добавляет одну колонку, существующие значения ширины, пользовательские документы, Page revision, историю и индексы не изменяет. PATCH использует существующий account preferences endpoint, ownership и CSRF. Произвольные fonts, CSS, userId и неизвестные поля отвергаются.

Startup smoke обновлён для теста предыдущего UserSettings без этой колонки. После migrate deploy проверяются default {}, сохранение прежней ширины и прежние проверки content/hash/backlinks. Старый сервер может игнорировать дополнительную колонку при откате образа. Колонку при rollback сохранять.

## Проверки

Окончательный полный HTTP gate прошёл 112/112, retries 0, skipped 0, flaky 0, 27.0 минуты. Это новый полный прогон на отдельной ICU und БД после всех исправлений. Подробности в `themes-4-4-f/checks.json`.

| Проверка | Результат |
|---|---|
| lint, typecheck | PASS |
| production build | PASS |
| unit | 512 PASS / 74 conditional skips |
| PostgreSQL integration | 73/73 PASS, 19 файлов, skips 0 |
| полный HTTP/Chrome | 112/112 PASS, retries/skips/flaky 0 |
| staging isolation/promotion guards | 13/13 PASS |
| Docker packaging / Unraid XML | PASS |
| startup smoke Bash syntax | PASS |
| Unraid Python safeguards | 42/42 PASS |
| Windows runner stubs | 58/58 PASS, SSH не выполнялся |
| Unicode preflight negative | PASS, libc C отклонён до migrations/reset |
| working diff secret scan | PASS, Gitleaks 8.30.1, находок 0 |
| физический Fold / Android IME | ожидается пользовательская приёмка |

Основной unit runner пропускает DB-gated сценарии, они отдельно выполнены настоящим integration suite. HTTP gate использует штатный Next dev для Fiber diagnostics, production build проверен отдельно. Локальный Docker engine недоступен, реальный image/Compose/PG17 startup smoke выполняется CI перед публикацией staging.

Локально доступны PostgreSQL 18.6 и настоящий Chrome. PostgreSQL 17 и Docker runtime проверяются GitHub Actions startup smoke. Физическое устройство в этой сессии отсутствует.

Новые HTTP-тесты используют отдельные синтетические аккаунты и проверяют шесть тем, Single/Split, 1440/1920, 360/840/landscape, поиск, историю, Today, Stickers, настройки, reload, независимость шрифтов, focus-sync второй browser context, ошибки/повтор, неизвестную тему и изоляцию аккаунтов. Проверяется точное равенство Page JSON/revision и отсутствие PATCH Page при изменении оформления. Font requests ограничены origin приложения.

Прежние E2E fixture устанавливают тему через действующий account API, сохраняя browser initial paint. Это требуется после появления серверного источника настроек. Assertions не ослаблены, retries при acceptance выключены.

## Ручная приёмка

- Проверить шесть тем и кириллицу в браузере Windows, Single/Split, длинный документ и широкую таблицу.
- На физическом Fold проверить внешний/внутренний экран, landscape, drawer, поиск, настройки и Android IME.
- Выбрать разные UI/editor fonts и размер, сменить тему, проверить сохранение выбора после reload.
- На втором устройстве войти тем же аккаунтом, вернуть фокус первого окна, проверить синхронизацию.
- Проверить системное выделение текста, сворачивание wrapper и возврат без потери pending autosave.
- Проверить, что тема и шрифты не изменили текст, revision и history документа.

Chrome viewport emulation служит предварительной проверкой. Физический Fold, Android IME и системный масштаб требуют проверки пользователем. Android APK в этом этапе не изменялся.

## Staging runbook

Использовать существующие отдельные `notebook-staging`, `notebook-staging-postgres`, `docker-compose.staging.yml`, hostname staging и `/mnt/user/appdata/note-staging/`. Production mounts, hostname, credentials и DATABASE_URL сохраняют свой отдельный контур. Перед обновлением сделать pg_dump staging и копию staging uploads/backups/config.

После получения digest установить STAGING_IMAGE в отдельном staging env как `ghcr.io/imnoname25/notebook@sha256:...`. Проверить Compose и isolation guard по инструкции E.3. Выполнить pull и up только сервиса notebook из staging Compose. Entrypoint применяет миграцию штатно, при ошибке останавливает запуск. Проверить health, revision, авторизацию, темы/типографику, Single/Split и сохранение после reload.

Для rollback вернуть прежний pinned staging image E.3 `sha256:ebb5299341d00cc8a8701dd6a278e3f5cdbab5b66fb0fbfdfcbef1d209dd3202` в staging env и пересоздать только staging notebook. Дополнительную appearance колонку оставить. Production deployment требует отдельного решения.

### Команды обновления существующего staging

Из каталога staging Compose на Unraid после сохранения отдельного staging backup и замены STAGING_IMAGE в .env.staging на проверенный digest этой сборки.

```bash
set -o pipefail
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging config --quiet
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging pull notebook
staging_image=$(sed -n 's/^STAGING_IMAGE=//p' .env.staging)
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging config --format json |
  docker run --rm -i --network none --entrypoint node "$staging_image" /app/scripts/check-staging-deployment.mjs
```

Продолжать только после успешной проверки изоляции. Не сохранять вывод Compose с секретами в лог.

```bash
docker image inspect "$staging_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.Os}}/{{.Architecture}}'
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging up -d --no-deps notebook
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging ps
docker compose -p notebook-staging -f docker-compose.staging.yml --env-file .env.staging logs --tail=100 notebook
docker exec notebook-staging node -e 'fetch("http://127.0.0.1:3000/api/health").then(async r=>{console.log(r.status,await r.json());process.exit(r.ok?0:1)})'
```

Первое развёртывание staging, генерация отдельных secrets, loopback setup и настройка отдельного hostname описаны в `STUDIO_STAGING_RELEASE_4_4_E_3.md`. Этот runbook обновляет существующий staging. Если предыдущего staging нет, выполнить первоначальную процедуру E.3 с новым pinned image.

## Диагностические прогоны

Первый полный HTTP-прогон завершился 99/102. Тест геометрии унаследовал серверную Atelier вместо исходной system. Fixture теперь задаёт system явно. Сценарий цикла тем вырос с шести до десяти переходов с reload и превысил общий бюджет одного теста. Переходы выделены в десять самостоятельных проверок с прежними assertions и стандартными таймаутами. Touch table reload один раз не завершился за 10 секунд; trace содержит незавершённый document request. Тест усилен проверкой фактически сохранённого merged/split состояния через API, затем ждёт DOMContentLoaded, успешный GET документа и шесть таблиц. Полная причина единственного задержанного navigation request не доказана. Увеличения таймаутов и retries нет. Отдельный диагностический rerun этих сценариев и шести тем прошёл 26/26.

В ходе визуальной проверки найден white foreground штатного codeBlock до завершения lazy Shiki. В Studio задан semantic editor-text для самого блока, а токены Shiki используют правильную светлую/тёмную схему. HTTP проверяет computed color блока во всех шести темах.

Второй полный прогон завершился 110/112. Для новой БД был ошибочно унаследован Windows libc C вместо ICU und исходных тестовых БД. Несмотря на одинаковые datcollate/datctype=C и UTF8 encoding, datlocprovider различался. Прямой SQL lower('ТелоКварц') и to_tsvector подтвердил отсутствие кириллического case folding только в этой БД. В HTTP ответе запрос телокварц возвращал пустой список при сохранённом mixed-case токене. Это ограничение тестовой locale, поисковая логика и схема FTS не изменялись.

Окончательный прогон использует новую БД с ICU und. В global-setup добавлена ранняя parameterized SQL проверка lower для ЁЖИК ТЕЛОКВАРЦ перед migrations/reset. Negative check на libc C прошёл с ожидаемым явным отказом. Для реального сервера необходима Unicode-capable locale. Production locale в этом этапе не менялась и не исследовалась.

Первоначальная проверка включения OFL notices учитывала исходные CRLF как различие содержимого. Проверка нормализует только окончания строк, сохраняя сравнение полного текста лицензии. Загрузка неизвестного theme сначала оставляла старый CSS-класс, это исправлено lifecycle cleanup next-themes и проверено в Chrome. Поля типографики получили явные accessible names для однозначного выбора.

## Группы файлов релиза

- Интеграция и безопасная публикация — docker-publish workflow, docs/automation.md, staging/release contract tests.
- Темы — themes.ts, studio.css, общий scope тематических CSS, theme-settings, document alignment и palette tests.
- Типографика — appearance-preferences, AppearanceProvider, TypographySettings, local font assets и notices, appearance.css, layout и account preferences API/service.
- Хранение — одна additive UserSettings migration, Prisma schema, PostgreSQL integration tests и upgrade startup smoke.
- Регрессии — единый server-authoritative theme fixture, обновлённые прежние E2E, themes-typography.spec.ts и Unicode locale preflight.
- Доказательства — этот документ и themes-4-4-f. Пользовательские .vscode и десять проверенных файлов незавершённой Studio 4.5 сохранены по исходным SHA-256 и исключены из коммитов.

## Визуальные доказательства

Сохранены 60 настоящих Chrome screenshots с одинаковым синтетическим содержимым. По каждой теме также доступны Split 1920, landscape, настройки, история, поиск, Today и Stickers в той же папке. Скриншоты не являются физической проверкой Fold.

| Тема | Single 1440 | Узкий 360 | Внутренний 840 |
|---|---|---|---|
| studio-graphite | [Desktop](themes-4-4-f/studio-graphite-single-1440.png) | [Outer](themes-4-4-f/studio-graphite-outer.png) | [Inner](themes-4-4-f/studio-graphite-inner.png) |
| studio-atelier | [Desktop](themes-4-4-f/studio-atelier-single-1440.png) | [Outer](themes-4-4-f/studio-atelier-outer.png) | [Inner](themes-4-4-f/studio-atelier-inner.png) |
| midnight-ink | [Desktop](themes-4-4-f/midnight-ink-single-1440.png) | [Outer](themes-4-4-f/midnight-ink-outer.png) | [Inner](themes-4-4-f/midnight-ink-inner.png) |
| paper-coffee | [Desktop](themes-4-4-f/paper-coffee-single-1440.png) | [Outer](themes-4-4-f/paper-coffee-outer.png) | [Inner](themes-4-4-f/paper-coffee-inner.png) |
| forest-terminal | [Desktop](themes-4-4-f/forest-terminal-single-1440.png) | [Outer](themes-4-4-f/forest-terminal-outer.png) | [Inner](themes-4-4-f/forest-terminal-inner.png) |
| nord-studio | [Desktop](themes-4-4-f/nord-studio-single-1440.png) | [Outer](themes-4-4-f/nord-studio-outer.png) | [Inner](themes-4-4-f/nord-studio-inner.png) |

## Вердикт

CONDITIONAL GO для ручной проверки staging. Docker CI, реальный startup smoke PostgreSQL 17 и публикация staging успешно завершены. Полная приёмка физического Fold и Android IME остаётся за пользователем. Production release требует отдельного решения, backup и production acceptance. Digest и фактические CI ссылки приведены ниже и в JSON evidence.

## Опубликованная сборка и CI

Код и staging build revision `447122a68315e1ea677616d047f73e170eb9e874`. Четыре логических коммита — `de92bcc` интеграция, `ef90a3b` темы, `273cace` типографика, `447122a` тесты и документация. Последующий docs-only коммит фиксирует уже полученные CI/registry evidence, Docker image остаётся привязанным к build revision.

- [Staging Docker CI](https://github.com/imnoname25/notebook/actions/runs/42626817113) — SUCCESS, validate/smoke/publish-staging успешны.
- [Main Docker CI](https://github.com/imnoname25/notebook/actions/runs/42626763453) — SUCCESS, production publish пропущен согласно ручному promotion guard.
- [Android CI](https://github.com/imnoname25/notebook/actions/runs/42626763304) — SUCCESS, release job пропущен. Исходники APK этим этапом не изменялись.

CI подтвердил Linux amd64 build, runtime dependencies/permissions, offline Prisma CLI, пустую PostgreSQL 17 БД, current schema/restart, legacy upgrade с сохранением content/hash/backlinks и UserSettings, unavailable DB, hung/failed CLI, missing engine и health. Compose validation выполнялась на синтетических значениях без подключения к Unraid.

Проверенный образ для .env.staging

```dotenv
STAGING_IMAGE=ghcr.io/imnoname25/notebook@sha256:d35be34efce3ef777600531c189bef6d34416bb8f3f3410faf3f87298ab6747a
```

Теги `staging-4.4-f` и `staging-4.4-f-447122a68315e1ea677616d047f73e170eb9e874` разрешились в тот же digest. OCI revision и config проверены чтением GHCR manifests/blobs, platform linux/amd64, PRISMA_SCHEMA_ENGINE_BINARY=/app/prisma/schema-engine, NOTEBOOK_CHANNEL=staging.

Production main и edge до/после публикации сохранили digest `sha256:35c58de7ecaf31551b02451cb6b9bc6fca1de422c24fecdb895c826708d7732e`. Main/staging push не запускал production deployment. Фактические run/job результаты сохранены в `themes-4-4-f/ci.json`, registry verification — в `themes-4-4-f/registry.json`.

Для обновления staging использовать приведённый выше runbook с этим pinned image. Выполнить пользовательскую проверку Windows/Fold до решения о production release.
