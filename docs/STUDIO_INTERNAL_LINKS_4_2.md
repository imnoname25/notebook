# Studio 4.2 — Internal Links & Backlinks

## Аудит и выбранная архитектура

Проверены Prisma Page/PageLink, BlockNote 0.54, editor-schema, rich-text-editor,
page-service, page-version-service, import/duplicate/quick-note conversion,
portable-content, search-service, trash-service, Workspace Tabs и Split View 4.1.
Уже существовали `[[` SuggestionMenu, поиск mentions, legacy inline link `/pages/id`,
таблица PageLink с составным PK и индексом по targetPageId, синхронизация при
save/restore/duplicate/import и PageKnowledge. Эти механизмы расширены без второй
системы поиска или связей. Модель Notebook → Section → Page и ownership сохранены.

## Формат

Новый штатный BlockNote React inline spec (atomic, content:none):

```json
{"type":"pageLink","props":{"pageId":"stable-page-id","text":"Название при вставке","alias":false}}
```

`pageId` — цель. `alias:false` показывает актуальное название из metadata API;
`text` — fallback для clipboard/export/search. `alias:true` сохраняет пользовательский
текст выделения независимо от переименования цели. Переименование не меняет JSON
источника, revision или историю. Старые native link `/pages/id` читаются и индексируются
как прежде; их подпись остаётся собственным текстом. Автоматической миграции заметок нет.
Копирование поддерживается родным wrapper BlockNote; HTML parser принимает только
идентификаторы из allowlist. External HTML содержит span с metadata и вложенный anchor.
Обёртка и runsBefore:link предотвращают преобразование в обычный link при paste.
JSON/ZIP remap меняет pageId на portable key и обратно, alias сохраняется. Отсутствующая
цель импорта получает отдельный missing-ID и не связывается по совпадению названий.
Markdown и безопасный HTML сохраняют текст ссылки, как и для прежних внутренних ссылок;
эти форматы не обеспечивают round-trip идентификатора. JSON/ZIP — точный перенос связей.

## Ввод и навигация

`[[` использует один штатный SuggestionMenu BlockNote рядом с курсором: до 15 страниц,
case-insensitive contains, русский текст, 180 ms debounce, AbortController, защита от
устаревших результатов (включая A → B → A). Выбор очищает trigger/query штатным API,
вставляет inline link и пробел. Escape не очищает введённый текст. Code blocks,
inline code и composing IME не открывают меню. Реальная Android IME требует проверки.

Slash «Ссылка на страницу» открывает компактный picker. То же действие добавлено
в существующую плавающую FormattingToolbar при выделении: выделенный текст становится
alias. Selection восстанавливается штатной транзакцией TipTap перед вставкой; редактор
не изменяется ручным DOM-кодом. Внешние ссылки не превращаются в pageLink.

Клик/Enter по inline link открывает страницу существующим механизмом Workspace.
Правый клик (либо штатный вызов контекстного меню с клавиатуры) предлагает «Открыть
страницу» и, при Split View, «Открыть в соседней панели». Уже открытый ID активирует
своего владельца, второй writer не создаётся. Back/Forward и exact match сохраняются.
Курсор перемещается вокруг atomic link стрелками; удаление и Undo — штатные BlockNote.

## Metadata и недоступные цели

GET `/api/pages/link-targets?ids=...` возвращает только id/title/path активных собственных
страниц, не content. Запрос ограничен 200 ID, UI отправляет группы по 100. GET mentions
использует тот же серверный helper. Чужая/удалённая/отсутствующая цель не возвращается.
Автоматическая подпись недоступной цели — «Страница недоступна», alias сохраняется;
клик показывает локальное сообщение, не меняет документ и не выбрасывает приложение.
После восстановления та же цель снова доступна. Permanent delete не переназначает связь.

Metadata и backlinks обновляются после подтверждённого autosave, изменения workspace,
возврата focus и раз в 30 секунд в видимом приложении. Есть debounce, abort и generation
защита от поздних ответов. Это eventual refresh UI; сам индекс обновляется транзакционно.
Сетевой сбой сохраняет последнюю успешную metadata, не стирает документ.

## Индекс и миграция

Используется существующий PageLink(sourcePageId,targetPageId), без новой Prisma модели.
`syncPageLinks` получает ID из pageLink props или настоящих legacy link nodes с относительным
href. Обычный текст и внешние URL с `/pages/...` больше не считаются отношениями.
Проверяются владельцы целей, дубликаты исключены составным PK; self-links не индексируются.
Связи с принадлежащими пользователю целями в корзине сохраняются, чтобы save источника
во время удаления цели не разрушал будущий backlink после restore. GET knowledge
проверяет активность и ownership цели и каждого источника. Soft-deleted источники скрыты.
Hard delete каскадно удаляет индексные строки, но не текст других заметок.

`202610270001_internal_links_backfill` один раз пересобирает только производный PageLink:
поддерживает реальные legacy links и новый spec, исключает внешние URL/обычный текст,
проверяет общность владельца. JSON документов и PageVersion не изменяются. BEGIN/COMMIT
обеспечивает атомарность. В production применяется обычным `prisma migrate deploy`
при будущем штатном обновлении; в рамках задачи production не обновлялся.

Save, restore, duplicate, portable import и преобразование Quick Capture используют
прежний lifecycle sync. Ошибка optimistic revision откатывает и content, и индекс;
загрузка backlinks/metadata и переход не создают snapshot или PATCH.

## Backlinks и Split View

Нижний компактный details «На эту страницу ссылаются · N» показывает уникальные источники
и их Notebook/Section. Не добавлена постоянная боковая панель. Прежние связанные страницы
и теги сохранены внутри того же сворачиваемого раздела. По умолчанию раздел закрыт;
изменение списка не раскрывает его. Каждая панель имеет собственные metadata/backlinks
и documentId. Событие confirmed save обновляет backlinks соседней панели без её PATCH.
На узком экране раздел занимает доступную ширину; desktop layout не применяется к Fold.

## Проверки и ограничения

- `npm run check`: version:check, lint, typecheck, unit tests и production build прошли.
  Unit suite: 380 passed, 51 skipped (условные suites, PostgreSQL отдельно ниже).
- `npm run test:integration`: 14 файлов, 50 tests passed на отдельном PostgreSQL 18,
  база UTF8 с Unicode-aware C.UTF-8 collation provider builtin. Первоначальный прогон
  на libc/C collation выявил ограничения русского ILIKE; на корректной Unicode-базе
  русские запросы проходят. Production collation не менялась.
- Новые unit cases: ID/alias, дедупликация, игнорирование внешних URL и обычного текста,
  portable remap, unavailable IDs, Markdown/HTML/search label preservation.
- Новый PostgreSQL test: 110+ страниц, русский регистр/partial search, foreign IDs,
  stale revision, rename/move, trash + save источника + restore, unlink, version restore,
  FTS по alias, hard delete. Настоящий ZIP export/import создаёт новые ID и индекс
  между импортированными страницами; alias сохранён, оригиналы не перезаписаны.
  Отдельно проверен JSON export/import одной страницы: portable цели без включённых
  документов становятся корректными missing-ID, а не ошибочными URI в pageId.
- Во всём integration наборе обнаружен и исправлен прежний backup export bug:
  сравнение количества uploads с количеством ссылок ошибочно отклоняло backup с
  неиспользуемыми файлами. Теперь проверяется наличие каждого требуемого upload;
  missing metadata по-прежнему вызывает 409. Существующий data integration test проходит.
- Chrome integration + настоящие Prisma/services/PostgreSQL: обе темы, native `[[`
  и Enter, собственный текст из выделения, Undo/Redo (Ctrl+Z/Ctrl+Y), обычный click,
  контекстное меню справа, Back/Forward, reload, backlinks, rename без PATCH источника,
  trash/unavailable/restore, code-block exclusion, Escape сохраняет текст.
  Native Ctrl+C/Ctrl+V между разными страницами проверены в Chrome:
  в новом документе сохранены два pageLink, alias и правильная исходящая связь;
  оригинал остаётся неизменным. Undo/Redo вставки проверены отдельно.
- Viewport Chrome: 1920, 1440, 840 и 360 px, без горизонтального переполнения страницы.
  Снимки обеих тем, picker и backlinks: `test-results/internal-links-4-2/index.html`.
- Повторён browser integration Split View 4.1: независимый autosave A/B, ошибка A
  не мешает B, перенос, закрытие панели, resize, exact match и Back/Forward проходят.
- Добавлен штатный `e2e/internal-links.spec.ts` (2 сценария), Playwright discovery прошёл;
  полноценный HTTP запуск этого spec не выполнен из-за ограничения ниже.
Полный Next HTTP E2E недоступен: запуск локального Next server ранее отклонён
автоматической проверкой инструментов с `blocked by policy`, без подробного основания.
Chrome integration использует настоящие Prisma/services и отдельный PostgreSQL 18,
но перехваченные HTTP-запросы; cookies/middleware/auth boundary этим не проверяются.
Физический Fold, Android long-press/IME, системный clipboard других приложений
не считаются проверенными по результатам Chrome.

Индекс поиска содержит сохранённые text/alias подписи: обновление названия цели
меняет display metadata, а не поисковый текст источника. Для полнотекстового поиска
актуального названия доступна сама целевая страница. Это намеренное отсутствие массовой
перезаписи документов. Backlink snippets и счётчик отдельных упоминаний не добавлены.

## Изменённые файлы

- `src/components/notebook/page-link-inline.tsx`, `page-link-picker.tsx`: inline spec,
  metadata, picker, alias и контекстная навигация.
- `editor-schema.tsx`, `rich-text-editor.tsx`: native schema, suggestions, formatting action,
  scoped navigation и события подтверждённого сохранения.
- `editor-pane.tsx`, `workspace-editors.tsx`, `notebook-app.tsx`: Split View и refresh.
- `page-knowledge.tsx`: компактные backlinks, обновление и обработка ошибки перехода.
- `src/lib/page-links.ts`, `portable-content.ts`, `html-export.ts`, `markdown-export.ts`:
  IDs, валидация и совместимость переноса/экспорта.
- `src/lib/services/page-link-service.ts`, `export-service.ts`: общий metadata helper,
  индекс корзины и исправление проверки backup attachments.
- `src/lib/services/import-service.ts`: нормализация portable pageLink в одиночном JSON import.
- `src/app/api/pages/mentions/route.ts`, `src/app/api/pages/link-targets/route.ts`:
  authenticated server routes без выдачи содержимого документов.
- `src/app/internal-links.css`, `globals.css`: семантическое оформление без изменения палитр.
- `prisma/migrations/202610270001_internal_links_backfill/migration.sql`: производный индекс.
- `src/lib/page-links.test.ts`, `src/lib/services/internal-links.integration.test.ts`,
  `src/lib/services/page-link.integration.test.ts`, `e2e/internal-links.spec.ts`: регрессии.
- `docs/STUDIO_INTERNAL_LINKS_4_2.md`: архитектура, результаты и ограничения.
