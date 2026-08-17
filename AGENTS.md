# AGENTS.md — Notebook

## Product principles

> Notebook должен оставаться простой цифровой записной книжкой.

> Не добавлять функции только потому, что они есть в Notion, Obsidian или других PKM-системах.

Основная продуктовая модель: **Notebook → Section → Page**. Главный сценарий: выбрать место и писать. Веб-версия является основным клиентом. Self-hosting является обязательной частью продукта.

Notebook не является wiki, PKM, task manager или project-management системой. Не предлагать без прямого продуктового решения граф связей, backlinks как основу, Markdown UI, page databases/properties, Kanban, AI, collaboration или realtime editing.

## Engineering rules

- Сохранять монолит Next.js App Router: UI и server-side API в одном приложении. Не вводить microservices.
- TypeScript остаётся в strict mode; избегать `any`, валидировать внешние данные Zod.
- Разделять route handlers, reusable UI и серверную логику. Не создавать компоненты на 1000+ строк.
- Rich text остаётся BlockNote JSON. Markdown не является пользовательским редактором.
- Любой запрос к Notebook, Section, Page или Upload обязан проверять ownership на сервере. Для чужого объекта возвращать 404, не раскрывая его существование.
- Пароли хешируются безопасным password KDF. Session cookie должна быть `httpOnly`, `sameSite`; `secure` включается для HTTPS origin.
- Мутации обязаны учитывать CSRF, валидировать ввод и возвращать нормализованные JSON errors.
- Autosave — ключевая функция. Не добавлять кнопку Save; использовать debounce и понятный статус. Не терять pending change при смене страницы.
- Все изменения title/content проходят через `page-service`. История использует централизованную snapshot/retention policy; restore и autosave обязаны соблюдать optimistic `revision`, чтобы stale save не перезаписывал восстановление.
- Ownership версии проверять только через `PageVersion → Page → Section → Notebook → User`; `userId` никогда не принимать от клиента.
- Цвета и иконки блокнотов хранить как identifiers из общих server/client allowlist. Не принимать CSS или произвольные имена компонентов.
- Cross-parent move выполнять транзакционно с проверкой активного destination и нормализацией `sortOrder`; UI не является security boundary.
- Session idle/absolute lifetime и auth rate-limit constants держать централизованно. Не добавлять Redis для single-instance MVP без отдельного решения.
- Роли ограничены `ADMIN`/`USER`; admin authorization выполнять только через общий server-side helper. Нельзя блокировать или понижать последнего активного администратора. Disabled user не должен сохранять доступ через старую session.
- User preferences и application/admin settings являются разными security boundaries. Backup, storage, remote credentials, system diagnostics, operational notifications и user management доступны только администраторам.
- TOTP secret хранить только через versioned AEAD encryption; recovery-коды — только hashes. Не создавать authenticated session до завершения второго фактора и rate-limit challenge.
- Vault остаётся отдельным `/api/vault/*` boundary. Никогда не помещать Vault secrets в Page content/search/history/обычный export и не логировать ciphertext-derived plaintext, master keys, TOTP seeds или recovery codes.
- Vault server хранит только opaque ciphertext и KDF metadata. Не заявлять zero-knowledge до завершённого и проверенного client-side key protocol; login password нельзя напрямую использовать как vault encryption key.
- Изображения не хранить в БД/base64. Файлы принадлежат пользователю и живут только в persistent `/data/uploads`.
- Вложения всегда отдавать через authenticated API с ownership-проверкой; не публиковать uploads как static files и не кэшировать их публично.
- Portable export/import использует версионируемый manifest и независимые от БД ключи. Импорт никогда не перезаписывает существующие данные; ZIP распаковывать только с traversal, symlink, entry-count и size validation.
- Application backup не содержит пароли, password hashes или sessions. Restore требует явного подтверждения, предварительной валидации и safety backup; SQL dump + uploads остаётся каноническим disaster-recovery способом.
- Operational backup-файлы приватны и хранятся только в persistent `/data/backups`; download/delete/restore выполняются по `BackupRecord`, никогда по клиентскому filesystem path.
- Application settings валидировать server-side. Security secrets не возвращать API; WebDAV password хранить только через AES-256-GCM с env-only `SETTINGS_ENCRYPTION_KEY`.
- Backup scheduler должен оставаться process-local singleton и использовать общий operation lock. Не вводить distributed scheduler/Redis без отдельного решения.
- WebDAV разрешает только HTTP(S), ограниченные same-origin redirects и timeout. Никогда не добавлять UI для отключения TLS verification.
- PostgreSQL FTS raw SQL всегда parameterized; пользовательский ввод нельзя передавать в `$queryRawUnsafe`. Generated vectors и GIN indexes являются канонической search index strategy.
- Remote backup providers реализовывать через общий `BackupRemoteTarget`; remote retention удаляет только известные Notebook keys/copies и никогда не делает bulk-delete bucket/directory.
- Все remote credentials шифровать существующим versioned settings ciphertext. Secret values никогда не возвращать settings/system API и не импортировать в client bundle.
- Backup format сохраняет backward compatibility: importer обязан читать v1; новые application backups v2 могут включать custom templates, но не auth/session или operational secrets.
- Template content валидируется как структурированный BlockNote JSON. Private attachment references запрещены, пока не реализовано явное клонирование template attachments.
- Первичные данные находятся только в PostgreSQL или persistent uploads; operational backup-копии — в persistent `/data/backups`. Не писать важное состояние в ephemeral filesystem.
- Новые сервисы (Redis, S3/MinIO, Elasticsearch и т. п.) добавлять только после доказанной необходимости и явного решения.
- Production image запускает Next.js standalone server, а schema updates применяет только через entrypoint `prisma migrate deploy`. Startup обязан валидировать env, ограниченно ждать PostgreSQL и прекращаться при ошибке migration.
- Unraid deployment сохраняет два отдельных непривилегированных контейнера и узкие persistent mounts. XML templates и GHCR image names должны оставаться синхронизированы и проходить `npm run validate:unraid`.
- UI сохраняет спокойный минимализм: пространство, типографика, мягкие скругления, минимум рамок, без градиентов и admin-dashboard эстетики.
- Любое изменение основного сценария проверять на desktop и на mobile от 360 px. На mobile используются последовательные экраны и явная Back navigation.

## Data and migrations

- `sortOrder` сохранять для Notebook, Section и Page. DnD может быть UI-слоем поверх текущего API.
- Notebook, Section и Page по умолчанию удаляются мягко через deletion group. Физическое каскадное удаление разрешено только из корзины после явного подтверждения.
- Изменения Prisma schema сопровождаются версионируемой миграцией. В production использовать `prisma migrate deploy`, не `db push`.
- Следить, чтобы backup по-прежнему требовал только PostgreSQL dump и uploads directory.

## Definition of done

Перед завершением изменения запускать соразмерные проверки, а для обычной feature-задачи — `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Изменения deployment дополнительно проверять через `docker compose config` и, когда Docker доступен, реальный build/healthcheck.

Документировать новые env vars в `.env.example` и README. Никогда не коммитить `.env`, пароли, токены или production connection strings.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
