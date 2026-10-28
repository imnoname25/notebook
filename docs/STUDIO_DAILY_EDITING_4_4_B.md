# Studio 4.4-B — Daily Editing & Slash Commands 2.0

28.10.2026. База `d169164`, BlockNote core/react/shadcn **0.54.0** по установленным
package.json. Этап исправляет A02/A05 аудита. Палитры Studio, Prisma, BlockNote
JSON, API, autosave/revision, IndexedDB, история, PageLinks, Docker/CI и APK не меняются.

## A02 — заголовки по реальному DOM

В `core/src/blocks/Heading/block.ts` default level равен 1. BlockNote не записывает
default props в DOM: реальный H1 имеет `.bn-block-content[data-content-type="heading"]`
и дочерний `h1.bn-inline-content`, но не имеет `data-level`. Native `Block.css`
назначает такому блоку `--level: 3em` (45 px при body 15 px). Прежние Studio rules
выбирали только `[data-level="1"]`, поэтому не применялись.

Теперь desktop/mobile selectors выбирают heading с отсутствующим data-level **или**
с явным level=1. Desktop H1 — 1.75rem (28 px), narrow — 1.5rem (24 px).
H2=1.25rem, H3=1.0625rem, прежние native H4–H6=1em/0.9em/0.8em не меняются.
При body 15 px и root 16 px получается 28/20/17/15/13.5/12, а на узкой панели
24/20/17/15/13.5/12. JSON и level props не переписываются.

Использован существующий `.notebook-document-layout` CSS-container: при ширине
до 48rem H1 уменьшается даже на широком мониторе, если узка панель Split View.
Вложенная `columnPanel` получает собственный inline-size container. Её фактический
DOM содержит `.bn-block > .react-renderer > [data-content-type="columnPanel"]`;
селектор учитывает обёртку React node view. Структурный layout колонок не переписывается.
Длинные непрерывные строки заголовка переносятся через `overflow-wrap: anywhere`.
Глобальные zoom/scale и уменьшение всего редактора не применяются.

## A05 — один каталог, native исполнение

Причина повторов: прежде native commands и Notebook commands просто объединялись,
при этом группы задавались по фрагментам key/title. Native `SuggestionMenu.tsx`
использует group label как React key при каждой смене группы; несмежные повторы
давали duplicate-key errors. Кроме того, H4–H6 находились далеко от H1–H3.

`src/lib/editor-slash-catalog.ts` содержит единые названия, порядок, группы и aliases.
`organizeSlashCommands` меняет только presentation metadata, сохраняет ссылки на
native callbacks, icons, badges и прежние aliases. `getDefaultReactSlashMenuItems`,
`filterSuggestionItems` и `SuggestionMenuController` остаются штатными. Новый parser,
portal, серверный индекс, меню или зависимость не создаются.

Сохранены **все 44** прежних действия (23 native + 21 Notebook); два presets дают
**46 команд**, уникальные keys/titles, шесть непрерывных категорий:

| Категория | Команды |
| --- | --- |
| Текст и заголовки | Обычный текст, H1–H6, Цитата |
| Списки | Маркированный, Нумерованный, Чек-лист, Сворачиваемый список |
| Информационные блоки | Информация, Важно, Предупреждение, Идея, Совет, Успех, Ошибка, Баннер |
| Структура | Сворачиваемая группа, Группа с вложенными блоками, Вкладки, Колонки, Три колонки, Оглавление, оба разделителя, сворачиваемые H1–H3 |
| Медиа и ссылки | Изображение, Видео, Аудио, Файл, Ссылка на страницу, Закладка |
| Дополнительно | Таблица, Блок кода, Emoji, шесть существующих Live Widgets |

Таблица остаётся в «Дополнительно»: отдельная малонаполненная категория не нужна,
а `/таб` находит её напрямую. Все существующие медиа и виджеты сохранены; новых
типов ради предложенной структуры нет. Английские aliases и прежние названия
сохранены как поисковые aliases. `/цит`, `/таб`, `/важ`, `/идея`, `/код`, `/ссыл`
работают через native case-insensitive substring filtering. «Ссылка на страницу»
предшествует Закладке в результатах `/ссыл`.

## Presets и сворачивание

`CALLOUT_PRESETS` в существующем `editor-callouts.ts`:

| Preset | Сохраняемый type/kind/title |
| --- | --- |
| Важно | `callout` / `warning` / `Важно` |
| Идея | `callout` / `note` / `Идея` |
| Остальные пять kinds | Прежние `callout` kinds, пустой необязательный title |

Старые документы, kinds и собственные titles сохраняются. Создание использует
`insertOrUpdateBlockForSlashMenu`, изменение считается обычным вводом. В браузере
проверяются autosave/reload, manual snapshot, изменение и restore версии, JSON export.
Никаких `important`/`idea` block types или миграций.

Различия трёх существующих механизмов:

- **Сворачиваемый список** — native `toggleListItem`, категория «Списки».
- **Сворачиваемая группа** — прежний Notebook `toggle`, основной пункт «Структуры»,
  заголовок «Детали» и вложенный paragraph; open prop хранится как раньше.
- **Группа с вложенными блоками** — прежний Notebook preset native toggleListItem,
  который сразу создаёт дочерний paragraph; сохранён отдельный entry point.
- **H1–H3 со сворачиванием** — native heading с `isToggleable: true`, ниже в «Структуре»;
  находятся по «сворачиваемый заголовок»/английским aliases.

Callbacks и семантика сворачивания не изменялись. Все варианты доступны без миграции.

## Меню, фокус и touch

Native compact item size скрывает длинные описания и уменьшает icon padding.
Slash-list ограничен 24rem и доступной высотой FloatingUI, имеет один собственный
scroll. Native autoPlacement/shift/size, portal, cursor anchoring и клавиатурный
handler сохранены. Класс на native popover позволяет flex-child с `min-height:0`
уменьшаться до вычисленного availableHeight; menu не меняет layout документа.

Выбранный option имеет semantic accent background и тонкий primary marker.
Подтверждена и исправлена существующая ловушка: native обработчик Tab кодового
блока перехватывал клавишу даже при фокусе в language select. Узкий capture guard
останавливает распространение Tab/Shift+Tab только от select/button внутри codeBlock,
не отменяя browser default. Фокус идёт язык → copy → wrap и обратно; ввод и Tab
в самом contenteditable не перехватываются этим guard.

Фокус callout title/kind, banner input/select, language select, copy/wrap buttons
и toolbar controls получает видимый outline через существующий `--ring`.
Для coarse pointer строки меню, callout inputs/selects и code/toolbar controls
имеют цели минимум 44 CSS px, где это применимо. Desktop строки — минимум 32 px.
Палитры и semantic color definitions не меняются. Это targeted проверка, не общий
сертификат WCAG AA для всего редактора.

Slash `shouldOpen` проверяет code block, inline code mark и composing view —
аналогично существующему `[[` controller. Один native SuggestionMenu extension
управляет обоими triggers; отдельный конкурирующий state не добавляется.
ArrowUp/Down, PageUp/Down (первый/последний пункт), Enter и Esc остаются native.
Отмена оставляет введённый текст. В Split View каждый controller связан со своим
editor instance; команды не изменяют соседний документ.

## Проверки и доказательства

| Проверка | Результат |
| --- | --- |
| Целевой unit suite каталога | 15/15 |
| PostgreSQL integration | 66/66, 16 suites, отдельная PostgreSQL 18 |
| HTTP E2E 4.3/4.4-A/4.4-B + workspace | 15/15, 5.1m, настоящий Next dev + PostgreSQL + Chrome |
| `npm run check` | Пройден: version contract, lint, typecheck, 429 unit tests, production build |
| Production build | `next build --webpack`, 57 static pages |

67 DB/environment-gated tests пропущены обычным unit режимом; это не засчитывается
как успешный прогон. Отдельный PostgreSQL integration suite прошёл 66/66.
HTTP проверки выполнялись против dev-сервера; production HTTP/Android runtime не запускались.
[Машиночитаемые результаты и утверждения размеров](daily-editing-4-4-b/checks.json).

Dev/E2E и production build выполнялись последовательно. Предыдущие неуспешные
прогоны выявили неверный direct-child selector вложенного React блока, замеры
во время штатного font-size transition, неверные предположения fixtures о hidden
subtext/native badges и конфликт одинаковых названий тестовых страниц между темами.
Ожидания заменены на конкретные состояния и уникальные fixture titles, таймауты
не увеличивались. Реальная ловушка Tab в language select исправлена отдельно.
Синтетический composition test использует полный start/end cycle; одиночный
искусственный keydown не эквивалентен действительной IME-сессии.

В browser test измеренный контраст выбранного пункта меню проверяется на >=4.5:1
в обеих темах. Это одна конкретная пара foreground/background, не аудит AA всего UI.

| Вид | Graphite | Atelier |
| --- | --- | --- |
| H1–H6, 1920 | [Screenshot](daily-editing-4-4-b/studio-graphite-headings-1920.png) | [Screenshot](daily-editing-4-4-b/studio-atelier-headings-1920.png) |
| Slash, desktop | [Screenshot](daily-editing-4-4-b/studio-graphite-slash.png) | [Screenshot](daily-editing-4-4-b/studio-atelier-slash.png) |
| Touch menu, 360 | [Screenshot](daily-editing-4-4-b/studio-graphite-touch-menu-360.png) | [Screenshot](daily-editing-4-4-b/studio-atelier-touch-menu-360.png) |
| Touch headings, 840 | [Screenshot](daily-editing-4-4-b/studio-graphite-touch-headings-840.png) | [Screenshot](daily-editing-4-4-b/studio-atelier-touch-headings-840.png) |
| Узкий Split на 1920 | [Screenshot](daily-editing-4-4-b/studio-graphite-split.png) | [Screenshot](daily-editing-4-4-b/studio-atelier-split.png) |

В папке также сохранены 1024/1440 и другие touch screenshots. Все данные
синтетические, без реальных персональных данных/секретов.

Новые unit tests используют реальные installed native slash items и schema,
проверяют 23 native callbacks/badges/aliases по identity, 46 доступных команд,
уникальность keys/titles, непрерывность и порядок групп, русский/английский поиск,
preset JSON и отсутствие новых block types. Mock используется только для проверки
аргументов вызова штатной insertion-функции у Notebook presets.

`e2e/daily-editing.spec.ts` использует настоящий Next HTTP server/PostgreSQL/Chrome:

- Graphite/Atelier: 1920/1440/1024 × 900; touch contexts 360/840 × 900.
- DOM без default data-level, H1–H6, nested heading и длинный русский текст.
- Широкий монитор + узкая панель Split View; header/body не переписываются.
- Root font 125% как проверка увеличенного текста; ожидание конечного размера после
  native `font-size 0.2s` transition, без произвольных увеличенных таймаутов.
- Open/filter/scroll/Arrow/Page/Enter/Escape, mouse/touch выбор, cancellation text.
- Presets, сохранение/reload, snapshot/restore и JSON export.
- Code block/inline code guard, `[[`, slash page-link picker, одиночное активное меню.
- Tab/focus callout и code controls, отсутствие React console errors.
- Touch table insertion, reload, viewport height 500 как моделирование уменьшенной
  рабочей области, без горизонтального overflow.

## Ограничения

Chrome touch/viewport resize не являются физическим Fold, настоящим складыванием,
Android WebView, виртуальной клавиатурой или IME. Синтетический compositionstart /
Enter(isComposing,229) / compositionend проверяет guard; полноценный ввод русским,
китайским или другим IME на физическом устройстве не подтверждён.
Root font 125% не выдаётся за проверку всех browser/system zoom настроек.
Физическая проверка Fold/IME остаётся ручным этапом приёмки. Production не обновлялся.

Отдельное наблюдение DOM: часть прежних structural-column layout selectors в
`globals.css` требует прямой `.bn-block-content`, тогда как custom blocks имеют
React wrapper. В тестовом документе существующие columnPanel выводятся вертикально;
этот этап проверяет типографику их вложенных headings и не объявляет приёмку
двухколоночного structural layout. Его исправление требует отдельной scoped задачи,
layout колонок здесь не менялся.

Ручная проверка: обе темы, внешняя/внутренняя ширина, `/важ`/`/идея`, Enter IME,
`[[`, открытие клавиатуры у нижнего края, два редактора, сохранение и повторный вход
в документ. Текст не должен исчезать при Esc, resize или смене активной панели.

## Файлы

- `src/lib/editor-slash-catalog.ts`: presentation catalog/order/aliases.
- `src/lib/editor-callouts.ts`: совместимые presets.
- `src/components/notebook/editor-schema.tsx`: сборка commands из прежних native/custom callbacks.
- `src/components/notebook/rich-text-editor.tsx`: native controller options и code/composition guard.
- `src/app/studio.css`, `studio-mobile.css`: исправленный H1 selector.
- `src/app/editor-advanced.css`: pane/column heading scale, scoped menu/focus/touch styles.
- `src/components/notebook/editor-slash-catalog.test.ts`, `e2e/daily-editing.spec.ts`: regression.
- Этот документ, roadmap и синтетические browser screenshots/metrics.

Не включены R4 (template editor UX), R5 (table experience overhaul), R7/R9/R10.
