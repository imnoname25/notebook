# Studio 4.4-D — Minimal Drag & Drop UX

Проверка: 29.10.2026. База: `18ac143` (4.4-C), main/origin/main синхронизированы перед изменениями.
Согласованное основное ТЗ и дополнение охватывают PageList, общий page/template
редактор, touch, Split View и сохранение native tables/structural columns.

## Строки страниц

Отдельный GripVertical и его button удалены из JSX, а не скрыты. Название и свободная
область основного button строки получают существующие useSortable attributes/listeners.
Избранное и меню — отдельные sibling buttons без drag listeners. Сохранены single
click preview, double click permanent и Ctrl/Cmd+Click.

Используется тот же `SortableList rowDrag`, что дерево блокнотов: MouseSensor с порогом
6px, TouchSensor с delay 300ms/tolerance 6px, KeyboardSensor с соседними строками.
Enter открывает страницу (не активирует drag), Space начинает/заканчивает перенос, стрелки выбирают соседнее место, Escape отменяет.
DnD Kit подавляет завершающий click активного drag. Индикатор цели — собственный
`data-drop-target`, без новой сортировки/API. Доступный scope по-прежнему текущий раздел.

Удалены два старых CSS-правила для первого button: mobile `display:none` и desktop
width 1.5rem. После удаления старой ручки они иначе применялись бы к названию страницы.
Названия на 360px проверяются как видимые элементы, не только отсутствием overflow.

## Одна ручка BlockNote

Общий `NotebookSideMenu` в `SharedEditorMenus` содержит только NotebookDragHandle.
AddBlockButton удалён из импорта и DOM. Ручка с шестью точками имеет нейтральные
семантические цвета, 24×28px на fine pointer, без постоянной рамки; подсветку при hover
и focus-visible. Hover visibility/позиционирование остаются у native SideMenuController.
Текст не стал draggable, ширина документа и постоянное поле редактора не меняются.

Нажатие открывает существующий DragHandleMenu. Добавлены только отсутствовавшие
«Добавить блок выше/ниже»: `insertBlocks`, затем `setTextCursorPosition`, фокус после
закрытия меню. Новые ID, Undo/Redo и история — штатные. Прежние move up/down,
duplicate, copy/rich copy, delete, transform и color остались. Enter и `/` сохранены.
Page-specific ссылка на блок по-прежнему отсутствует в шаблонах.

### Различение click и drag

В установленном shadcn UI BlockNote используется Base UI **1.7.0**, MIT. Он уже был
зависимостью; новых пакетов/обновлений нет. Его Menu.Trigger по умолчанию обрабатывает
mousedown и мешает последующему native drag. Небольшой controlled Menu.Root adapter
и публичный `preventBaseUIHandler` отменяют только обработчик меню, не DOM mousedown.
Меню открывается по click или штатной клавиатурной активации. Drag вызывает прежние
`SideMenuExtension.blockDragStart/blockDragEnd`; synthetic click после drag игнорируется.

Native block selection при drag мог показывать floating formatting toolbar над
местом drop. Общая конфигурация временно не рендерит этот toolbar только на время
block drag. Preview, cursor, drop и изменения документа остаются у BlockNote.
Нет собственной модели блоков, drag engine или history stack.
Общий Menu.Root возвращает editor focus после Escape/item press и завершения native
close autofocus; outside click не перехватывается. При смене активной панели touch
controller размонтируется, поэтому открытое меню не переносится в другую панель.

## Touch и клавиатура

На coarse pointer mouse SideMenu скрыт. После выбора блока доступна компактная
строка «Блок · действия» высотой минимум 44px, в потоке над редактором. Она открывает
тот же NotebookBlockMenu для текущего native block, а не копию списка команд.
Контейнер собственный; UI переносится React Portal из общего editor context.
На coarse pointer эта строка резервируется до focus, а действие неактивно до выбора блока: это исключает сдвиг цели touch/compatibility click. На fine pointer постоянного места нет. Он не перекрывает текст. Native TableActions остаётся отдельным context control
ниже этой строки, с согласованным sticky offset. Только активная панель имеет control.

**Alt+Shift+B** открывает действия текущего блока с клавиатуры. Обработчик ограничен
фокусом этого редактора, editable/active state, игнорирует composing и IME key events.
**Alt+Shift+T** из 4.4-C остаётся доступом к table actions. Touch text/long-press handlers
не перехватываются: только passive pointerup/focus/selection observation.
Touch block DnD не обещается: безопасная альтернатива — «Переместить вверх/вниз».

## Шаблоны и несколько редакторов

В Pages и Templates подключён один SharedEditorMenus и один набор операций.
Page autosave/revision/IndexedDB и explicit template save/CAS не смешиваются.
Изменение блоков шаблона включает обычный canonical dirty state и 3-way close guard.

BlockNote 0.54 SideMenu выбирает ближайший editor по bounding boxes всех `.bn-editor`,
без учёта наложения модального окна. При шаблоне над Split View это давало геометрическую
ничью с фоновой Page. На время менеджера шаблонов используется уже существующий
`WorkspaceEditors.suspended`: фоновый UI скрыт, но instances, save queues и recovery
остаются смонтированными. После закрытия возвращаются те же панели/документы.
Нет vendor patch, переписывания SideMenu или изменения DOM содержимого документов.

Native tables, spans/columnWidths, structural columns, container queries и wrapper
scroll из 4.4-C не переписывались. Меню каждого блока привязано к editor и blockId;
операции в левой/правой панели проверяются по отдельным сохранённым документам.

## Проверки

Результаты финального прогона:

| Проверка | Результат |
| --- | --- |
| `npm run version:check` | Успешно, только проверка контракта, без сборки APK |
| `npm run lint` | Успешно |
| `npm run typecheck` | Успешно |
| `npm run build` | Успешно, webpack production build; полный `npm run check` exit 0 |
| `npm test` | 433 passed, 69 skipped: отдельные opt-in integration suites |
| `npm run test:integration` | 17 файлов, 68/68 passed на отдельной PostgreSQL 18 |
| HTTP E2E, Chrome + Next dev + PostgreSQL | 27/27 passed, 10.1 минуты, без retries |

HTTP-прогон охватывает
`daily-editing`, `document-tabs`, `drag-handles`, `editor-advanced`, `history-recovery`,
`internal-links`, `security`, `split-workspace`, `template-integrity`, `templates-tables`
и `workspace-panels`. Это целевой регрессионный набор из 11 файлов; полный каталог
из 69 Playwright-тестов не запускался целиком. Изменение селектора в старом
`notebook.spec.ts` проверено статически, сам legacy serial-сценарий отдельно не запускался.
Физический Fold, Android IME и системное выделение требуют ручной проверки.

Гейты запускаются с локальным Next dev на 127.0.0.1:3100 и отдельной PostgreSQL 18,
с подтверждёнными TEST_RESET_DATABASE/E2E_RESET_DATABASE. Production build выполняется
после остановки dev. Ранний параллельный unit/HTTP прогон дал timeout 5s при импорте
модуля авторизации и незавершённый GET сравнения в trace; значения timeout не повышены.
HTTP сравнение теперь сначала ожидает успешный ответ своего GET, затем DOM diff.
В последовательном финальном прогоне unit timeout не повторился; пропуски не считаются успешными тестами.

Расширенный прогон выявил четыре устаревших допущения E2E, исправленных без изменения
серверных проверок: HTML export читается как настоящий ZIP/index.html; editor-advanced PATCH обязан передавать expectedRevision;
workspace-panels должен выбирать видимый pane, поскольку Split View монтирует два;
portable ZIP fixture использует отдельный аккаунт, чтобы legacy repack не унаследовал
uploads из DnD fixture, отсутствующие в его синтетическом архиве. Защита от неполного
ZIP и stale save не отключалась.

`e2e/drag-handles.spec.ts` использует настоящий HTTP Next dev + PostgreSQL + Chrome:
клик/drag/keyboard строк, исключение кнопок действий, отсутствие ручек в DOM,
реальный HTML5 block drag/preview/drop cursor, сохранённый порядок, insert/duplicate/
delete/copy, Undo/Redo, выделение текста, клавиатурное меню, страницы/шаблоны,
обе панели Split View, image/file, callout/toggle/nested list, tables, touch 360/840.
Touch сортировка вызывается настоящими CDP touch events, 350ms — длительность
long-press, готовность приложения и drop target ожидаются по состоянию.

Изменённый старый notebook E2E использует строку вместо удалённого page handle.
Существующие 4.3–4.4 regressions проверяют autosave, IndexedDB, backlinks,
backup v5, template dirty close, table controls, column layout и обе темы.

## Скриншоты

[Каталог 18 снимков Chrome](drag-handles-4-4-d/), синтетические данные без секретов.

| Тема | Страницы 1440 | Меню 1920 / 1440 | Шаблон | Split View | Touch 360 / 840 |
| --- | --- | --- | --- | --- | --- |
| Graphite | [Строки](drag-handles-4-4-d/studio-graphite-page-rows.png) | [1920](drag-handles-4-4-d/studio-graphite-block-menu-1920.png) / [1440](drag-handles-4-4-d/studio-graphite-block-menu-1440.png) | [Шаблон](drag-handles-4-4-d/studio-graphite-template-block-menu.png) | [Split](drag-handles-4-4-d/studio-graphite-split-blocks.png) | [360](drag-handles-4-4-d/studio-graphite-touch-block-360.png) / [840](drag-handles-4-4-d/studio-graphite-touch-block-840.png) |
| Atelier | [Строки](drag-handles-4-4-d/studio-atelier-page-rows.png) | [1920](drag-handles-4-4-d/studio-atelier-block-menu-1920.png) / [1440](drag-handles-4-4-d/studio-atelier-block-menu-1440.png) | [Шаблон](drag-handles-4-4-d/studio-atelier-template-block-menu.png) | [Split](drag-handles-4-4-d/studio-atelier-split-blocks.png) | [360](drag-handles-4-4-d/studio-atelier-touch-block-360.png) / [840](drag-handles-4-4-d/studio-atelier-touch-block-840.png) |

Дополнительно сохранены списки страниц на touch 360/840 в обеих темах. Это текущий
реальный интерфейс, не макеты и не физический Fold.

## Ограничения и ручная проверка

- Chrome с hasTouch/isMobile не является физическим Android/Fold. Реальная клавиатура,
  IME, системные selection handles и складывание требуют проверки пользователя.
- Синтетические composition events проверяют отсутствие перехвата сочетания во время
  composition, но не подтверждают работу всех Android IME.
- Touch block drag оставлен штатной платформе; собственный long-press движок не введён.
- Вставка таблиц/Excel не менялась; ограничения 4.4-C остаются в силе.
- При upgrade BlockNote/Base UI повторить mouse-down/click/drag и overlay regressions.

На физическом Fold: прокрутить список страниц, удержать строку и изменить порядок;
проверить отсутствие случайного открытия. В заметке выделить текст, открыть меню
«Блок · действия», вставить/переместить блок, продолжить ввод с IME. В таблице проверить
раздельный доступ к блоку и row/column controls. Повторить в шаблоне, обеих темах,
после поворота и на внутреннем экране. Production/Android APK этой задачей не обновлялись.

## Изменённые файлы

- `page-list.tsx`, `globals.css`, `studio.css`, `drag-handles.css`: row drag и стили.
- `editor-block-menu.tsx`, `editor-block-actions.tsx`, `editor-shared.tsx`: общий menu adapter.
- `rich-text-editor.tsx`, `template-edit-dialog.tsx`: собственные mounts UI, без save изменений.
- `notebook-app.tsx`: существующий suspended mode для фоновых редакторов.
- `drag-handles.spec.ts`, `notebook.spec.ts`, `daily-editing.spec.ts`: регрессии нового контракта и первого touch focus.
- `editor-advanced.spec.ts`, `template-integrity.spec.ts`: актуальная revision и изоляция backup fixture от чужих тестовых uploads.
- `history-recovery.spec.ts`: явное ожидание ответа GET перед assert diff.
- `workspace-panels.spec.ts`: проверка видимой панели вместо неоднозначного селектора двух смонтированных panes.
- Этот документ и каталог реальных browser screenshots.

Пользовательская `.vscode/` не изменялась. Production deployment не выполнялся.
