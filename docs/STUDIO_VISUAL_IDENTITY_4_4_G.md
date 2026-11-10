# Studio 4.4-G — Approved Visual Identities

## Статус

Интеграция утверждённого Round 2. Полный локальный HTTP/Chrome gate прошёл 113/113. Финальные lint, typecheck, unit и production build прошли. Staging-публикация выполняется. До проверки digest и Docker CI образ не считается готовым к установке.

## Архитектура

`src/lib/themes.ts` содержит единый `THEME_REGISTRY` с устойчивыми идентификаторами, названиями, светлой/тёмной схемой и профилями шрифтов. Существующие `THEMES`, `STUDIO_THEMES`, `themeLabel` и `isDarkTheme` используют этот реестр. Серверная схема preferences и сохранённые значения не изменяются.

| Сохранённый ID | Название | Схема | UI / текст / заголовки |
|---|---|---|---|
| midnight-ink | Cyberdeck | Тёмная | IBM Plex Sans / IBM Plex Sans / IBM Plex Sans |
| paper-coffee | Writer | Светлая | Source Sans 3 / Literata / Literata |
| forest-terminal | Signal | Светлая | Geist / Source Sans 3 / Manrope |
| nord-studio | Creative | Светлая | Manrope / Inter / Manrope |

`studio.css` хранит палитры семантических поверхностей. `studio-identities.css` задаёт токены геометрии и правила настоящих компонентов Notebook. Отдельные токены списка документов и кода позволяют Signal сочетать кобальтовую навигацию, светлый список и тёмный код без наследования неподходящего foreground.

Round 2 overlays и их DOM-атрибуты не загружаются приложением. Переключение использует обычную root theme class. Все шрифты уже поставляются локально, новые зависимости и сетевые font providers не добавлены. Graphite, Atelier и четыре legacy-режима сохранены.

### Пользовательская типографика

Явно выбранные UI/editor fonts имеют приоритет. При `editorFont=theme` заголовки получают display font из реестра. Сохранённые абсолютные размер текста и интервал сохраняются, включая 15 px / normal по умолчанию. Утверждённая иерархия достигается display-заголовками, отступами и поверхностями. Переключение темы не переписывает preferences и Page JSON.

### Компоненты и адаптация

Cyberdeck использует компактные строки, усиленный контур активной вкладки и светлую навигационную метку. Writer использует serif-иерархию, спокойные разделители, широкие поля и подчёркнутые вкладки. Signal использует кобальтовую навигацию, чёрную шапку и красный активный маркер. Creative разделяет нейтральный canvas, белый документ и мягкие поверхности с фиолетовыми, коралловыми и бирюзовыми акцентами.

Заголовки таблицы окрашиваются только при настоящем `headerRows`/`th`. Обычная первая строка не превращается визуально в заголовок. Механизмы ширины, cell editing, structural columns и горизонтального scroll не изменены.

При узкой панели используется container query заголовка. На 360/840 px сохраняются существующие drawer и Single/Split breakpoints. Touch controls имеют минимум 44 CSS px. При низкой доступной высоте компактная шапка имеет приоритет над большими desktop-отступами. Reduced motion/transparency учитываются.

## Проверки

Проверки выполняются на синтетических данных в отдельных локальных PostgreSQL databases с ICU `und`. Производственная БД и uploads не используются.

Unit suite отдельно исключает documentation-only `docs/**/capture.spec.ts`, поскольку это Playwright-сценарии сохранённых раундов дизайна. Действующие unit и HTTP suites не исключаются.

## Staging и безопасность публикации

Существующая ветка `staging/studio-4.4-e` сохраняется как изолированный staging channel. Workflow публикует только `staging-4.4-g` и `staging-4.4-g-<full SHA>` после проверок и smoke. Production publication требует отдельного workflow_dispatch с явным opt-in.

Перед публикацией зафиксированы оба production digest — `main` и `edge` указывают на `sha256:35c58de7ecaf31551b02451cb6b9bc6fca1de422c24fecdb895c826708d7732e`. После публикации выполняется повторная проверка.

## Ограничения приёмки

Chrome viewport/touch emulation является предварительной проверкой. Физические экраны Fold, Android IME, системное выделение и поведение после сворачивания требуют ручной проверки пользователем. Toolbar 4.4-H остаётся отдельным этапом.

## Ручная проверка staging

На Windows и Fold переключить все темы, обновить страницу и убедиться в сохранении выбора и типографики. Проверить Single/Split, длинные названия вкладок, Today, Stickers, Ctrl/Cmd+K Search, широкую таблицу и редактор шаблонов. Внести синтетический текст, дождаться подтверждения autosave, перейти между панелями и повторно открыть документ.

Использовать существующий изолированный staging Compose, отдельную БД, uploads, backups и hostname. Имя хоста должно отличаться от production, поскольку cookie изоляция не определяется портом. Закрепить `STAGING_IMAGE` по проверенному immutable digest из раздела публикации. Обновление выполняет пользователь после проверки изоляции.


## Браузерные материалы

Снимки получены из настоящего приложения без CSS injection и review DOM adapters на одинаковом синтетическом наборе блоков. Название технической заметки содержит ID проверяемой темы. Размер текста 15 px соответствует сохранённой настройке аккаунта.

- [Четыре направления на desktop](studio-4-4-g-evidence/contact-desktop.png)
- [Outer viewport 360](studio-4-4-g-evidence/contact-outer.png)
- [Inner viewport 840](studio-4-4-g-evidence/contact-inner.png)

| Тема | Single 1440 | Split 1920 | Touch table 360 | Touch drawer 840 |
|---|---|---|---|---|
| Cyberdeck | [Single](studio-4-4-g-evidence/midnight-ink-single-1440.png) | [Split](studio-4-4-g-evidence/midnight-ink-split-1920.png) | [Table](studio-4-4-g-evidence/midnight-ink-touch-table-360.png) | [Drawer](studio-4-4-g-evidence/midnight-ink-touch-drawer-840.png) |
| Writer | [Single](studio-4-4-g-evidence/paper-coffee-single-1440.png) | [Split](studio-4-4-g-evidence/paper-coffee-split-1920.png) | [Table](studio-4-4-g-evidence/paper-coffee-touch-table-360.png) | [Drawer](studio-4-4-g-evidence/paper-coffee-touch-drawer-840.png) |
| Signal | [Single](studio-4-4-g-evidence/forest-terminal-single-1440.png) | [Split](studio-4-4-g-evidence/forest-terminal-split-1920.png) | [Table](studio-4-4-g-evidence/forest-terminal-touch-table-360.png) | [Drawer](studio-4-4-g-evidence/forest-terminal-touch-drawer-840.png) |
| Creative | [Single](studio-4-4-g-evidence/nord-studio-single-1440.png) | [Split](studio-4-4-g-evidence/nord-studio-split-1920.png) | [Table](studio-4-4-g-evidence/nord-studio-touch-table-360.png) | [Drawer](studio-4-4-g-evidence/nord-studio-touch-drawer-840.png) |


## Результаты regression gate

| Проверка | Результат |
|---|---|
| Полный HTTP/Chrome | 113/113 PASS, retries 0, skipped 0, flaky 0, 28.4 минуты |
| Тематический HTTP/Chrome | 10/10 PASS, retries 0, skipped 0 |
| PostgreSQL integration | 73/73 PASS в 19 файлах |
| Unit | 524 PASS, 74 условных skips в unit-конфигурации |
| Staging isolation/publication guards | 13/13 PASS |
| Unraid Python safeguards | 42/42 PASS |
| Windows runner safeguards | 58/58 PASS на stub Docker, без SSH |
| Docker packaging / Unraid templates | PASS |
| Lint / strict typecheck / production build | PASS, финальный повтор после HTTP gate |

Полный gate использовал новую БД `notebook_g_full_20261110`, тематический — отдельную `notebook_g_focused_20261110`, integration — `notebook_g_integration_20261110`. Все находятся в собственном локальном кластере на 127.0.0.1:55439. Локальная версия PostgreSQL 18.6, runtime PostgreSQL 17 проверяется Docker CI. Новых миграций Studio G нет, существующих миграций 18.

Unit-конфигурация не запускает integration-файлы без соответствующего окружения. Их отдельный запуск приведён выше. Сырые trace/log артефакты остались в локальном ignored cache. [Сводка всех HTTP-тестов](studio-4-4-g-evidence/browser-results.json) содержит статусы и длительности. Все 139 исходных пользовательских и prototype evidence файлов совпали по SHA-256 с начальным снимком.

Проверены сохранённый Page JSON/revision без мутаций при смене темы, отсутствие PATCH Page при просмотре/переключении, server-authoritative preferences после reload, независимые font overrides, Single/Split, мобильный drawer, скролл таблицы, Today/Stickers/Search, crash recovery/history, backup v5, links/backlinks, dirty-close шаблонов, native DnD, structural columns, Workspace с 30 быстрыми переходами и ожидающим autosave. Исходное кратковременное исчезновение пользовательского дерева не воспроизводилось, отдельного заявления об устранении этого исторического дефекта этот этап не делает.

## Файлы реализации

- `src/lib/themes.ts` — общий реестр.
- `src/lib/appearance-preferences.ts`, `src/components/notebook/appearance-provider.tsx` — производные font defaults и display fonts.
- `src/app/globals.css`, `studio.css`, `studio-identities.css` — подключение, палитры, семантическая геометрия и адаптация.
- `src/lib/themes.test.ts`, `studio-theme.test.ts`, `e2e/themes-typography.spec.ts` — регрессионные проверки.
- `vitest.config.mts` — разделение unit и documentation capture scripts.
- `.github/workflows/docker-publish.yml`, `scripts/staging-config-check.mjs`, `.env.staging.example` — отдельный staging G channel и проверка guard.
- Этот отчёт и `docs/studio-4-4-g-evidence/` — результаты и 59 PNG, включая три контактных листа.
