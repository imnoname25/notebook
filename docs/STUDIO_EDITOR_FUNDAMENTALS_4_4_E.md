# Studio 4.4-E — Editor Fundamentals & Adaptive Layout

База: `43a972d` (main). Studio 4.5 остаётся приостановленным. Production, пользовательские документы, `.vscode/`, схема БД, зависимости и протокол сохранения не изменялись.

## Подтверждённые причины

| Симптом | Причина | Исправление |
|---|---|---|
| Несколько строк plain text становятся одним блоком | Стандартная обработка plain text как Markdown соединяет соседние строки в paragraph с hard breaks | Общая конфигурация использует `defaultPasteHandler({plainTextAsMarkdown:false})`; нативный clipboard parser сохраняет каждую строку, включая пустые, как paragraph |
| Контекстное преобразование меняет один из пяти блоков | `NotebookBlockMenu` обновлял только hovered block; штатный FormattingToolbar уже обрабатывает selection | Меню берёт native `getSelection().blocks`, если целевой блок входит в выделение, и вызывает `updateBlock` для каждого совместимого блока в одной `transact` |
| Серые скобки в предоставленном старом документе | CSS подсвечивал любой `backgroundColor`, кроме `default`, включая `transparent`: левая рамка 3px со скруглениями | Исключён `transparent`; сохранены реальные цветные выделения. JSON не нормализуется |
| Широкие блоки используют лишь часть панели | Studio ограничивал весь `.bn-editor` чтением плюс gutters: при 1920px корень 832px внутри контейнера 1360px | Корень занимает доступную ширину; reading limit и alignment применяются к текстовым блокам, широкие блоки получают ширину панели |

Файлы реализации: `src/components/notebook/editor-plain-text-paste.ts`, `editor-shared.tsx`, `editor-block-menu.tsx`, `src/app/globals.css`, `src/app/studio.css`.

## Старый JSON и скобки

Предоставленный пользователем экспорт v5 проверен локально без публикации текста, адресов или идентификаторов. В нём 133 корневых блока: 130 paragraph и 3 heading, без children, hard breaks и буквальных фигурных скобок. У 99 блоков `backgroundColor: "transparent"`; импортированные значения `textColor` включают `windowtext`. Это обычные блоки, не устаревший custom block.

Следовательно, прежнее исправление nesting guides (`43a972d`) не покрывало этот образец: в нём вообще нет вложенности. Источник оставшихся скобок — правило `.bn-block:has(> .bn-block-content[data-background-color]:not([data-background-color="default"]))` в globals.css. Оно добавляло `border-left:3px`, `border-radius:.45rem` и padding даже прозрачным блокам. Через Notepad метаданные фона исчезают, поэтому свежий plain text не имел рамки.

Проверка git history: селектор с исключением только `default` появился в `3e3862c` (Release 0.5.0), то есть существовал до последнего исправления guides. Новый CSS различает прозрачный импорт и намеренно выбранный цвет.

Добавлен обезличенный fixture `e2e/fixtures/legacy-office-paragraphs.json`: структура и безопасные props сохранены, весь текст/ID/адреса заменены синтетическими. Исходный экспорт не входит в результаты. Проверки сравнивают сохранённый JSON до и после просмотра и проверяют отсутствие рамки; отдельный контроль подтверждает сохранение рамки у намеренного серого выделения. Unit test проверяет сохранение импортированных props при валидации.

Никаких преобразований сохранённого JSON, миграций или удаления children не выполняется. Старое исправление вложенных guides сохранено; историческое описание уточнено в `LEGACY_NESTING_GUIDES.md`.

## Clipboard и логические блоки

Синтетический clipboard с `text/plain` передаётся настоящему обработчику paste в Chromium и настоящему Next HTTP-серверу. Состояния до/после читаются через API после autosave. Это не проверка физического Windows Notepad.

Пример входа: `Первая\r\nВторая\r\n\r\nЧетвёртая`.

```json
{"before":[{"type":"paragraph","content":[{"type":"text","text":"Первая \nВторая"}]},{"type":"paragraph","content":[{"type":"text","text":"Четвёртая"}]}],"after":[{"type":"paragraph","content":[{"type":"text","text":"Первая"}]},{"type":"paragraph","content":[{"type":"text","text":"Вторая"}]},{"type":"paragraph","content":[]},{"type":"paragraph","content":[{"type":"text","text":"Четвёртая"}]}]}
```

Пример сокращённый: реальные IDs/props и полные снимки сохранены в каталоге evidence. CRLF, LF и CR обрабатываются одинаково; ведущие, повторные и завершающие пустые строки сохраняются. Литеральные `<script>` и `&` остаются текстом. Undo/Redo вставки используют штатную историю.

Расширение использует публичные `createExtension`, `clipboardTextParser`, `blocksToFullHTML` и ProseMirror `DOMParser.parseSlice`. Временный detached DOM служит только разбору нативно сериализованного clipboard; DOM редактора не изменяется вручную. Bare `<p>` теряет пустые абзацы при разборе BlockNote, поэтому используются штатные full-HTML wrappers. Нативная paste transaction отвечает за selection, IDs и Undo.

HTML/явный Markdown остаются у штатного paste handler; smart links, таблицы TSV и проверки шаблонов не заменены. В code block ProseMirror использует нативную ветку code paste с отступами и переносами. В table context используется нативный алгоритм разбора текста; новый paragraph splitter не подменяет структуру ячеек.

Проверены: вставка внутри Prefix/Suffix, HTML bold/external link, code с пустой строкой и tab, callout с заголовком, вложенный paragraph. Enter создаёт самостоятельные блоки, Shift+Enter оставляет hard break внутри блока. Существующие hard breaks не преобразуются автоматически: визуальная строка не равна логическому блоку.

## Selection и команды

Пять отдельных paragraph при преобразовании остаются пятью блоками с теми же IDs и текстом: bullet, numbered, checklist, heading, quote, toggle list, callout. Смена типов выполняется нативными `updateBlock`, сохраняющими inline content и children. Отдельная система выделения не создаётся.

Если hovered block вне selection, действие применяется только к нему. Несовместимые структурные блоки пропускаются. В этом меню callout с непустым отдельным title исключён из преобразования в простой текст: терять этот title ради преобразования нельзя. Callout без title можно вернуть в paragraph. Это намеренное ограничение безопасной совместимости; штатный FormattingToolbar не заменялся.

Insert above/below проверен для обычного и вложенного paragraph, рядом с таблицей и внутри structural column. Новый блок получает фокус; сразу введённый текст сохраняется. Undo/Redo проверяют нативное действие. При сравнении таблиц используется уже сохранённое каноническое состояние: нативные defaults table cell/width не считаются потерей данных.

В исходном обработчике после `insertBlocks` и `setTextCursorPosition` не было явного `focus()`. Он добавлен как явная гарантия немедленного набора после команды меню. Отдельный baseline-воспроизводитель потери фокуса до этой правки не сохранён, поэтому это не заявляется как самостоятельно доказанный исходный дефект; результат после изменения проверен браузером.

## Layout

В Single View весь editor root использует доступную ширину; резерв второй панели не создавался — ограничение находилось внутри корня. Ограничение читаемой ширины текста сохранено, как и настройка left/center. Table/code/media/callout/banner/columns/tabs не ограничены reading width. У таблицы остаётся собственная горизонтальная прокрутка и ручные columnWidths; JSON не меняется ради CSS.

Split grid, ratio, session storage и resizable panels не менялись. Проверены две реально загруженные страницы: сумма слотов соответствует доступной ширине с учётом разделителя, при resize документы сохраняются. В viewport 1920/1440/1024/840/360 нет горизонтального переполнения документа. Проверки 360/840 — viewport emulation, не физический Fold.

## Проверки и evidence

Baseline до исправлений: 8/8 диагностических сценариев воспроизвели четыре дефекта в обеих темах. Это ожидаемые красные диагностические проверки, не успешный regression gate.

Профильный HTTP-прогон после исправлений: 15/15 (`editor-fundamentals.spec.ts` + `editor-layout.spec.ts`). Дополнительный прогон table/template/block controls: 18/20 до корректировки двух сравнений канонического JSON; два соответствующих сценария затем прошли в профильном прогоне. Исправлены ожидания теста, а не увеличены таймауты. Нулевой по высоте пустой `<code>` заменён на видимый `<pre>` как цель клика.

| Проверка | Результат |
|---|---|
| ESLint | успешно |
| TypeScript | успешно |
| Unit | 436 passed; 69 skipped в unit-конфигурации (отдельный PostgreSQL-прогон ниже) |
| PostgreSQL integration, локальная изолированная PostgreSQL 18 | 68/68 passed |
| Production build + version:check | успешно, Next 16.3.1 webpack; Android contract не изменялся |
| Полный HTTP suite, без фильтров и retries | **70 passed / 14 failed / 7 did not run**, 24.0 минуты; gate НЕ пройден |

`e2e/editor-layout.spec.ts` использует актуальный `/api/account/preferences`, проверяя успешность записи. `e2e/studio-mobile.spec.ts` передаёт обязательный expectedRevision при подготовке документа: прежний fixture получал 409 до самой проверки layout. Save API не изменялся.

Первый завершённый полный прогон: 66 passed / 18 failed / 7 did not run, 24.9 минуты, без retries. [Сводка всех 91 сценариев](editor-fundamentals-4-4-e/first-full-http-summary.json). Это красный gate. Два новых относительно baseline сбоя template-integrity связаны с ошибкой запуска: runner не получил `UPLOAD_DIR`, хотя сервер получил его; проверка filesystem safety backup вызвала `path.join(undefined, ...)`. HTTP restore до этого места выполнился. В новом полном запуске runner и сервер используют одни и те же изолированные `UPLOAD_DIR`/`BACKUP_DIR`.

После устранения прежнего 409 мобильные тесты дошли до focus mode и обнаружили устаревший неоднозначный селектор: `.notebook-editor-pane` включает скрытый пустой Split slot. Селектор уточнён до `:visible`, добавлено требование ровно одной видимой панели; проверка её полной ширины 840px сохранена. Это исправление теста, а не скрытие панели в приложении. После него повторно прошли ESLint этого файла и typecheck.

Снимки JSON и PNG до/после: [before](editor-fundamentals-4-4-e/before/), [after](editor-fundamentals-4-4-e/after/). Они содержат только синтетические данные. Визуально просмотрены legacy Atelier, template Graphite, Single Graphite и Split Atelier; тематические парные screenshots также сохранены. Не публикуются traces, cookies или реальный экспорт пользователя.

Все 14 новых сценариев и существующий editor-layout прошли внутри обоих полных HTTP-прогонов. Их актуальные JSON/PNG отдельно сохранены в [final-http](editor-fundamentals-4-4-e/final-http/); там дополнительно проверяется сохранение декоративной рамки намеренного серого выделения. В повторном полном прогоне также прошли оба расширенных studio-mobile сценария после исправления fixture/селектора.

После полного gate выполнена только пересъёмка mobile — 2/2 passed (37.3s). `page.screenshot({animations:"disabled"})` завершает штатную 180ms screen-in анимацию: прежний кадр фиксировал середину fade-in, а не постоянное затемнение документа. CSS приложения и таймауты не менялись. После изменения параметра screenshot снова прошли ESLint и typecheck. Это дополнительный целевой прогон для evidence, не замена итогов полного suite. Итоговые PNG 393/840px сохранены в обеих темах; Graphite/Atelier outer и Atelier inner визуально просмотрены.

## Ограничения и ручная приёмка

- Реальный clipboard Windows Notepad и физический Android/Fold не проверены. Synthetic paste не подтверждает системную интеграцию буфера.
- На устройстве проверить Notepad CRLF с пустыми строками, преобразование пяти блоков, Insert above/below с немедленным набором, сворачивание/раскрытие Fold с ожидающим autosave.
- Сверить старую пользовательскую страницу после обновления: скобок нет, текст/форматирование/вложенность сохранены. Не сохранять её только ради проверки CSS.
- Проверить широкую таблицу в Single/Split и на узком экране, resize/merged cells и локальную прокрутку.
- Callout с отдельным title не преобразуется в paragraph во избежание потери title. Восстановление из истории и native rich clipboard остаются существующими механизмами.
- На итоговых скриншотах Atelier виден низкий контраст plain-text code (светлый текст на светлом фоне). Причина выбора цвета code renderer в этом этапе отдельно не локализована и не исправлялась; успешные функциональные тесты не считаются полной визуальной приёмкой этого элемента. Скриншот baseline ширины не содержит code, поэтому этот дефект не объявляется доказанно существовавшим до E.
- Полный HTTP gate красный; частичный rerun или отсутствие новых относительно baseline ошибок не считается успешностью всего набора.

## Итог полного regression gate

Повторный полный прогон на реальном Next HTTP + PostgreSQL: **70 passed, 14 failed, 7 did not run**, 0 flaky, 0 retries. [Все 91 результата](editor-fundamentals-4-4-e/final-full-http-summary.json), [сравнение с исходным full suite](editor-fundamentals-4-4-e/full-http-comparison.json).

Baseline на `43a972d`: 52 passed / 18 failed / 7 did not run. Все 14 оставшихся unexpected scenarios совпадают с baseline; новых unexpected keys нет. Это сравнение сценариев, а не доказательство устранения всех старых дефектов.

| Оставшиеся failures | Количество | Наблюдение |
|---|---:|---|
| appearance + notebook | 2 | Исходные предположения о первом setup/login не соответствуют порядку полного suite |
| daily-workflow | 1 | Regex по имени тега выбирает 5 разных кнопок |
| mobile-shell | 2 | Target-size assertion (48px) и старый сценарий Back; приложение/тест требуют отдельной стабилизации |
| stage4 + stage5 | 4 | Старые точки входа в настройки, backup и неоднозначный TOC/heading locator |
| stage6 | 1 | Поиск по имени «Поиск» выбирает 4 элемента, прежний modal workflow |
| studio-polish | 3 | Два mouse-resize assertion и повторяющиеся названия notebook между темами; resize не объявляется исправленным |
| unified-search Atelier | 1 | Повторяющиеся результаты из общего fixture; не объявляется полным прохождением Search gate |

Четыре ранее падавших сценария прошли: editor-layout, оба studio-mobile и workspace-responsiveness Graphite. Первые три связаны с проверяемыми исправлениями layout/fixture. Последний прошёл в обоих новых полных запусках без отдельной правки C.1: это не объявляется устранением исходного краткого исчезновения дерева на пользовательских данных.

7 serial-сценариев не выполнялись после ошибок предшествующих тестов; они не засчитываются как успешные или как недоступность окружения. Новые независимые сценарии истории, crash recovery, foreign ownership, backlinks, Split View, template ZIP/legacy import/rollback, table CRUD и structural columns прошли в обеих темах там, где предусмотрена тематическая пара.

**Публикация заблокирована.** Согласно `AGENTS.md` («При ошибках проверок остановить commit/push и сообщить причину») commit и push не выполнялись. Правки E, тесты и отчёт оставлены локально; Studio 4.5 остаётся приостановленным. Это не окончательная приёмка релиза или физического Fold.

## Изменённые файлы

- `src/components/notebook/editor-plain-text-paste.ts` — минимальный native clipboard adapter.
- `src/components/notebook/editor-shared.tsx` — общая конфигурация pages/templates.
- `src/components/notebook/editor-block-menu.tsx` — selection-aware conversion и фокус вставленного блока.
- `src/app/globals.css`, `src/app/studio.css` — прозрачный импорт и ширина блоков.
- `src/components/notebook/editor-schema.test.ts`, `editor-shared.test.ts` — совместимость props и shared configuration.
- `e2e/editor-fundamentals.spec.ts`, `e2e/fixtures/legacy-office-paragraphs.json` — новые HTTP/browser регрессии с безопасными данными.
- `e2e/editor-layout.spec.ts`, `e2e/studio-mobile.spec.ts` — актуальные preferences/revision в существующих fixture.
- Этот отчёт, `docs/LEGACY_NESTING_GUIDES.md`, `docs/editor-fundamentals-4-4-e/` — причины и доказательства.

Предшествующие локальные материалы Studio 4.5 и пользовательская `.vscode/` сохранены отдельно от изменений E.
