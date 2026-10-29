# Studio 4.4-D — Unified Block Controls & Table UI Cleanup

Дата: 29.10.2026. База: актуальный `origin/main`, `9b164fd`.
Сохранены performance hotfix `9dbaa1c` и добровольный diagnostic probe `9b164fd`.
Предыдущий этап Minimal Drag & Drop реализован в `fbefc42`; его Page DnD и native
block drag используются повторно, без параллельной реализации.

## Подтверждённые причины визуального дублирования

Аудит `AGENTS.md`, отчётов 4.4-C/C.1, BlockNote 0.54.0 и фактического DOM:

| Элемент | Компонент / причина | Решение |
| --- | --- | --- |
| «Таблица · действия · Alt⇧T» | Notebook `TableActions`, sticky details над BlockNote | Удалён из JSX страниц и шаблонов; команды перенесены в popup меню |
| Стрелка в ячейке | Native `TableCellButton`, `.bn-table-cell-handle`, `MdArrowDropDown` | UI отключён через `tableHandles={false}`, не CSS hiding |
| Пустое меню стрелки | `splitCells=true` показывает кнопку, но `SplitButton` возвращает null для обычной ячейки; `cellBackgroundColor`/`cellTextColor` по умолчанию false | В едином меню Split явно disabled, когда операция неприменима; пустого меню нет |
| Полоса справа/снизу | Native `ExtendButton`, показ у края; core CSS резервирует 22px справа/снизу `.tableWrapper`, 9px сверху/слева | Extend UI не монтируется; резерв заменён 2px для сохранения resize-границы |
| Лишняя ширина inner wrapper | `.tableWrapper-inner min-width:100%` растягивал поверхность шире фактической таблицы | Intrinsic `max-content`, без min-width:100%; внешний wrapper ограничен рабочей областью и прокручивается |
| Resize-маркер | `.column-resize-handle` из отдельного ProseMirror `columnResizing` в `TableExtension` | Плагин и node view сохранены; маркер использует Studio `--ring` |
| Теги под заголовком | `RichTextEditor` `.notebook-editor-tags` | JSX и локальный derived state удалены; содержимое/индекс не менялись |

В браузере обеих тем получено **0 menuitem** после открытия старой стрелки обычной
ячейки. Baseline DOM: tableWrapper 736px, inner 705px, table 641px, стрелка 22×12px.
[Исходные снимки и геометрия](unified-block-controls-4-4-d/before/).
Native ExtendButton не является изменением ширины существующего столбца: он добавляет/
удаляет строки или столбцы, а также меняет их количество при движении мыши. Именно
поэтому его удаление не отключает настоящий column resize.

Снимок пользователя в новом запросе не приложен; проверены реально воспроизведённые
элементы установленной версии, а не предположено назначение любого произвольного значка.

## Единая точка управления

Desktop: одна штатная SideMenu ручка `⠿`, 24×28px, появляется при hover. Сохраняются
нативные `blockDragStart/blockDragEnd`, drag preview/drop cursor, вложенность, columns,
выделение текста, Undo/Redo, autosave и история. AddBlockButton и page drag handle
по-прежнему отсутствуют в DOM. Ширина документа и постоянная левая колонка не добавлены.

Обычное нажатие открывает прежнее меню: выше/ниже, move up/down, duplicate, rich/plain
copy, delete, применимые transform/color. Для таблицы добавлен пункт **«Таблица»**.

Общая `TableActionItems` использует текущий editor и native selection:

- Row/column add before/after и delete — ProseMirror table commands через `editor.exec`.
- Строка/столбец заголовков — BlockNote `updateBlock`, с восстановлением selection bookmark.
- Выделение строки/столбца — native `CellSelection`.
- Merge/split — native commands; неприменимые действия disabled.
- Перестановка строк/столбцов доступна командами меню вместо дополнительных table grips.
  Используются native `moveTableRow/moveTableColumn`; header bands остаются на своём месте.

При открытии меню таблицы, отличной от текущей, курсор устанавливается в её первую
ячейку через `setTextCursorPosition`. Если выделение уже в нужной таблице, оно сохраняется,
включая диапазон ячеек. Нет собственной модели таблиц, DOM-патчей содержимого или формата
выделения. Вложенное меню ограничено высотой viewport и прокручивается внутри popup.

У BlockNote Generic.Menu.Item нет типизированного disabled. Используются публичные
ShadCN component context и его стандартные DropdownMenuItem/CheckboxItem, на том же
Base UI Root. Не передаются неизвестные props через Generic wrappers с `assertEmpty`.
Меню остаётся native ARIA menu с keyboard focus и disabled semantics.

## Keyboard и touch

- **Alt+Shift+B**: меню текущего блока.
- **Alt+Shift+T** из таблицы: непосредственно табличные команды того же меню, без панели
  в потоке документа. Enter/Space/стрелки/Escape обрабатываются Base UI.
- На touch используется прежнее минимальное «Блок · действия» для выбранного блока,
  затем «Таблица». Отдельной постоянной table toolbar больше нет.
- Coarse targets в меню не меньше 44px. Существующий резерв единственной общей 44px
  строки сохраняет геометрию первого tap: устранённая в 4.4-D проблема сдвига цели
  touch/compatibility click не возвращается.
- Нет новых long-press/selection/IME gesture handlers. Native table selection и текстовое
  выделение остаются у BlockNote/браузера. Для сенсорного перемещения блока остаются
  действия «Переместить вверх/вниз».

Закрытие popup возвращает фокус только в собственный editor, включая собственный trigger
в sibling host. Табличный popup не заменяется другим popup посреди close animation;
это важно для надёжного Undo после клавиатурного действия. Outside click не крадёт фокус.

## Страницы, шаблоны и Split View

Страницы и шаблоны используют общие `SharedEditorMenus` и `TableActionItems`.
Каждый контроллер привязан к editor/target block, а не глобальной активной таблице.
Соседний Split-документ не пересоздаётся и не сохраняется из-за действий другого меню.
Dirty-close, explicit save/CAS шаблонов и запрет private uploads не менялись.
Page autosave/revision, IndexedDB recovery, history и backlinks не переписывались.

PageList уже имеет row DnD через прежние MouseSensor 6px, TouchSensor 300ms и KeyboardSensor.
Кнопки избранного/меню — отдельные элементы без drag listeners. Click/Enter открывает,
Space и стрелки перемещают, Escape отменяет. Сохраняются preview/permanent и Ctrl/Cmd+Click.

## Теги

Удалён только список chips из шапки. Hashtags в title/content не изменяются или вырезаются.
Подсветка текста hashtags/variables остаётся; server-side индекс, footer «Теги», Tag View,
поиск, добавление/удаление через текст, backup/restore не менялись. Если пользователь
сам написал hashtag в названии документа, этот текст названия остаётся на месте.

## Проверки

| Проверка | Фактический результат |
| --- | --- |
| `npm run version:check` | passed |
| `npm run lint` | passed, без warnings после удаления ненужной callback dependency; изменённые search fixtures дополнительно linted |
| `npm run typecheck` | passed |
| `npm test` | 435 passed, 69 skipped; PostgreSQL проверен отдельным запуском |
| Native PostgreSQL integration | 68/68 passed, 17 файлов; 17 существующих migrations применены на новых test DB |
| HTTP Chrome, 15 выбранных suites / 37 scenarios | 34 passed / 3 failed в первом полном прогоне; после исправления fixtures/ожиданий оба поисковых suites повторно 4/4 passed; непрошедших сценариев не осталось |
| Production build | passed (`next build --webpack`, Next 16.3.1) |
| Физический Android/Fold | недоступен, не заявляется проверенным |

HTTP scope: daily-editing, document-tabs, drag-handles, editor-advanced, exact-search,
history-recovery, internal-links, quick-search, security, split-workspace,
template-integrity, templates-tables, unified-block-controls, workspace-panels,
workspace-responsiveness. Это настоящий Next HTTP server и PostgreSQL. Отдельные
сценарии явно вводят ошибки/задержки запросов для проверки autosave, поиска и stale
responses; это fault injection, а не замена приложения тестовым API.
Проверены history/crash recovery, stale writers, foreign ownership, ZIP/backup v5,
Split, dirty-close, DnD, undo/redo и отсутствие console/page errors в редакторских suites.
Остальные исторические E2E-файлы вне перечисленного набора в этой задаче не запускались.

Новые browser scenarios: отсутствие всех дублирующих контролов и header chips в DOM,
обычный и keyboard путь меню, disabled split, CRUD, headers, native CellSelection,
merge/split без потери текста, перемещение/Undo, resize с autosave/reload, footer tag,
отсутствие лишнего GET Workspace/PATCH при просмотре меню, touch 360/840 и обе темы.
Прежние templates/tables и drag-handles E2E переведены с удалённого details/control на
реальное новое меню; проверки CRUD, dirty-close, widths, spans и Split сохранены.
Performance regressions 4.4-C.1 проверяются отдельным прежним suite.

PostgreSQL проверяется на новых отдельных test databases, без пользовательских данных.
Первый native integration run на базе с унаследованным libc locale `C` дал 4 ошибки
русского case-insensitive search при 64 passed. Сравнение pg_database подтвердило отличие
от прежней рабочей test DB: provider builtin, locale `C.UTF-8`. На новой UTF8 базе с этим
provider/locale повторный native run прошёл **68/68**, 17 файлов. Поисковый код/схема
для обхода ошибки не менялись. Та же Unicode конфигурация используется для финального HTTP.

В расширенном HTTP-прогоне старый exact-search сценарий Atelier первоначально упал:
две темы создавали одинаковое название и контрольное слово в общей test DB, локатор
получал два корректных результата. Fixture разделён по теме (не `.first()` и не увеличение
таймаута). Поисковый API/приложение не менялись; повторный результат указан в итогах.
Quick-search имел ту же коллизию fixtures и сравнивал URL с адресом до явного Home,
хотя существующий `openHome()` выполняет replaceState на `/app`. Теперь проверяется
URL после завершения Home и сохранность того же editor во время поиска, а после
открытия результата — исходный URL документа. Поведение приложения не менялось.

## Скриншоты

Содержимое контрольного документа одинаковое до/после: таблица 2×3, длинное русское
значение, техническое значение, URL и абзац после таблицы. Рабочие данные синтетические.
Sidebar в общем прогоне содержит дополнительные тестовые блокноты; это не изменение UI.

| Вид | Graphite | Atelier |
| --- | --- | --- |
| До | [снимок](unified-block-controls-4-4-d/before/studio-graphite-before.png) | [снимок](unified-block-controls-4-4-d/before/studio-atelier-before.png) |
| Чистый документ | [снимок](unified-block-controls-4-4-d/after/studio-graphite-clean.png) | [снимок](unified-block-controls-4-4-d/after/studio-atelier-clean.png) |
| Единое меню | [снимок](unified-block-controls-4-4-d/after/studio-graphite-after.png) | [снимок](unified-block-controls-4-4-d/after/studio-atelier-after.png) |
| Touch 360 | [снимок](unified-block-controls-4-4-d/after/studio-graphite-touch-360.png) | [снимок](unified-block-controls-4-4-d/after/studio-atelier-touch-360.png) |
| Touch 840 | [снимок](unified-block-controls-4-4-d/after/studio-graphite-touch-840.png) | [снимок](unified-block-controls-4-4-d/after/studio-atelier-touch-840.png) |
| Шаблон | [снимок](unified-block-controls-4-4-d/after/studio-graphite-template-table-menu.png) | [снимок](unified-block-controls-4-4-d/after/studio-atelier-template-table-menu.png) |
| Split / columns | [снимок](unified-block-controls-4-4-d/after/studio-graphite-tables-split.png) | [снимок](unified-block-controls-4-4-d/after/studio-atelier-tables-split.png) |

DOM JSON сохранены рядом. После: wrapper **645px**, table **641px**, padding справа/
снизу **2px**, nested controls **0**. Измерения до приведены выше. Визуально просмотрены
Graphite menu, чистый Atelier и Atelier touch 360. Chrome touch — не физический Fold.

## Ограничения и ручная проверка

- Физические Fold/WebView, Android IME, OS selection handles и клавиатура здесь недоступны.
  На устройстве проверить tap/long-press/набор, затем block menu → таблица, merge/split,
  scroll длинной таблицы и возврат к тексту. Не считать viewport эмуляцию приёмкой Fold.
- Header bands фиксированы для menu reorder; операции со spans ограничены возможностями
  штатных ProseMirror commands. Excel paste ограничения из 4.4-C остаются в силе.
- Native cell colors ранее выключены в общей конфигурации; новый UI их не включает.
  Сохранённые cell props/цвета не удаляются из документов.
- Исходное краткое исчезновение содержимого из C.1 всё ещё не воспроизведено; здесь не
  объявляется исправленным. Browser probe сохранён, новые диагностики автоматически не включены.
- Production, Docker/CI, Unraid, APK, Prisma schema, зависимости и `.vscode/` не изменялись.

## Изменённые файлы

`table-actions.tsx`, `editor-block-menu.tsx`, `editor-block-actions.tsx`, `editor-controls.ts`,
`rich-text-editor.tsx`, `template-edit-dialog.tsx`, `templates-tables.css`, `drag-handles.css`;
`e2e/table-controls.ts`, `e2e/unified-block-controls.spec.ts`, адаптированные
`e2e/templates-tables.spec.ts`, `e2e/drag-handles.spec.ts`, изолированные fixtures
`e2e/exact-search.spec.ts`, `e2e/quick-search.spec.ts`; этот отчёт и browser evidence.
