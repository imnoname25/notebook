# Studio 4.4 — Editor Experience Audit

Дата: 28.10.2026. База: `main`, `33a2b08`. Это аудит, не реализация Studio 4.4.
Изменяются только эти документы и синтетические результаты в `docs/audit-4-4/`.
Commit/push не выполняются до согласования. Исходная пользовательская `.vscode/`
не изменена. Production, APK, зависимости, Prisma и миграции не затронуты.

Результаты ниже сохранены как исходный аудит `33a2b08`. По последующему заданию
4.4-A исправлены A01/A03/A06: [реализация и проверка](STUDIO_DATA_INTEGRITY_4_4_A.md).
Исторические скриншоты и findings не выдаются за состояние после исправления.

## Резюме

Редактор уже существенно шире базового BlockNote: 44 slash-пункта, native rich text,
callouts/banner, три механизма сворачивания, подсветка кода, штатные таблицы,
7 встроенных и пользовательские шаблоны, inline pageLink, оглавление, Split View,
revision autosave, история и IndexedDB recovery. Основная польза следующего этапа —
исправить конкретные несогласованности и целостность существующих возможностей.
Новая система slash, callouts, templates или таблиц с нуля не нужна.

Наиболее важные находки:

1. **A01 / P0 — ссылки пользовательских шаблонов не переживают ZIP backup restore.**
   Подтверждено настоящим HTTP round-trip на отдельном синтетическом владельце.
2. **A02 / P1 — H1 не получает Studio-размер.** BlockNote опускает default-атрибут
   `data-level=1`; CSS Studio требует его. На touch 360/840 px H1 остаётся 45 px.
3. **A03 / P1 — шаблон технической заметки отклоняет безопасный код с `data:`.**
   Подтверждён HTTP 400 для текстового литерала, не URL-свойства ссылки.
4. **A04 / P1 — редактор шаблона имеет другой набор UI/сохранения.** Общая schema
   уже есть, но нет Notebook slash-items, словаря, uploadFile, search/recovery/queue.
5. **A05 / P1 — slash-меню перегружено и повторяет группы.** 44 пункта, 14 сегментов
   для 8 разных групп; native toggle и Notebook-группа сосуществуют без ясного объяснения.

Ни одна находка здесь не исправлялась. Приоритеты и критерии — в
[roadmap](STUDIO_EDITOR_ROADMAP_4_4.md).

## Метод и достоверность

- **Код:** прямое чтение текущего репозитория и исходников установленного пакета.
- **HTTP/Chrome:** настоящий Next dev + PostgreSQL на task-local loopback, установленный
  headless Chrome, реальные API. Только синтетические документы и отдельный владелец
  для разрушающего round-trip его собственных тестовых данных.
- **Unit:** 47 существующих тестов / 7 файлов прошли; список ниже.
- **Не проверено:** явно отмечается; наличие API не равно успешной ручной проверке.

История 4.3.1 (20 повторов обеих тем и 11/11 HTTP acceptance) — предшествующее
подтверждение, не новый прогон всей приёмки в этом аудите. Браузерные пробы ниже
не являются физическим Fold, полноценным IME-тестом или доказательством WCAG AA.

## База и официальные API

Установлены **@blocknote/core, @blocknote/react, @blocknote/shadcn 0.54.0**;
записи package.json самого пакета показывают MPL-2.0. Проверялось установленное
содержимое node_modules, не только диапазон `^0.54.0` корневого package.json.
Next 16.3.1 / React 19.2.8; основной формат — BlockNote JSON в `Page.content`.

Канонические источники этой версии:

- `node_modules/@blocknote/core/src/blocks/defaultBlocks.ts`: paragraph, heading,
  bullet/number/check list, quote, toggleListItem, codeBlock, divider, table,
  image/file/audio/video. **Callout/alert/hint не default block specs.**
- `core/src/extensions/SuggestionMenu/getDefaultSlashMenuItems.ts`:
  `filterSuggestionItems`, `insertOrUpdateBlockForSlashMenu`, native commands.
- `react/src/components/SuggestionMenu/SuggestionMenuController.tsx`:
  `triggerCharacter`, `getItems`, `shouldOpen`, `floatingUIOptions`.
- `react/src/components/SuggestionMenu/hooks/useSuggestionMenuKeyboardHandler.ts`:
  ArrowUp/Down, PageUp/Down, Enter с `isComposing` guard.
- `core/src/editor/BlockNoteEditor.ts`: `tables.headers`, `splitCells`,
  `cellBackgroundColor`, `cellTextColor`; последние два по умолчанию false.
- `core/src/blocks/Table/TableExtension.ts`: columnResizing/tableEditing,
  `goToNextCell` для Tab/Shift+Tab, native resize minimum 35 px.
- `react/src/components/TableHandles/`: штатные row/column/cell controls.
- Публичные BlockNote API, уже используемые проектом: `BlockNoteSchema.create`,
  `createReactBlockSpec`, `createReactInlineContentSpec`, `useCreateBlockNote`,
  `insertBlocks`, `updateBlock`, `replaceBlocks`, `transact`, `moveBlocksUp/Down`,
  `pasteHTML`, `blocksToHTMLLossy`, `blocksToMarkdownLossy`.

Официальная документация проверена 28.10.2026:
[Suggestion menus](https://www.blocknotejs.org/docs/react/components/suggestion-menus),
[Custom blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks),
[Tables](https://www.blocknotejs.org/docs/features/blocks/tables),
[лицензирование](https://www.blocknotejs.org/pricing).
Это живые страницы, не зафиксированная документация 0.54.0. Наличие перечисленных
API отдельно сверено с локальными исходниками; новые свойства из live docs здесь
не выдаются за гарантии установленной версии.

Базовые tables/resize/headers/split cells находятся в установленном MPL core/react;
отдельного платного table engine для них не требуется. XL-пакеты не подключены.
По информации производителя XL имеет GPL/commercial варианты. Это отдельная
проверка лицензии перед возможным использованием, не основание покупать XL для
этого roadmap. Самостоятельный spreadsheet engine не предлагается.

## Карта подтверждающих файлов

Обозначения далее относятся к этим конкретным исходникам:

| ID | Файл / компонент | Что подтверждает |
| --- | --- | --- |
| S1 | [editor-schema.tsx](../src/components/notebook/editor-schema.tsx) | Schema, callout/banner/toggle, languages, normalizeEditorBlocks, slashMenuItems |
| S2 | [rich-text-editor.tsx](../src/components/notebook/rich-text-editor.tsx) | Main editor setup, upload, menu controllers, paste, save/recovery, code controls |
| S3 | [editor-block-menu.tsx](../src/components/notebook/editor-block-menu.tsx) | Side menu, DnD, transform, fresh nested IDs, clipboard marker |
| S4 | [template-service.ts](../src/lib/services/template-service.ts) | 7 built-ins, user-scoped CRUD, save from page |
| S5 | [page-templates.ts](../src/lib/page-templates.ts) | Allowlist, recursive validation, unsafe-value scan, private-attachment restriction |
| S6 | [template-dialogs.tsx](../src/components/notebook/template-dialogs.tsx) | Picker, manager, separate TemplateEditDialog and explicit save |
| S7 | [pages route](../src/app/api/pages/route.ts), [notebook-app.tsx](../src/components/notebook/notebook-app.tsx) | templateId create, creation actions, keyboard destinations |
| S8 | [table-paste.ts](../src/lib/table-paste.ts) | Bounded quoted TSV conversion, escaped HTML, widths |
| S9 | [export-service.ts](../src/lib/services/export-service.ts), [import-service.ts](../src/lib/services/import-service.ts), [portable-content.ts](../src/lib/portable-content.ts) | Versioned JSON/ZIP, attachments/page ID maps, templates backup |
| S10 | [page-service.ts](../src/lib/services/page-service.ts), [page-write-lock.ts](../src/lib/services/page-write-lock.ts), [page-version-service.ts](../src/lib/services/page-version-service.ts) | Ownership, revision, transaction, snapshots and derived indexes |
| S11 | [history-diff.ts](../src/lib/history-diff.ts), [block-recovery.ts](../src/lib/block-recovery.ts), [history-block-view.tsx](../src/components/notebook/history-block-view.tsx) | Structural matching, safe restore, read-only rendering |
| S12 | [editor-save-queue.ts](../src/lib/editor-save-queue.ts), [local-drafts.ts](../src/lib/local-drafts.ts) | Ordered writer, user/page/writer recovery and acknowledgements |
| S13 | [page-link-inline.tsx](../src/components/notebook/page-link-inline.tsx), [page-link-service.ts](../src/lib/services/page-link-service.ts) | Stable pageId/alias, ownership, metadata and backlinks |
| S14 | [use-workspace-tabs.ts](../src/components/notebook/use-workspace-tabs.ts), [workspace-editors.tsx](../src/components/notebook/workspace-editors.tsx) | Per-pane lifecycle, maximum two document editors |
| S15 | [studio.css](../src/app/studio.css), [studio-mobile.css](../src/app/studio-mobile.css), [editor-advanced.css](../src/app/editor-advanced.css), [globals.css](../src/app/globals.css) | Semantic theme mapping, responsive typography, tables, coarse-pointer sizes |
| S16 | [Prisma](../prisma/schema.prisma) | Page revision/JSON, PageVersion, PageLink, PageTemplate ownership |
| S17 | [document-search-extension.ts](../src/components/notebook/document-search-extension.ts), [use-document-search.tsx](../src/components/notebook/use-document-search.tsx) | Exact-match navigation and counter, not an independent Find input |
| S18 | [html-export.ts](../src/lib/html-export.ts), [markdown-export.ts](../src/lib/markdown-export.ts), [blocknote-text.ts](../src/lib/blocknote-text.ts) | Project exporters/text extraction for custom content |
| S19 | [structural-blocks.tsx](../src/components/notebook/structural-blocks.tsx), [page-outline.tsx](../src/components/notebook/page-outline.tsx) | Native-child tabs/columns, TOC and outline |

Архитектурный контекст:
[4.1 Split View](STUDIO_SPLIT_VIEW.md), [4.2 Links](STUDIO_INTERNAL_LINKS_4_2.md),
[4.3 History](STUDIO_HISTORY_RECOVERY_4_3.md), [4.3.1](STUDIO_STABILIZATION_4_3_1.md),
[Editor 3.0](EDITOR_3_0.md), [Studio tokens](STUDIO_DESIGN_SYSTEM.md).

## Матрица основных возможностей

Сложность: Н — до 1–2 дней, С — примерно 2–5, В — больше недели с регрессиями.
Оценки — не обещание сроков; риск относится к предлагаемому изменению, а не к самому
наличию функции. Статусы используются буквально из задания.

| Возможность | Текущий статус | BlockNote API | Сложность | Риск | Рекомендация / доказательство |
| --- | --- | --- | --- | --- | --- |
| Slash Commands | Уже реализовано | SuggestionMenuController/getDefaultReactSlashMenuItems | Н–С | Низкий | Перегруппировать/снять неоднозначность, не переписывать S1/S2 |
| Slash search | Уже реализовано | filterSuggestionItems: title/aliases substring | Н | Низкий | Дополнить русские aliases, описания сейчас не ищутся S1 |
| Native keyboard/anchor | Уже реализовано | Floating UI, native navigation | С для audit | Средний для touch/IME | Сохранить; расширить проверки, S2 и пакет 0.54 |
| Callouts | Уже реализовано | createReactBlockSpec(content:inline) | Н | Низкий для presets | Использовать текущие kind, S1/S5/S18 |
| Отдельные Alert/Hint types | Отсутствует | Можно custom specs | С | Средний | Не нужны отдельные JSON-типы: уже есть callout semantics |
| Quote/toggle headings/list | Уже реализовано | defaultBlockSpecs | Н | Низкий | Не создавать четвёртый toggle, S1/S3 |
| Page Templates | Уже реализовано | Прикладной PageTemplate + initialContent | С | Высокий для portable refs | Сначала A01, затем единый UX, S4–S9 |
| Шаблон как обычная Page | Отсутствует | Нет отдельного встроенного server template store | В | Высокий | Не создавать скрытые Pages/версии; общий UI adapter без смены entity |
| Tables basic/edit/resize | Уже реализовано | native TableExtension/TableHandles | Н–С | Низкий при сохранении движка | Улучшать обнаруживаемость, S2/S8 |
| Headers/merge/split | Уже реализовано | tables.headers/splitCells=true | С для QA | Средний | Проверить touch/clipboard/history, не писать свой engine |
| Cell text/background colors | Есть в BlockNote, но не используется | tables.cellTextColor/cellBackgroundColor | Н код / С QA | Средний | P2, не включать просто ради наличия |
| Formula/sort/Excel engine | Отсутствует | Не доказано в core 0.54 | В | Высокий | Не соответствует простой записной книжке, не предлагать |
| Нативный IME/physical Fold | Требует отдельной проверки | isComposing есть в Enter handler | С | Средний | Реальный WebView/клавиатура обязательны |

## Slash Commands: фактическое поведение

В Chrome обе темы показывают **44** пункта: 23 native и 21 Notebook-пункт.
Native: H1–H6, quote, toggle list, ordered/bullet/check list, paragraph, code,
divider, table, image/video/audio/file, toggle H1–H3, emoji. Notebook: 5 callout
вариантов, banner, custom toggle, bookmark, page link, labeled divider, group,
tabs, 2/3 columns, TOC и 6 Live Widgets. Это инвентаризация, не рекомендация
добавлять новые live/widget или структурные возможности.

Меню имеет категории, но не сортирует единый каталог: S1 последовательно дописывает
custom items после native. В runtime 14 group labels: «Заголовки», «Дополнительно»,
«Списки», «Текст», «Дополнительно», «Медиа», затем повторения и другие группы.
Результат — прокрутка и повторяющиеся заголовки. Кроме визуального шума,
браузер фиксирует 6 React console errors о duplicate keys. Установленный
SuggestionMenu.tsx задаёт group label `key=currentGroup`, поэтому повтор одной
категории в несмежных сегментах создаёт одинаковые sibling keys. Это конкретная
ошибка подготовки каталога, не необходимость переписывать BlockNote.
[Console evidence](audit-4-4/console-findings.json). «Сворачиваемый список»,
«Сворачиваемая группа» и «Сворачиваемый блок» обозначают разные entry points при
частично одинаковой задаче. Не следует удалять поддержку старых типов документов;
возможен один ясный основной пункт с сохранением существующих JSON readers.

Фильтр — case-insensitive substring только title/aliases, без поиска subtext,
ранжирования или исправления раскладки. `/цит` действительно находит «Цитата».
ArrowDown меняет выбранный пункт, Escape закрывает; установленный hook поддерживает
Enter и защищает Enter во время composition. Полный аппаратный IME не проверен.
Native controller использует offset/autoPlacement/shift/size у курсора.

`[[` — второй controller того же расширения, search ограничен сервером и debounced
на 180 мс; отдельный shouldOpen запрещает code/inline code/composing. После ожидания
реальной выдачи в обеих темах видимо одно меню. Ранний DOM count=2 из первой пробы
был переходным состоянием/ещё не готовой выдачей, не доказательством двух активных
меню. `supplemental-findings.json` содержит settled count=1. На 360 px slash popup
поместился в viewport; это не проверка экранной клавиатуры.

Slash Commands 2.0 реализуем поверх **этих же** public APIs: единый каталог labels/
aliases/group/order, более короткая первичная выдача, сохранение native command
callbacks, keyboard/IME/scroll/Split tests. Не нужны второй portal, свой command
parser или новый документный формат. Поведение `/` в коде требует отдельного
проверенного negative-теста: мгновенное наблюдение в дополнительной пробе не даёт
достаточной гарантии.

## Callouts, quote и сворачивание

В core 0.54 нет default callout; официальный alert example также создаёт custom
block. В Notebook S1 уже использует поддерживаемый `createReactBlockSpec`:
`type=callout`, `kind=info/note/warning/error/success`, title, inline content и
обычные children. Есть icon, editable title, select kind. Banner — отдельный
совместимый существующий блок, quote — native. Toggle есть custom `toggle`, native
`toggleListItem` и native heading `isToggleable` с ARIA adapter.

| Требуемый вариант | Сейчас | Безопасный вариант | Сложность / риск |
| --- | --- | --- | --- |
| Информация | info, есть | Сохранить | Н / низкий |
| Важно | нет отдельного имени | Preset info/warning + title «Важно» | Н / низкий |
| Предупреждение | warning, есть | Сохранить | Н / низкий |
| Идея | note отображается как «Совет», icon Lightbulb | Alias/preset note + title «Идея» | Н / низкий |
| Успех | success, есть | Сохранить | Н / низкий |
| Ошибка / Hint | error / note, уже есть semantics | Не ломать и не дублировать | Н / низкий |

Inline форматирование и pageLink доступны общей schema. Вложенные callout children
видны в настоящем редакторе; они рендерятся BlockNote после оболочки. S18 экспортирует
детей рекурсивно, JSON/ZIP хранит полный JSON. Main autosave и история не зависят
от имени kind. Diff сравнивает props/content, детей отдельно; restore родителя
копирует всё поддерево и назначает безопасные IDs.

Copy/paste: native ProseMirror clipboard serialization + Notebook block menu с
JSON marker/fresh IDs (S3/S2). Это не то же самое, что возврат внешнего HTML:
`toExternalHTML` задан, пользовательского parse для callout/banner в S1 нет.
Generic HTML из другого приложения может не восстановить kind/icon. Ни один
lossy HTML/Markdown экспорт нельзя выдавать за обратимый backup.

Мобильный kind selector **44 px при pointer:coarse**, проверено в touch-контекстах.
На fine pointer — 17 px при 12 px тексте. Это компактный desktop control, не
доказательство маленькой touch-цели на Fold. Title input имеет `outline:none`;
отдельный focus-visible на этот input не найден — кандидат доступности для P1 QA,
не полный вердикт WCAG. Warning/success используют fixed amber/green в CSS, а не
полный набор semantic status tokens; изменение только токенизации/контраста не
должно менять утверждённую палитру.

Новый JSON-type вместо preset требует обновления **всех** S1/S5/S11/S18 consumers,
clipboard/export tests, FTS и recovery allowlists. Это намного дороже добавления
alias к существующему kind. Миграция существующих документов для этих названий не нужна.

## Page Templates

Все 7 предложенных системных сценариев уже представлены S4:

| Запрос | Built-in key / имя | Содержимое |
| --- | --- | --- |
| Пустая | blank / Пустая страница | paragraph |
| Рабочая заметка | note / Заметка | основная мысль, детали, список |
| Техническая инструкция | instruction / Инструкция | goal-callout, шаги |
| Проект | project / Проект | описание и следующие шаги; не task manager |
| Чек-лист | checklist / Чек-лист | 2 checklist items |
| Протокол | meeting / Встреча | повестка, решения |
| Личный дневник | journal / Журнал | Сегодня, итоги/toggle |

Built-ins upsert на пользователя по builtInKey без автоматического обновления
содержимого; редактировать/удалять их запрещено, можно сделать копию. Есть создание
из существующей Page, CRUD, reorder, поиск, импорт/экспорт template JSON v1.
Picker и manager уже существуют. S7 принимает templateId и в **том же** create flow
создаёт Page и синхронизирует search/tags/PageLink/live widgets транзакционно.

`addPage` создаёт пустую Page, `addPageFromTemplate` использует templateId. Sidebar,
page-list/editor empty state и command palette используют существующие действия;
выбор шаблона требует активной Section. Today/Quick Capture сначала требуют место
или явное Convert, не должны порождать «бесхозную» Page. Search открывает найденные
документы/общие команды, отдельного независимого template-create backend там нет.

**A04:** TemplateEditDialog — отдельный редактор с общей schema, но без Notebook
slash callbacks/dictionary/подсветки Shiki/upload provider/page-link metadata provider
и crash recovery. Его native slash UI не предлагает Notebook custom items как main
editor. Есть явная кнопка «Сохранить шаблон», закрытие modal не спрашивает о dirty
изменениях. Это отдельная user-scoped entity, не обычная Page и не её история.
Безопасное развитие — общий editor UI adapter/конфигурация с отдельным template
save contract и защитой закрытия, не подмена шаблонов скрытыми страницами в дереве.

**A03:** S5 рекурсивно ищет `script/javascript:/data:/blob:` во всех строках JSON.
HTTP POST template с codeBlock `const uri = 'data:text/plain,hello';` возвращает
400 «Шаблон содержит небезопасную ссылку или HTML». Нужна контекстная валидация
ссылочных/HTML полей; нельзя просто удалить security check. Private `/api/uploads/*`
ссылки намеренно запрещены до реализации явного клонирования вложений.

**A06 / P2:** Создание двух Pages из шаблона сохранённой Page оставляет исходные
blockId, включая детей. Подтверждён source/copies `a44-heading` в JSON результатов.
IDs уникальны внутри документа, поэтому одинаковые IDs в разных Pages сами по себе
не доказывают corruption (links включают pageId). Но нет единого контракта клонирования
с clipboard/partial recovery, которые генерируют свежие IDs. Следует определить и
проверить identity contract до расширения template pipeline; не переписывать старые Pages.

### A01: реальная потеря цели ссылки после backup restore

У отдельного синтетического владельца созданы target Page и private template с
pageLink на неё. Настоящие GET backup и POST restore завершились 200. После restore:

- target Page имеет новый ID;
- template.props.pageId всё ещё равен старому ID;
- GET старой цели возвращает 404, alias сохранён;
- текст шаблона не утрачен, но его ссылочная связь разорвана.

Доказательство: [template-backup-findings.json](audit-4-4/template-backup-findings.json).
Это узкий воспроизводимый P0 целостности recovery/self-hosting, не утверждение о
повреждении всех документов или общей уязвимости ownership.

S9 экспортирует Pages через portableBlocks/pageMapping, но backup templates пишет
через jsonBlocks без rewriteInternalPageReferences. Импорт custom templates после
materialize принимает raw content через validateTemplateContent без pageIds remap.
Standalone template JSON тоже хранит raw ссылки; перенос между инсталляциями требует
явного поведения недоступной цели. Обычный notebook export не включает каталог
шаблонов; application backup включает custom templates. Расширять шаблоны до решения
этого контракта не рекомендуется. Угадывание цели по одинаковому названию недопустимо.

## Tables: использовать штатный движок

S2 включает headers/splitCells; cell colors оставлены false. S8 — дополнение для
plain TSV, а не замена table engine. В установленном пакете TableHandles предлагает
row/column insert/delete/move и cell merge/split; TableExtension подключает native
columnResizing и tableEditing. UI не отключает table handles.

| Сценарий | Доказательство / результат | Статус проверки |
| --- | --- | --- |
| Создание таблицы | Native slash item / TableContent | Код + меню в Chrome |
| Rows/columns insert/delete | Installed TableHandles/default buttons | Код; exhaustive UI/touch не пройден |
| Ширина | Mouse resize 220→280, JSON [280,260,200] после autosave/reload | Реальный Chrome/HTTP |
| Tab / Shift+Tab | Cell index 0→1→0 | Реальный Chrome |
| Tab в последней ячейке | Native goToNextCell, auto-add не доказан | Требует отдельной проверки |
| Rich clipboard | Native PM serialization и HTML parser | Код; реальный Excel не запускался |
| Plain TSV | S8: quoted/newline, escaping, <=1М символов/10000 cells, widths | Unit tests; не Excel hardware test |
| Merged TSV | Fallback отключён при merged cells | Код; не перезаписывать merged table вслепую |
| Длинный URL / узкий экран | Wrapper 328 px, scrollWidth 712 при 360 px | Chrome, overflow документа 0 |
| Mobile widths | cell min-width 12rem, внутренний x-scroll | Fine и coarse Chrome; не physical Fold |
| History/restore | JSON dimensions/spans сравниваются целиком, raw JSON сохраняется | Код + 4.3.1 предшествующая приёмка |

Нет оснований добавлять другую таблицу, новую таблицу Prisma, spreadsheet library
или платный модуль ради resize/row CRUD. Цвета ячеек доступны, но их включение требует
проверить read-only history: S11 отображает текст/spans, не полностью воспроизводит
cell colors/header appearance/columnWidths. Сами данные в JSON сохраняются. Это
различие visual preview и restore, не доказательство потери таблицы при restore.

## Ежедневный UX: инвентаризация

| Возможность | Статус и конкретное ограничение | Источник |
| --- | --- | --- |
| Floating formatting | Уже реализовано: штатные items + page link; своего большого toolbar нет | S2 FormattingToolbarController |
| Block context/DnD | Уже реализовано: native SideMenu + Notebook actions, pointer drag и move up/down | S3 |
| Lists/indent/checklists | Уже реализовано native; вложенные дети не отдельный task model | S1 |
| H1–H6/quote | Уже реализовано; A02 — CSS selector mismatch, не отсутствие headings | S1/S15 |
| Code | Уже реализовано: 13 language labels, Shiki, copy/wrap controls, indent сохраняется | S1/S2 |
| Code DOM controls | MutationObserver добавляет кнопки в DOM; upgrade coupling и focus QA | S2 around code-block controls |
| Shortcuts | Native formatting/list keys; app Ctrl+K, Ctrl+Shift+P, Ctrl+Shift+N/F, Ctrl+S flush | S2/S7, installed dictionary |
| Undo/Redo | Уже реализовано native transactions, partial restore транзакционный | S2/S11 |
| Find within doc | Реализовано частично: exact-match highlighting/counter from global results; отдельного Find query input/Ctrl+F override не найдено | S17 |
| Image/file | Уже реализовано через uploadFile/authenticated API; файлы не base64 DB | S2/S16 |
| External URL | Native links + smart paste link/card/text, bookmark | S1/S2 |
| Internal links | Уже реализовано stable pageId/alias, `[[`, picker, adjacent pane | S13/S2 |
| Long documents | Весь editor JSON сериализуется для save; outline/highlights отдельные timers/observers; две живые панели максимум | S2/S12/S14 |
| Empty/load | Page empty state + dynamic loader; HTML load не равен editor ready, подтверждено 4.3.1 | editor-pane.tsx, S14 |
| Mobile keyboard | visualViewport/safe-area/scroll padding предусмотрены; IME/keyboard occlusion не проверены физически | use-workspace-viewport.ts, S15 |
| Split View | Уже реализовано; в пробе два редактора, без создания исторического editable editor | S14 |

Необходимость отдельного Find следует подтвердить пользовательским сценарием длинной
заметки, а не автоматически добавлять его ради сравнения с другим продуктом.
Stress UI на 1000+ блоков, drag на touch и настоящее копирование из Excel не проводились.

## Визуальная целостность и A02

Studio маппит `--bn-colors-*`, font/radius/shadow на свои semantic tokens (S15);
BlockNoteView получает light/dark по теме. Atelier имеет тёмную навигацию и светлый
редактор, Graphite — тёмный редактор. В браузере обе темы доступны для визуального чтения; это не полный
contrast audit. Глобальная горизонтальная прокрутка не обнаружена в выбранных размерах.

**Точная причина H1:** в DOM получено
`<div class="bn-block-content" data-content-type="heading"><h1 ...>` без data-level.
Установленный BlockNote использует default `--level:3em`, а overrides Studio
`:...heading[data-level="1"]` не совпадают. Touch-проверка обеих тем показывает
`--level=3em`, font=45px при 360 и 840. Предлагаемая будущая правка должна охватить
native default H1, проверить H2–H6 и не уменьшать весь документ через zoom/scale.
На 360 длинный H1 занимает несколько строк и отодвигает полезный текст; скриншот
подтверждает это без предположений о DPR или устаревшем APK.

Другие наблюдения: repeated slash group headings, служебные controls callout/header,
различный UI TemplateEditDialog; fine-pointer controls не следует ошибочно выдавать
за touch-нарушение. Focus callout-title и status colors — отдельная QA/token задача.
Полный редизайн палитр, новые карточки или постоянно видимый toolbar не обоснованы.

## Матрица архитектурного риска будущих изменений

| Изменение | Риск | Что нельзя пропустить |
| --- | --- | --- |
| Labels/aliases/group order slash | Низкий | Native callbacks, shortcut/IME, `[[` coexistence |
| Callout preset существующего kind | Низкий | Сохранение kind/title, без массовой миграции |
| H1 selector fix | Низкий–средний | H2–H6, exports не менять, desktop/Fold/Split |
| Shared template UI configuration | Средний | Save boundary, private attachments, pageLink provider без навигации-утраты dirty |
| Новый custom block type | Высокий | Schema, validators, exporters, FTS, unknown guard, history render/restore, clipboard |
| Advanced native table flags | Средний | Cell structures/styles, spans, paste, history fidelity, mobile hit targets |
| Template cloning/fresh IDs | Средний | Nested IDs, PageLink.pageId не blockId, old documents immutable |
| Portable template link fix | Высокий | Page mapping, legacy backups, isolation, no name matching, atomic restore |
| Autosave/lifecycle переписывание | Высокий / не требуется | revision, pending save, writer generation/IDB acknowledgement, adjacent editor |
| Просто включить XL columns/export | Высокий / вне этапа | Лицензия, format compatibility; уже есть прикладные columns, не дублировать |

Prisma Page содержит JSON/revision, PageTemplate — отдельный user-scoped JSON;
новые preset labels или UX не требуют миграций. Save/restore используют ownership
и NO KEY UPDATE до revision; snapshots/index sync в одной транзакции. IndexedDB
изолирована по user/page/writer, лимит 2МиБ/record, 50 records/25МиБ, cleanup старше
7 дней при работе приложения. Новые блоки увеличивают payload и не должны обходить
эти лимиты/guard. Diff ограничен глубиной 64/около 20000 блоков, считает выбранную
пару в worker. Неизвестные типы в истории показывают raw JSON; живой редактор блокирует
небезопасное editing и предлагает экспорт исходного JSON;
новые типы без покрытия восстановления внедрять нельзя.

## Практические результаты и артефакты

- Desktop/fine: 1920×1080, 1440×900, 1024×900; wide 840×900 и narrow 360×900.
- Touch emulation: 360×900 и 840×900, `hasTouch/isMobile`, pointer:coarse=true.
- Обе Studio-темы; настоящий Split View с двумя редакторами.
- В выбранных 10 fine viewport наблюдениях page overflow=0; touch также 0.
- Таблица при 360: clientWidth=328, scrollWidth=712. Resize и reload сохраняют 280.
- `/цит`, ArrowDown, Escape; settled `[[` имеет одну видимую suggestion panel.
- 47 existing unit tests прошли: editor-schema, editor-advanced, page-templates,
  table-paste, html-export, markdown-export, history-diff (7 файлов).
- Plain JSON export страницы действительно содержит callout/table. ZIP backup/restore
  отдельного владельца выявил A01. Полный corpus импортов/типов здесь не перепроверялся.

[Browser measurements](audit-4-4/browser-findings.json),
[settled menus/touch/H1](audit-4-4/supplemental-findings.json),
[code/resize](audit-4-4/code-table-findings.json),
[backup round-trip](audit-4-4/template-backup-findings.json).

Основные скриншоты:

- [Graphite desktop](audit-4-4/studio-graphite-clean-1440.png).
- [Atelier desktop](audit-4-4/studio-atelier-clean-1440.png).
- [Graphite touch 360: H1](audit-4-4/studio-graphite-touch-360.png).
- [Atelier touch 360: H1](audit-4-4/studio-atelier-touch-360.png).
- [Atelier touch 840](audit-4-4/studio-atelier-touch-840.png).
- [Slash 360](audit-4-4/studio-atelier-slash-360.png).
- [`[[` settled](audit-4-4/studio-atelier-mentions-settled.png).
- [Split View](audit-4-4/studio-atelier-split.png).

В первой широкой пробе переходы после ввода выполнялись быстро и вызывали обычное
предложение recovery. Скриншоты без suffix `clean`/`touch` могут содержать такой
баннер; это не объявляется новым дефектом autosave. Повторная съёмка с ожиданием
«Сохранено» и отдельными touch contexts отделяет эти состояния. Next dev overlay
на некоторых снимках — инструмент окружения, не элемент Studio.

Непроверенные сценарии: физический Android/Fold, системный масштаб/WebView и IME,
экранная клавиатура/поворот/split-screen, полный screen-reader/AA audit, реальный
Excel, исчерпывающий touch CRUD таблиц и merged paste, huge-document UI profiling,
полный внешний HTML clipboard round-trip всех custom types. Мгновенная проба `/`
в code не эквивалентна устойчивому negative-тесту. Эти пункты не считаются успешными.

Полный lint/typecheck/build и вся HTTP acceptance suite не перезапускались:
прикладной код не менялся; это документационный аудит. Результат 4.3.1 остаётся
историческим. Для документов проверяются diff, локальные ссылки, JSON результатов
и отсутствие секретов. Исправления требуют отдельного согласования.
