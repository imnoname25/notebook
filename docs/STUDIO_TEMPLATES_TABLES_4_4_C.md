# Studio 4.4-C — Templates & Tables Experience

Дата: 28.10.2026. База: `aceadca` (4.4-B). Production не обновлялся.

## Аудит и границы

Установлен BlockNote **0.54.0**, MPL-2.0; существующий ProseMirror Tables **1.8.5**, MIT.
Новые пакеты, XL/GPL-модули, Prisma schema и миграции не добавлялись.
Основной редактор уже имел русское slash-меню, callouts, код, структурные блоки,
`[[`, clipboard guards, page autosave/revision queue, IndexedDB recovery и историю.
Редактор шаблонов разделял schema, но использовал другой набор стандартных меню,
не защищал dirty close и не проверял конкурентное обновление.

`PageTemplate` остаётся отдельной сущностью с явным сохранением. Ни фиктивного
pageId, ни page autosave, PageVersion, IndexedDB page draft или upload lifecycle
в шаблонах нет. Сохранение Page по-прежнему проходит через page-service; протокол
revision, транзакции истории и индекса ссылок не изменены.

## Общий редактор и различия режимов

`editor-shared.tsx` содержит тонкую общую конфигурацию: schema, dictionary,
syntax highlighting, native table flags, slash/[[ controllers, formatting toolbar
и block context menu. `editor-controls.ts` переиспользует существующие code/toggle
controls. `editor-paste.ts` объединяет прежние rich clipboard и TSV guards.

| Область | Page | Template |
| --- | --- | --- |
| Schema, текстовые стили, callout, code, tables, columns | Общие | Общие |
| Slash Commands 2.0 | 46 пунктов | 36 безопасных пунктов |
| `[[`, pageLink, alias | Доступны | Доступны с защитой навигации |
| Upload/media slash, Live Widgets | Прежний page lifecycle | Скрыты: 4 media и 6 widget commands |
| Bookmark | Прежнее поведение | Запрос валидного HTTP(S) URL до вставки |
| Сохранение | Autosave, revision, recovery | Явная кнопка, конфликт по updatedAt |
| Ссылка на блок | Есть настоящий pageId | Не предлагается |

Семь встроенных шаблонов сохранены, изменяются через копию. Каталог, reorder,
duplicate, delete, создание из Page, JSON export/import и backup v5 используют
существующие API. Создание Page из шаблона остаётся `POST /api/pages` с templateId:
новые blockId, стабильные целевые pageId и alias.

Файлы при paste/drop отклоняются до upload; private attachments не клонируются.
HTML с неподдерживаемым media/опасными URL отклоняется явно. Поддерживаемые внешние
ссылки проходят прежний validator. Литералы кода `data:`, `blob:` и `<script>`
остаются текстом. При ошибке редактор не закрывается.

## Dirty close и конкурентное изменение

Сравнивается canonical JSON содержимого и метаданные name/description/icon, включая
форматирование, порядок, таблицы и вложенные блоки. Baseline снимается после
начальной нормализации BlockNote; до этого ввод заблокирован. Возврат к исходному
состоянию снимает dirty, выделение/просмотр не делают документ изменённым.

Крестик, Escape, outside dismiss и контролируемое закрытие менеджера проходят
единый guard: продолжить / отменить изменения и закрыть / сохранить и закрыть.
Открытие pageLink из шаблона использует тот же guard, а обычная внешняя ссылка
открывается отдельно. Escape активного suggestion menu сначала закрывает меню.
Ошибка API оставляет локальное содержимое; конфликт предлагает сохранить копию.

PATCH существующего шаблона принимает `expectedUpdatedAt` из каталога. Сервер после
ownership/built-in проверок делает транзакционный compare-and-set по id/userId/updatedAt.
Только один конкурентный запрос с прежним токеном проходит. Timestamp монотонный,
включая обновления в одну миллисекунду. Отсутствующий/устаревший токен даёт 409,
чужой объект — 404. Старому открытому клиенту нужно обновить страницу.

Это не crash recovery шаблонов: beforeunload даёт стандартное предупреждение браузера,
но уничтожение процесса/OS не гарантирует сохранность явного несохранённого шаблона.

## Внутренние ссылки

Общий PageLinksProvider получает только идентификаторы из текущего документа.
`[[` использует существующий user-scoped mentions API, debounce и отмену устаревших
запросов. Alias редактируется через контекстное меню и официальный updateInlineContent;
пустая подпись возвращает автоматическое название. Стабильный pageId не меняется.
Удалённые/недоступные цели сохраняют безопасное состояние прежнего provider.
Шаблон не создаёт backlinks. Они появляются только после сохранения реальной Page.
Portable refs и backup v5 из 4.4-A остаются каноническим путём переноса.

## Штатные таблицы без hover

`TableActions` — компактный раскрываемый контекстный control только для активной
таблицы. Row/column CRUD, headers, merge/split работают с текущим native selection
через `editor.exec` и существующие ProseMirror commands. Row/column selection —
штатный CellSelection, отдельной модели выделения нет. Неприменимые merge/split
disabled. Каждая панель Split View получает собственный editor.

На coarse pointer кнопки/summary минимум 44 CSS px. Из ячейки **Alt+Shift+T**
переводит фокус на действия, Escape из действий возвращает редактор. Это также
явный выход из native Tab-навигации таблицы: BlockNote 0.54 удерживает Tab в последней
ячейке. Само стандартное поведение Tab/Shift+Tab и content JSON не переписаны.

Mouse resize остаётся штатным, сохраняет columnWidths через page autosave.
Plain TSV adapter сохраняет ширины назначения и учитывает смещение ячейки.
Для таблицы со spans plain clipboard оставлен native обработчику, чтобы прямоугольный
adapter не разрушал merged topology. HTML/rich clipboard остаётся native; собственный
Notebook block clipboard валидируется и вставляется со свежими blockId.
Plain TSV в merged cell в установленной версии может вставляться как текст внутри
ячейки, а не автоматически распределяться по колонкам: проверена сохранность всех
шести значений и существующих spans. Для распределения по ячейкам используйте
прямоугольник без объединений или HTML clipboard; поведение не выдано за Excel fidelity.

## Подтверждённые CSS-причины

1. Structural columns selector ожидал непосредственную `.bn-block-content`, но
   React custom blocks в 0.54 имеют `.react-renderer` wrapper. Поэтому grid не
   включался. Selector учитывает обе реальные формы; проверены 2 и 3 колонки.
2. Native table с `width:auto` внутри ограниченного wrapper сжимала configured widths.
   `.tableWrapper-inner` теперь имеет intrinsic max-content width и min-width:100%;
   внешний native wrapper прокручивает таблицу. min-width:0 у block/group позволяет
   ей помещаться в узких structural columns без переполнения страницы.
3. Container query до 48rem складывает structural columns по доступной ширине
   template/editor, включая Split View. Сохранённые count/columnWidths не переписываются.

Визуальная проверка выявила также приоритет базового CSS над container rule:
Studio qualifier делает складывание в узкой Split-панели фактически действующим.
Браузерный тест сравнивает X соседних таблиц после перехода в Split View.

Отдельный template test обнаружил позднее монтирование Radix Portal: прежний effect
code controls видел пустой ref. Общий hook теперь реагирует на фактический DOM root;
проверяются label языка и native Undo обратно к clean baseline.

Палитры не менялись; borders/links/focus используют семантические Studio tokens.

## Проверки и свидетельства

- `npm run version:check`, `npm run lint`, `npm run typecheck`: passed.
- `npm test`: **433 passed, 69 skipped** (отдельные env-gated сценарии).
- `TEST_DATABASE_URL=… TEST_RESET_DATABASE=1 npm run test:integration`: **68 passed,
  17 files**, настоящий локальный PostgreSQL 18, отдельная тестовая БД.
- HTTP E2E: **19/19** — daily editing, document tabs, history/recovery, internal links,
  security, Split View, template integrity/ZIP restore и новый templates/tables suite.
- После дополнительных CSS/Portal исправлений: **8/8** daily editing + Split View +
  расширенные templates/tables; после мобильного footer: **2/2** template UI.
- `npm run build`: **passed**, Next 16.3.1 webpack, 57 static routes; dev уже остановлен.

Все успешные browser saves/restore идут через настоящий Next dev HTTP API и PG;
только проверка 503 использует искусственную ошибку. Next dev остановлен до build.
Новые миграции отсутствуют; существующие 17 применены к тестовой БД через migrate deploy.
Unit skips не выданы за успешные integration tests.

[Все 14 скриншотов](templates-tables-4-4-c/):

| Тема | Шаблон desktop | Шаблон 360 | Таблицы desktop | Touch 360 / 840 | Split View |
| --- | --- | --- | --- | --- | --- |
| Graphite | [1440](templates-tables-4-4-c/studio-graphite-template-1440.png) | [360](templates-tables-4-4-c/studio-graphite-template-360.png) | [1920](templates-tables-4-4-c/studio-graphite-tables-desktop.png) | [360](templates-tables-4-4-c/studio-graphite-table-touch-360.png) / [840](templates-tables-4-4-c/studio-graphite-table-touch-840.png) | [Split](templates-tables-4-4-c/studio-graphite-tables-split.png) |
| Atelier | [1440](templates-tables-4-4-c/studio-atelier-template-1440.png) | [360](templates-tables-4-4-c/studio-atelier-template-360.png) | [1920](templates-tables-4-4-c/studio-atelier-tables-desktop.png) | [360](templates-tables-4-4-c/studio-atelier-table-touch-360.png) / [840](templates-tables-4-4-c/studio-atelier-table-touch-840.png) | [Split](templates-tables-4-4-c/studio-atelier-tables-split.png) |

Шаблон также снят на 840 px. Скриншоты являются свидетельствами текущего интерфейса
на синтетических данных, не измерением контраста AA и не проверкой физического Fold.

Новые тесты: `editor-shared.test.ts` (конфигурация, режимы команд, canonical dirty),
`templates-tables.integration.test.ts` (реальный PG CAS/race, native merged table,
widths, ссылки, history/restore и backup v5), `e2e/templates-tables.spec.ts` (настоящий
HTTP Next + PostgreSQL + Chrome). Fault injection 503 в browser test используется
только для проверки ошибки; успешные сохранения проходят реальный сервер.

## Ограничения и ручная приёмка

- Chrome touch 360/840 — эмуляция. Физический Galaxy Fold, Android WebView,
  экранная клавиатура, IME, складывание и OS process kill здесь не проверены.
- Настоящий Excel недоступен. ClipboardEvent/DataTransfer с TSV/HTML проверяет
  реальный browser paste pipeline, но не доказывает системный clipboard Excel.
- Обычные шаблоны не получили autosave/history/recovery; private files по-прежнему
  требуют отдельного безопасного clone lifecycle.
- Native table selection/resize/keyboard зависят от установленного BlockNote 0.54;
  перед upgrade повторить проверки, включая последнюю ячейку и Alt+Shift+T.

На физическом устройстве: открыть шаблон, изменить callout/таблицу, закрыть через
Escape/Back и проверить guard; в таблице добавить/удалить ряд и колонку, merge/split,
прокрутить длинную таблицу при открытой клавиатуре. Проверить обе темы и reload Page.
В Excel скопировать прямоугольник с пустыми/quoted/multiline/merged ячейками и сравнить
все значения после paste/reload; отдельно повторить Undo/Redo.

## Изменённые области

- `editor-shared`, `editor-controls`, `editor-paste`, `table-actions`, RichTextEditor:
  общий UI и native table actions, сохранение page-specific lifecycle.
- `template-edit-dialog`, `template-dialogs`, `template-editor-state`, NotebookApp:
  explicit save/dirty guards и безопасная навигация.
- `editor-schema`, `editor-block-menu`, `page-link-inline`: режим команд/alias.
- `page-templates`, `template-service`: optimistic template update.
- `globals.css`, `templates-tables.css`: фактический wrapper/scroll/container CSS.
- Целевые unit, PostgreSQL и HTTP E2E, этот документ и roadmap.
