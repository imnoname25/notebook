# Editor 3.0 — поддерживаемые улучшения

Основа — существующий BlockNote 0.54.0 и аудит в `EDITOR_3_0_AUDIT.md`.
Нового rich-text engine, большой панели, stored document format или миграции нет.
Палитры Studio, document tabs, mobile layout и очередь autosave сохранены.

## Сворачивание и оглавление

Штатные toggle heading и toggleListItem остаются основными механизмами. В меню блока
заголовок можно переключить между обычным и сворачиваемым; его children сохраняются.
В `/`-меню уже есть штатные toggle headings и существующие группы — второй движок не добавлен.
Соседние абзацы не перегруппировываются автоматически: сворачиваются именно children.

Кнопкам native toggle добавлены имя, aria-expanded, contenteditable=false и поддержка
Enter/Space. Нативный render/ignoreMutation обёрнут только для служебных ARIA-атрибутов:
ProseMirror не должен воспринимать их как редактирование и сбрасывать фокус/раскрытие.
Структуру, selection, вставку и перенос обслуживает сам BlockNote.
На touch кнопки имеют цель 44 px. Для старого custom toggle исправлен CSS по фактическому DOM.

Оглавление обновляется существующим debounce. Desktop-панель opt-in, мобильная — sheet,
inline tableOfContents также сохранён. Извлечение поддерживает H1–H6 с прежними ID;
inline-блок по-прежнему ограничивается своим depth (существующий default 3).
Переход раскрывает native и legacy ancestors от внешнего к внутреннему, затем прокручивает.
При reduced motion прокрутка мгновенная. Постоянной новой панели нет.

## Callout и код

Существующие identifiers не изменены: info — Информация, note — Совет, warning —
Предупреждение, error — Ошибка, success — Успех. Русские названия доступны в select,
типы можно создавать непосредственно через `/`-меню; общий callout entry сохранён.
Optional title, inline formatting, обычный save/history lifecycle остаются прежними.
Studio-оболочка компактнее, на узком экране содержимое не зажато между иконкой и select.

CodeBlock по-прежнему штатный: 13 языков, Shiki, горизонтальная прокрутка, copy и wrap.
Выбор языка теперь подписан и виден без hover; его стандартный opacity:0 мешал touch discovery.
На touch header controls 44 px, код получает отступ под существующую компактную строку действий.
Проверены PowerShell, Bash, JavaScript, TypeScript, JSON, SQL, YAML, Dockerfile, Python,
многострочные значения и отступы. Ошибка Clipboard API не выдаётся за успешное копирование.

## Таблицы и clipboard

Добавление/удаление строк и столбцов, resize и Tab/Shift+Tab оставлены штатному TableExtension.
Mobile `.tableWrapper` продолжает прокручиваться отдельно от страницы.

Подтверждённый пробел: plain TSV вставлялся одной ячейкой с табами, заменёнными пробелами.
В обычной несоединённой таблице ограниченный TSV adapter теперь создаёт экранированный HTML
и передаёт его **штатной** вставке BlockNote. Учитываются quoted tabs/newlines, escaped quotes,
CRLF и существующие widths (нативный colwidth). Никакого ручного изменения cell selection,
table JSON или табличного движка нет. HTML из Excel/браузера остаётся на native path.

«Копировать» в меню блока переносит исходный BlockNote JSON в encoded metadata HTML-буфера,
а внешний HTML/text остаётся форматированным interoperable fallback. При вставке в Notebook:
Zod validation → проверка supported block types → fresh IDs всех descendants → insertBlocks
после блока с курсором. Иначе full HTML без clipboard slice context менял вложенность.
Это не новый формат хранения документов и не localStorage. System Ctrl/Cmd+C/V остаётся
нативным; пункт «Копировать как текст» намеренно не сохраняет структуру.
Повреждённый/неподдерживаемый Notebook payload отклоняется с сообщением, не заменяется молча текстом.

## Сохранность и экспорт

- Все реальные правки идут через прежний onChange → EditorSaveQueue → page-service.
  Debounce, optimistic revision, история и guarded tab transitions не переписаны.
- Неизвестные block types, включая вложенные, останавливают монтирование редактора.
  Доступен экспорт оригинального JSON; autosave такого документа не запускается.
  Список поддерживаемых типов сверяется тестом с фактической schema.
- HTML exporter сохраняет children заголовков/quote/check/callout/code и других блоков
  ровно один раз. Native toggle heading экспортируется в открытые details с исходным уровнем.
- Печать раскрывает дочерние группы только CSS-правилом, без изменения состояния документа.
- HTML таблиц сохраняет безопасные widths/headers/colspan/rowspan, не интерполирует произвольный CSS.
- Markdown сохраняет отступы кода и выбирает fence длиннее встреченных backticks.
  Details summaries и HTML в обычном тексте экранируются; опасные inline link schemes исключаются.
- JSON/ZIP остаются каноническими для обратимого переноса. Generic recursive reference rewriting
  сохраняет неизвестные блоки/metadata и все descendants; серверные форматы/версии не менялись.
  HTML/Markdown производные и не обещают полный round-trip форматирования.

## Проверки

`npm run check`: lint, strict typecheck, **317 tests passed / 36 existing skipped**,
production build прошли. Android client checks прошли. Новые unit cases покрывают children
экспорта, unknown type guard, schema contract, fresh IDs, HTML escaping, safe widths/spans,
code fences и TSV. Существующие queue/revision/history-oriented unit tests остаются в прогоне.

Chrome с настоящими NotebookApp/BlockNote, но изолированными in-memory API fixtures:

- Graphite/Atelier, 1440/1920 desktop и 393/840 mobile viewports;
- вложенный legacy → native toggle, TOC reveal, mouse/Enter, callout edit/save;
- копирование callout через меню и вставка с сохранением kind/title/bold и новым ID;
- девять языков кода, копирование с отступами, HTML paste без исполнения script/onerror;
- native add/delete row/column, Tab/Shift+Tab, drag resize и ширина после reload;
- TSV 2×2 с сохранением destination widths, mobile horizontal scroll;
- unknown document без editor/PATCH, resize без пересоздания редактора;
- регрессии document tabs, pending autosave/error/retry/history/session и мобильных экранов.

`e2e/editor-advanced.spec.ts` добавляет два PostgreSQL-backed сценария: nested reveal,
keyboard, callout save, clipboard round-trip, TSV, export и unknown type.
Typecheck/Playwright list прошли. Их DB execution и server-side import/restore integration
недоступны без отдельной тестовой PostgreSQL; production БД не использовалась.
Pure JSON/portable rewrite round-trip проверен unit tests, а не выдан за реальный restore БД.

Скриншоты и JSON report: `test-results/editor-3/` (ignored локальные артефакты).
`studio-{graphite,atelier}-{desktop-1440,desktop-1920,outer,inner}.png`,
также `*-{outer,inner}-code-table.png`. Данные полностью синтетические.

## Ограничения и физическая проверка

- Native open/closed — presentation state BlockNote; восстановление этого состояния после
  перезапуска не обещается. Структура/isToggleable сохраняются; legacy open остаётся persisted.
- Scrollspy текущего раздела не добавлен; переходы и вложенная структура оглавления работают.
- TSV adapter: максимум 1 млн символов / 10 тыс. ячеек, только обычная сетка назначения.
  Malformed/large input и merged destination остаются на native path; для сложных объединений
  предпочтителен spreadsheet HTML или копирование блока, для архива — JSON/ZIP.
- Markdown import отсутствовал и не добавлен. Его нельзя обещать как обратный путь для custom
  props, widths, merged cells и unknown metadata; используйте JSON/ZIP.
- Unknown guard проверяет block types; произвольные новые props/inline extensions известных
  типов не становятся автоматически поддерживаемыми. Для них нужен совместимый schema client.
- Clipboard API зависит от HTTPS/разрешений браузера/WebView. Ошибка показывается явно;
  системное копирование является альтернативой. OS clipboard в Chrome-тестах подменён,
  реальный Android clipboard и IME не проверены.
- Физический Fold не тестировался. Chrome viewport — предварительная проверка.
  На устройстве проверить touch toggle, long-press copy/paste, клавиатуру в callout/code/table,
  смену языка, горизонтальный swipe таблицы, folding/resize и быстрые переходы с autosave.

Production deployment, APK rebuild, Docker/CI, права/пользователи и PostgreSQL не изменялись.

Изменённые файлы: этот документ и `EDITOR_3_0_AUDIT.md`; `e2e/editor-advanced.spec.ts`;
`src/app/globals.css`, `editor-advanced.css`; notebook `editor-schema.tsx` и tests,
`editor-block-menu.tsx`, `editor-pane.tsx`, `rich-text-editor.tsx`; lib `editor-callouts.ts`,
`editor-compatibility.ts`, `editor-advanced.test.ts`, `table-paste.ts` и tests,
`html-export.ts`, `markdown-export.ts`, `page-outline.ts`.
