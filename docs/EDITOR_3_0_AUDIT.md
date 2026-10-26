# Editor 3.0: аудит до реализации

База: main `434bf9e`. Установлены @blocknote/core/react/shadcn 0.54.0, Shiki 4.4.3.
Изучены editor-schema, structural-blocks, rich-text-editor, block menu, outline,
page-service/save queue, exporters/import-service и portable-content.

| Возможность | Текущее состояние | Решение |
| --- | --- | --- |
| Toggle heading | Штатный heading.isToggleable, slash и children уже поддерживаются | Использовать штатный механизм; добавить преобразование в меню блока |
| Toggle group | Штатный toggleListItem и старый custom toggle | Сохранить оба формата; исправить раскрытие старого toggle при переходе |
| Callout | info/note/warning/error/success, inline formatting, title, select | Сохранить identifiers, дать русские названия и прямой выбор через slash |
| Code | CodeBlock spec, 13 языков, Shiki, copy, wrap, horizontal scroll | Не создавать новый движок/toolbar; проверить отступы/многострочную вставку |
| TOC | Desktop opt-in panel, mobile sheet, inline tableOfContents, debounce | Сохранить; поддержать все 6 штатных уровней и скрытые дочерние заголовки |
| Tables | Штатные row/column controls, resize, cell navigation, headers/splitCells | Проверить штатный движок и mobile scroll, не заменять |
| Autosave/history | Одна очередь активного документа, debounce, optimistic revision | Не менять модель; все действия проходят обычный onChange |
| JSON/ZIP | BlockNote JSON, versioned manifests, generic recursive reference rewriting | Канонический обратимый формат, без миграций |
| Markdown | Производный lossy экспорт; отдельного Markdown import нет | Явно документировать ограничения, не обещать round-trip |

## Подтверждённые риски

1. HTML exporter возвращает heading без children, аналогично quote/check/callout/code.
   Скрытое содержимое такого заголовка теряется в HTML-экспорте.
2. Block menu copy использует blocksToHTMLLossy: структура custom/toggle не гарантирована.
   Для копирования внутри Notebook нужны исходные BlockNote JSON metadata в буфере;
   внешний HTML/text остаются lossy alternative. Один full HTML без clipboard slice context
   не гарантирует исходную вложенность при обычной HTML-вставке.
3. revealAndScrollBlock умеет открыть native toggle, но не legacy custom toggle.
4. extractPageOutline сводит уровни 4–6 к 1, хотя schema допускает все шесть.
5. Неизвестный тип JSON допускается server validation, но не текущей editor schema.
   Безопасный вариант — запретить редактирование такого документа с сохранением JSON,
   а не превращать неизвестный блок в paragraph и отправлять autosave.
6. Markdown details summary строится из пользовательского текста как raw HTML.
   Необходимо экранировать summary; многострочный code export должен выдерживать backticks.

Native collapse state — presentation state BlockNote, isToggleable/children сохраняются в JSON;
состояние open/closed не обещается между перезапусками. Старый toggle.props.open сохраняется.
Соседние блоки автоматически не превращаются в children: пользователь явно вкладывает их.
Автоматическая перегруппировка или миграция существующих документов не нужна.

Источники: установленный source в node_modules/@blocknote/core/src/blocks/Heading,
ToggleWrapper и Table; [официальные typography docs](https://www.blocknotejs.org/docs/features/blocks/typography),
[HTML interoperability](https://www.blocknotejs.org/docs/features/export/html).
Изменения прав, API, БД, deployment и document format version не требуются.
