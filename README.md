# Notebook

Notebook — простая self-hosted цифровая записная книжка с основной моделью **Notebook → Section → Page**. Веб-интерфейс даёт три спокойные рабочие области на desktop и последовательную навигацию на телефоне. Контент страниц редактируется визуально в BlockNote и автоматически сохраняется как структурированный JSON.

## Что уже работает

- первый запуск и создание локального администратора;
- вход, выход, logout на всех устройствах и серверные сессии с 30-дневным idle / 90-дневным absolute lifetime;
- CRUD, ручной порядок блокнотов, вложенных разделов и страниц;
- полноценная корзина для блокнотов, разделов и страниц с восстановлением, окончательным удалением и очисткой;
- drag-and-drop сортировка блокнотов, разделов одного родителя и страниц с keyboard accessibility;
- PostgreSQL Full Text Search по страницам, разделам и блокнотам с RU/EN mixed-text ranking, prefix title fallback и безопасной подсветкой;
- встроенные и пользовательские шаблоны страниц, создание из шаблона и сохранение текущей страницы как шаблона;
- горячие клавиши поиска, создания страницы и немедленного сохранения;
- история версий страниц с read-only preview, безопасным restore и retention;
- цвета и Lucide-иконки блокнотов из безопасных allowlist;
- перемещение страниц между разделами, разделов между блокнотами и дублирование страниц;
- breadcrumbs `Блокнот / Раздел / Страница`;
- rate limiting локальной авторизации без дополнительных сервисов;
- TOTP 2FA, одноразовые recovery-коды и challenge до создания сессии;
- Capacitor Android-клиент с выбором self-hosted сервера и release APK pipeline;
- отдельный ciphertext-only Vault API foundation без смешивания с заметками;
- избранные страницы;
- BlockNote: форматирование, заголовки H1–H3, списки, checklist, quote, code, ссылки, таблицы и изображения;
- autosave заголовка и JSON-контента с debounce 750 мс и статусом сохранения;
- локальные пользовательские uploads с проверкой MIME-сигнатуры и лимитом размера;
- светлая, тёмная и системная темы;
- responsive layout от 360 px и PWA manifest;
- healthcheck приложения и PostgreSQL;
- Docker Compose с двумя persistent volumes.
- печать/PDF-friendly mode, улучшенный Markdown и standalone HTML ZIP export;
- независимые WebDAV и S3-compatible remote backup copies, remote retention/restore и operational notifications.

Offline sync намеренно не входит в текущий MVP.

## Архитектура

Приложение — один Next.js сервис. App Router обслуживает React UI и route handlers API. Prisma работает с PostgreSQL через `node-postgres`. Первичные данные находятся только в PostgreSQL и `/data/uploads`; operational backup-копии — в `/data/backups`.

```text
src/app/                 страницы, layout, manifest, API route handlers
src/components/auth/     первый запуск и вход
src/components/notebook/ рабочий UI, панели, BlockNote, autosave
src/components/ui/       базовые shadcn-style компоненты
src/lib/                 auth, Prisma, validation, ownership, uploads
prisma/                  schema и версионируемые миграции
e2e/                     Playwright happy-path и подготовка test database
public/                  PWA icon placeholder
```

Ownership проверяется сервером на каждом чтении и изменении через цепочку `Page → Section → Notebook → User`; для истории используется `PageVersion → Page → Section → Notebook → User`. Изменение ID в запросе не открывает чужой объект. Мутации используют strict same-site cookie и проверку `Origin`, когда браузер его отправляет.

## История версий и autosave

Autosave продолжает обновлять страницу с debounce 750 мс. Snapshot создаётся не чаще одного раза в 5 минут, только если документ изменился; `Ctrl/Cmd + S` создаёт snapshot без временного порога, но также подавляет дубликаты. Перед restore текущее состояние автоматически попадает в историю. Затем выбранный JSON BlockNote становится текущим, а `searchText` пересчитывается.

На страницу хранится не более 100 версий и только версии не старше 30 дней. Retention выполняется после нового snapshot, поэтому cron и background worker не нужны. Metadata списка загружается отдельно от полного JSON preview. Поле `Page.revision` обеспечивает optimistic concurrency: запоздалый autosave не может перезаписать результат restore.

## Перемещение, дублирование и внешний вид

Явное действие `Переместить` переносит страницу в активный принадлежащий пользователю раздел; `Переместить раздел` переносит всё его дерево в активный блокнот. Source/destination order пересчитывается одной Prisma transaction. Cross-container DnD намеренно не добавлен: существующий DnD отвечает за стабильную сортировку внутри родителя.

Дублирование копирует title, BlockNote JSON и `searchText`, вставляет копию после оригинала и не копирует историю, favorite или deleted state. Цвета и иконки блокнота выбираются в небольшом dialog; API принимает только заранее определённые identifiers.

## Авторизация и сессии

Пять неудачных попыток входа за 10 минут для пары IP+login приводят к блокировке примерно на 15 минут. Limiter хранится в памяти процесса и подходит для single-instance self-hosted deployment; интерфейс позволяет позднее заменить storage. Успешная авторизация очищает counter, а ответы не раскрывают существование email.

Сессия имеет 30-дневный idle timeout и 90-дневный absolute lifetime. `lastUsedAt` обновляется с ограниченной частотой. Истёкшие сессии opportunistic удаляются при создании новой; кнопка «Выйти на всех устройствах» отзывает все сессии текущего пользователя, включая текущую.

В `Настройки → Безопасность` можно включить RFC-compatible TOTP: текущий пароль → QR/text secret → проверка шестизначного кода. Сессия при входе создаётся только после второго фактора. TOTP secret хранится через AES-256-GCM с `SETTINGS_ENCRYPTION_KEY`; 10 recovery-кодов показываются один раз и в БД остаются только их SHA-256 hashes. TOTP challenge ограничен пятью попытками и имеет короткий срок жизни. Потеря всех authenticators и recovery-кодов без резервной копии БД/ключа потребует административного восстановления непосредственно через БД.

## Android и Vault foundation

Capacitor project находится в `android-client/`; инструкции по APK, self-hosted URL, signing key и локальной сборке — в [ANDROID.md](ANDROID.md). Push в `main` создаёт debug artifact, а стабильный tag `v*` публикует подписанные universal APK/AAB в GitHub Release. Приложение не хранит пароль и использует текущую server-session модель.

Vault пока является только server/protocol foundation. `VaultProfile`, `VaultFolder` и `VaultItem` хранят KDF metadata и непрозрачные encrypted payload; API расположен только под `/api/vault/*`, проверяет ownership и никогда не включает Vault в обычный поиск, PageVersion или Notebook export. Argon2id должен выполняться будущим клиентом, master key не должен отправляться серверу. Полноценный unlock/UI, аудитируемая client-side crypto и AutofillService ещё не реализованы, поэтому текущий foundation не называется готовым password manager или zero-knowledge продуктом.

## Требования для development

- Node.js 24;
- npm 10+;
- PostgreSQL 15+ (в Compose используется 17).

```bash
cp .env.example .env
npm ci --legacy-peer-deps
npm run db:generate
npm run db:migrate
npm run dev
```

Откройте `http://localhost:3000`. Если таблица пользователей пуста, Notebook покажет форму создания первого администратора.

Основные переменные:

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_ORIGIN` | публичный origin без завершающего `/`; задайте `https://notes.example.com` за HTTPS proxy |
| `UPLOAD_DIR` | каталог изображений, в контейнере `/data/uploads` |
| `BACKUP_DIR` | приватный каталог локальных backup, в контейнере `/data/backups` |
| `MAX_UPLOAD_SIZE_MB` | лимит одного изображения, по умолчанию 10 |
| `SETTINGS_ENCRYPTION_KEY` | ровно 32 случайных байта в hex/base64 для AES-256-GCM шифрования WebDAV/S3 credentials и TOTP secret |
| `POSTGRES_PASSWORD` | пароль Compose PostgreSQL |
| `NOTEBOOK_PORT` | опубликованный порт Compose, по умолчанию 3000 |
| `POSTGRES_DATA_PATH` | persistent PostgreSQL bind mount, на Unraid `/mnt/user/appdata/notebook/postgres` |
| `UPLOAD_DATA_PATH` | persistent uploads bind mount, на Unraid `/mnt/user/appdata/notebook/uploads` |
| `BACKUP_DATA_PATH` | persistent operational backups, на Unraid `/mnt/user/appdata/notebook/backups` |
| `PUID` / `PGID` | UID/GID процесса Notebook после startup, для стандартного Unraid `99:100` |
| `UMASK` | маска создаваемых приложением файлов, по умолчанию `002` |
| `FIX_PERMISSIONS` | одноразовая рекурсивная коррекция владельца uploads/backups; обычно `0` |
| `DATABASE_WAIT_TIMEOUT_SECONDS` | ограниченный startup timeout ожидания PostgreSQL, по умолчанию 90 секунд |

`APP_ORIGIN=https://...` включает флаг `secure` у session cookie. За Nginx Proxy Manager передавайте обычные `Host`, `X-Forwarded-Host` и `X-Forwarded-Proto`.

## Docker / Unraid

Готовый production image публикуется workflow в `ghcr.io/imnoname25/notebook`. Unraid использует два XML template: `Notebook PostgreSQL` и `Notebook`; исходники, npm и Compose на сервере не нужны. Единственный инфраструктурный prerequisite — custom network:

```bash
docker network create notebook-net
```

После установки PostgreSQL template установите Notebook template, заполните `DATABASE_URL`, `APP_ORIGIN`, `SETTINGS_ENCRYPTION_KEY` и откройте кнопку WebUI. Первый администратор по-прежнему создаётся в браузере.

Push в `main` публикует multi-arch `edge` и `sha-*`; release tag `v*` публикует version tags и `latest`. Перед публикацией CI поднимает чистый PostgreSQL, проверяет migrations, readiness и restart production image.

`latest` — стабильный канал Unraid, `edge` — текущий `main` для тестирования. После release Unraid Docker Manager получает новый digest через `Check for Updates`; стандартная кнопка `Update` сохраняет env/path mappings, скачивает image и запускает встроенный `prisma migrate deploy`. Встроенного self-updater нет.

Compose сохранён для source/development deployment и использует те же env names и persistent paths:

```bash
cp .env.example .env
docker compose config
docker compose up -d --build
docker compose ps
```

Сервисы:

- `notebook` — Next.js, API, миграции и файловые uploads;
- `postgres` — PostgreSQL 17.

PostgreSQL не публикует host-порт. При старте `notebook` ждёт healthy PostgreSQL, подготавливает `/data/uploads` и `/data/backups`, выполняет `prisma migrate deploy` и только затем запускает сервер под `PUID:PGID`. Docker healthcheck использует `/api/health/ready`, поэтому учитывает БД, миграции и writable storage.

Полная GUI-first инструкция, permissions, image tags, diagnostics и reverse proxy: [Notebook на Unraid](UNRAID.md).

## Миграции и обновление

При изменении schema в development:

```bash
npm run db:migrate
```

Для обновления self-hosted установки сначала сделайте backup, затем:

```bash
git pull
docker compose build --pull notebook
docker compose up -d
```

Совместимые миграции применятся автоматически. Не используйте `prisma db push` в production.

## Backup и восстановление

Полный backup состоит из SQL dump и uploads:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > notebook.sql
tar -czf notebook-uploads.tgz -C /mnt/user/appdata/notebook/uploads .
```

Для восстановления создайте чистую БД, импортируйте dump и распакуйте uploads в `UPLOAD_DATA_PATH`. Храните SQL dump, архив файлов и отдельную защищённую копию `.env` как одну согласованную backup-версию. Operational copies в `BACKUP_DATA_PATH` полезны, но не заменяют disaster-recovery пару PostgreSQL dump + uploads.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run validate:docker
npm run validate:unraid
```

Тесты покрывают password hashing, validation/allowlists, ownership guard, BlockNote normalization, reorder/trash/uploads, snapshot policy, duplicate suppression, retention, rate limiter и session lifetime. DB security suite дополнительно проверяет foreign history/restore/delete, move ownership, deleted destinations, stale autosave, restore snapshot, reorder after move, session cleanup и revoke-all. Она требует отдельной PostgreSQL и явного разрешения на очистку:

```bash
TEST_DATABASE_URL="postgresql://notebook:password@localhost:5432/notebook_test?schema=public" \
TEST_RESET_DATABASE=1 \
npm test
```

### E2E

Playwright использует отдельную PostgreSQL database, применяет миграции и очищает её перед сценарием. Никогда не указывайте production database. Явный флаг защищает от случайного удаления данных.

```bash
npx playwright install chromium
E2E_DATABASE_URL="postgresql://notebook:password@localhost:5432/notebook_e2e?schema=public" \
E2E_RESET_DATABASE=1 \
npm run test:e2e
```

Playwright-сценарии проверяют первого администратора, BlockNote/autosave, избранное, поиск, корзину, DnD, version restore/reload, move/breadcrumbs, appearance persistence и unauthenticated access к новым sensitive API.

## Поиск и горячие клавиши

Поиск открывается кнопкой в header или `Ctrl/Cmd + K`. PostgreSQL поддерживает generated `tsvector` для Page/Section/Notebook и три GIN index, которые автоматически обновляются при edit, restore и import. Конфигурация `simple` сохраняет смешанные русские и английские технические термины. Ranking: exact page title → title prefix → FTS title → FTS content → section → notebook. Незавершённое слово ищется ограниченным title fallback; full-table `%ILIKE%` по содержимому не используется.

Запрос проходит через `websearch_to_tsquery` как bound parameter. `ts_headline` применяется после ranking/limit и возвращает только текст с внутренними markers; React отображает совпадения через `<mark>` без unsafe HTML. Первый экран содержит 25 результатов, далее доступно «Показать ещё». Readiness и `Настройки → Система` отдельно проверяют generated vectors/GIN и число индексированных страниц.

Для воспроизводимого dev benchmark на отдельной БД:

```bash
BENCHMARK_DATABASE_URL="postgresql://.../notebook_benchmark" BENCHMARK_ALLOW_WRITES=1 npm run benchmark:search -- 10000
```

FTS migration выполняет backfill через stored generated columns; на очень больших инсталляциях создание GIN index может занять время, поэтому обновление следует выполнять после актуального backup.

## Шаблоны страниц

Кнопка рядом с «Новая страница» открывает keyboard-friendly picker. Встроены семь небольших BlockNote-шаблонов; пользовательские шаблоны можно создавать, редактировать тем же editor schema, дублировать, сортировать, экспортировать/импортировать в versioned JSON и удалять. Встроенные записи защищены от изменения и удаления. `Ctrl/Cmd + N` по-прежнему мгновенно создаёт пустую страницу.

Действие страницы «Сохранить как шаблон» копирует только title/content. История, favorite, revision и timestamps не переносятся. На этапе 6 private `/api/uploads/:id` изображения в custom templates отклоняются с понятной ошибкой; внешние image URL и ссылки на уже существующие страницы сохраняются.

## Печать, PDF и экспорт страницы

`Экспорт → Печать / PDF` скрывает navigation, toolbar и controls, печатает светлый документ с раскрытыми Toggle, безопасными page breaks для callout/code/images и опциями breadcrumbs/date/compact spacing. PDF создаётся штатным browser flow «Печать → Сохранить как PDF»; server-side Chromium не требуется.

Markdown export учитывает Callout, Toggle, code language, tables и internal links. Standalone HTML export выдаёт ZIP с `index.html`, минимальным CSS и private images рядом в `attachments/`; HTML генерируется только из валидированного BlockNote JSON и не вставляет raw note HTML.

| Сочетание | Действие |
| --- | --- |
| `Ctrl/Cmd + K` | открыть глобальный поиск |
| `Ctrl/Cmd + N` | создать страницу в текущем разделе, если фокус не находится в поле ввода/редакторе |
| `Ctrl/Cmd + S` | немедленно выполнить pending autosave и snapshot изменённой страницы |

## Перенос данных и вложения

Диалог `Настройки · Данные` предоставляет четыре независимых сценария:

- экспорт страницы в переносимый JSON или Markdown;
- экспорт одного блокнота либо всех активных блокнотов в ZIP с `manifest.json`, структурированным JSON и файлами вложений;
- импорт страницы в выбранный раздел или импорт блокнотов как новых сущностей без перезаписи существующих данных;
- application backup и подтверждаемое восстановление активных данных, корзины, истории версий и вложений текущего администратора.

Обычный экспорт намеренно не включает корзину и историю. Backup включает их, но никогда не содержит email, password hash и sessions. Формат версионируется; импорт сначала полностью проверяет manifest, JSON-схему, MIME/signature и SHA-256 вложений. ZIP с traversal, absolute paths, symlinks, дубликатами путей, слишком большим числом entries либо превышением лимита отклоняется до записи в БД. При конфликте имени импортированный блокнот получает суффикс `(импорт)`; исходные database IDs не переносятся.

Перед restore приложение проверяет архив и создаёт safety backup в persistent uploads. Затем требуется ввести `RESTORE`; только после этого данные текущего пользователя заменяются транзакционно. При неудаче safety backup сохраняется для ручного восстановления. Для disaster recovery и обновления инсталляции по-прежнему предпочтительна согласованная пара `pg_dump` + копия volume uploads.

Менеджер вложений показывает имя, MIME, размер и расположение страницы. Аудит различает отсутствующие blobs, файлы без metadata и действительно неиспользуемые записи; история версий учитывается как usage. Очистка работает только после preview и подтверждения. Файлы доступны исключительно через authenticated `/api/uploads/:id`, с ownership-проверкой и private cache headers.

Переменные лимитов:

| Переменная | Назначение |
| --- | --- |
| `MAX_IMPORT_SIZE_MB` | Максимальный размер входящего JSON/ZIP, по умолчанию 250 MiB |
| `MAX_IMPORT_UNCOMPRESSED_MB` | Максимальный суммарный распакованный ZIP, по умолчанию 1024 MiB |

## Внутренние ссылки, deep links и PWA

В редакторе введите `[[`, чтобы выбрать принадлежащую пользователю активную страницу. Ссылка хранит стабильный page ID, открывается без полной перезагрузки и остаётся корректной после rename/move. Удалённая или недоступная цель отображается как broken link; backlinks и граф намеренно отсутствуют. Каждая страница имеет прямой URL `/pages/:pageId` и действие `Копировать ссылку`.

PWA содержит install prompt, offline shell, индикатор offline и обновление service worker. Service worker кэширует только shell и versioned static assets; `/api`, пользовательские данные и вложения никогда не кэшируются. Offline editing/sync отсутствует намеренно.

## Проверки этапа 4

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npx prisma validate
npx prisma generate
npm run test:e2e
```

Integration tests требуют отдельную БД и оба `TEST_DATABASE_URL` / `TEST_RESET_DATABASE=1`. E2E использует отдельные `E2E_DATABASE_URL` / `E2E_RESET_DATABASE=1`; без явного reset-флага база не очищается. Stage 4 покрывает round-trip export/import, вложения, trash/history backup, internal links, mobile smoke, hostile archives и отсутствие auth secrets.

## Настройки и эксплуатация

Кнопка `Настройки` открывает единый responsive dialog с разделами `Общие`, `Редактор`, `Резервные копии`, `Хранилище`, `Безопасность` и `Система`. Настройки хранятся в типизированной singleton-модели PostgreSQL. Приоритет конфигурации:

- env-only: `DATABASE_URL`, `APP_ORIGIN`, `UPLOAD_DIR`, `BACKUP_DIR`, import/upload limits и `SETTINGS_ENCRYPTION_KEY`;
- DB: editor preferences, snapshot policy, backup schedule/retention и WebDAV metadata;
- WebDAV/S3 credentials и TOTP secret хранятся в БД только как AES-256-GCM ciphertext с random nonce/tag. Без encryption key secret-настройки и 2FA недоступны, но локальные backup продолжают работать.

Editor settings: browser spellcheck, compact spacing, narrow/normal/wide content width, code line numbers и autosave 500–5000 мс. Snapshot interval допустим 1–60 минут, retention 7–365 дней и 20–500 версий; server остаётся source of truth.

## Scheduled backup

Manual и scheduled backup создаются существующим versioned application-backup сервисом в `/data/backups`. Каждый файл получает private `BackupRecord`, SHA-256 и размер. Доступны download, delete, typed-confirmation restore и повторный WebDAV upload.

Scheduler поддерживает daily, every 3 days и weekly в локальном времени хоста. После перезапуска он создаёт максимум один overdue backup без backlog. После успешного backup retention оставляет не более заданного количества и возраста файлов. Backup, WebDAV upload, restore, import и storage cleanup используют общий process-local lock.

Scheduler является singleton только внутри Node.js процесса. Не запускайте несколько replicas Notebook на одной БД: без distributed lock каждая replica сможет выполнить scheduled job. Redis/distributed scheduling намеренно не добавлены.

## WebDAV

WebDAV target предназначен для NAS, Nextcloud/ownCloud и LAN-серверов. `Проверить подключение` делает `PROPFIND`, при необходимости `MKCOL`, загружает маленький probe и удаляет его. После local success backup загружается через streaming `PUT`; remote failure не меняет local status и допускает retry.

Разрешены только HTTP/HTTPS URL без credentials, path traversal запрещён, timeout ограничен, redirects разрешены только на тот же origin. TLS verification нельзя отключить через UI. Для self-signed сервера добавьте CA в trust store контейнера/хоста.

WebDAV использует общий remote-provider contract. Retention удаляет только известные Notebook filenames из настроенного каталога. Если local copy уже удалена, UI показывает remote-only запись и предлагает «Скачать и восстановить»: архив сначала попадает во временный файл, проверяется по size/SHA-256 и backup manifest, затем создаётся safety backup и только после typed `RESTORE` запускается destructive restore.

## S3-compatible backup и уведомления

S3 target работает через минимальный AWS SDK v3 client и поддерживает AWS S3, MinIO, Backblaze B2 S3 API, Cloudflare R2 и совместимые HTTP(S) endpoints. Настройки включают endpoint, region, bucket, access key ID, encrypted secret key, safe prefix и `forcePathStyle` для MinIO. URL credentials, traversal/control characters, отключение TLS verification и удаление объектов вне Notebook prefix запрещены.

WebDAV и S3 могут быть включены одновременно. У каждого `BackupRecord` есть независимые `BackupRemoteCopy`: local success не становится failure из-за одного remote target. Remote retention использует отдельные count/day limits и удаляет только известные записи. Remote restore всегда скачивает копию локально и валидирует integrity до safety backup и изменения данных.

Колокольчик в header показывает operational notifications: ошибки scheduled/local backup, повторные failures, WebDAV/S3 upload, критичный storage audit и результат restore. Активные одинаковые warnings deduplicated; success разрешает warning, прочитанные записи старше 90 дней и записи сверх 200 очищаются opportunistically. Email/webhook/realtime transport намеренно отсутствуют.

Application backup v2 дополнительно сохраняет custom templates. Restore продолжает принимать backup v1; обычный notebook/page export остаётся совместимым с v1 и не включает settings, sessions, notification/remote metadata, Vault или secrets. Потеря `SETTINGS_ENCRYPTION_KEY` делает сохранённые WebDAV/S3 credentials и TOTP secret нерасшифровываемыми — храните ключ вместе с конфигурацией deployment, отдельно от backup archive.

## Диагностика и health

- `/api/health/live` — лёгкий liveness без обращения к БД;
- `/api/health/ready` — PostgreSQL, migration status и writable uploads/backups/temp;
- `/api/health` — совместимый readiness endpoint для Docker;
- `Настройки → Система` — версия Notebook из `package.json`, Node/environment, БД, миграции, storage/free space, counts, последний backup и client-side PWA status.
- `Настройки → Система` также показывает Git SHA и Docker channel, когда image передал эти metadata.

Health API не возвращает connection string, hostname, filesystem path, credentials или secrets. Migration check только читает `_prisma_migrations` и никогда не запускает migration.

## Editor polish

BlockNote поддерживает структурированные Callout (`Info`, `Note`, `Warning`, `Success`, `Error`) и Toggle blocks с вложенным содержимым. Slash menu сгруппирован в Text/Headings/Lists/Media/Advanced и содержит Callout, Toggle, Table, Image, Code и Page link. Page link использует тот же `[[` picker.

Code blocks имеют allowlist языков, встроенный selector, lazy Shiki highlighting, copy action, horizontal scroll и optional line numbers. Неизвестный imported language безопасно становится plaintext.

Paste использует официальный BlockNote pipeline: plain text/Markdown преобразуются штатным parser, HTML проходит через ProseMirror/BlockNote parsing без исполнения script/event handlers, изображения используют существующий authenticated upload pipeline с MIME/signature/size validation. Offline editing и custom HTML execution отсутствуют.

## Desktop UI и оформление

- левая навигация и список страниц используют компактные list rows с едиными hover/selected/focus состояниями;
- длинные названия обрезаются с сохранением полного значения в tooltip;
- блокноты поддерживают curated иконки и нейтральный/цветной accent;
- разделы поддерживают отдельный accent color;
- страницы поддерживают emoji, accent color и защищённую cover-картинку из существующего uploads storage;
- настройка плотности переключает комфортный и компактный режим;
- выход на всех устройствах перенесён из top bar в `Настройки → Безопасность` и требует подтверждения.

Appearance metadata входит в portable JSON/ZIP export. Старые архивы без новых optional-полей продолжают импортироваться со значениями по умолчанию.

## Следующий этап

Приоритеты: Android AutofillService после отдельного security review; полноценный Vault UI и client-side Argon2id/encryption protocol; biometric unwrap Vault key; browser-extension-neutral Vault protocol; WebAuthn/passkeys; дополнительная проверка интерфейса на реальных Android/4K устройствах.

## Лицензия

Лицензия пока не выбрана.
