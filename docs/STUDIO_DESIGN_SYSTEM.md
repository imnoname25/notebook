# Studio — дизайн-система Notebook, этап 1

## Область и интеграция

Studio Graphite и Studio Atelier — два opt-in оформления существующего Notebook.
Выбор находится в «Настройки → Оформление». Нельзя менять модель Notebook → Section → Page,
BlockNote JSON, API, Prisma, revision/autosave или production deployment ради макета.

Аудит обнаружил готовый каркас из трёх панелей, `next-themes`, пользовательские настройки
плотности/ширины и последовательные мобильные экраны. Новые стили интегрированы в эти точки,
а не в отдельное приложение:

- `src/lib/themes.ts` — identifiers, labels, цикл переключения и выбор палитры редактора;
- `src/components/theme-provider.tsx` — тот же next-themes/localStorage и pre-hydration script;
- `src/app/studio.css` — палитры, семантика, композиция и состояния только внутри Studio;
- `NotebookSidebar`, `PageList`, `EditorPane` — те же компоненты и обработчики;
- `DesktopAppHeader` — извлечённое представление прежнего desktop-header;
- `SearchDialog` — существующие данные `/api/navigation/quick`; ссылки «Избранное» и
  «Недавние» выбирают начальную группу этого диалога, без нового API или экрана данных.

Идентификаторы `system`, `light`, `dark`, `atmospheric` сохранены без миграции.
Добавлены `studio-graphite` и `studio-atelier`. Системная тема по-прежнему следует устройству,
а сохранённый выбор Studio действует независимо от системной палитры. Выбор сохраняется
в текущем браузере; application/admin defaultTheme не подменяется пользовательским оформлением.

Atelier намеренно не получает global dark class. Тёмная навигация задаёт локальные семантические
токены, а документ, диалоги и BlockNote используют светлую палитру. Graphite использует dark
palette BlockNote. Это касается также существующего редактора пользовательских шаблонов.

## Палитра

Все значения находятся в CSS-токенах. В JSX не добавляются hex/RGB цвета. Notebook/Section
appearance identifiers и пользовательские цвета контента продолжают работать.

| Роль / `--studio-*` | Graphite | Atelier |
| --- | --- | --- |
| `editor-bg` — фон рабочей области | `#14181C` | `#F3EEE4` |
| `paper` — поверхность документа/диалогов | `#181D22` | `#F8F4EB` |
| `nav-bg` — основная навигация | `#1B2025` | `#292A25` |
| `list-bg` — список документов | `#22282E` | `#34352D` |
| `nav-selected` — активный блокнот/документ | `#303A43` | `#B49A6A` |
| `nav-selected-text` | `#F1F3F5` | `#202019` |
| `editor-text` | `#E5E7E9` | `#292820` |
| `editor-muted` | `#A1A9B1` | `#706C60` |
| `nav-text` | `#E5E7E9` | `#EEECE4` |
| `nav-muted` | `#A1A9B1` | `#C0BEAF` |
| `divider` — рабочая область | `#343B42` | `#D2C9B8` |
| `nav-divider` | `#343B42` | `#4D4E43` |
| `accent` — кнопки/ссылки на рабочей поверхности | `#A4BAC9` | `#786137` |
| `nav-focus` | `#A4BAC9` | `#D1B986` |
| `input-border` | `#69737D` | `#938979` |

Адаптированные muted оттенки обеспечивают AA для мелкого текста. Латунь `#B49A6A`
используется как фон выбора в тёмной навигации, а не как малоконтрастный текст на бумаге.
Шалфей `--studio-sage: #83917C` применяется к зелёному notebook identifier в Atelier.
У активного блокнота иконка получает контрастный selected foreground; цветовая идентификация
остается у неактивных блокнотов. Счётчик блокнота показывает реальное количество разделов,
а не вымышленное число страниц.

Семантические application tokens (`--background`, `--foreground`, `--card`, `--primary`,
`--muted-foreground`, `--accent`, `--border`, `--input`, `--ring`, `--destructive`) ссылаются
на Studio tokens. Внутри навигации они локально переопределяются; не применять root foreground
к тёмной панели Atelier. Preview темы использует отдельные `--theme-preview-*` tokens.

Палитры opaque. Декоративные gradients, glass, glow и фоновые изображения в оболочку Studio
не добавляются. Тени поверхностей отключены; выбранная строка выделяется цельной заливкой.
Существующие явно выбранные пользователем backgrounds страниц и оформление блоков не удаляются.
Они могут отличаться от нейтральной Studio page surface — это сохранение существующей функции.

## Типографика и ритм

Используются локальные системные шрифты, без CDN и новых font downloads:

- `--studio-ui-font`: Segoe UI / platform sans, с кириллицей;
- `--studio-document-font`: Graphite — тот же sans-serif, Atelier — Georgia / Cambria /
  Times New Roman для редакционного заголовка;
- `--studio-code-font`: Cascadia Code / Cascadia Mono / Consolas / Liberation Mono;
- UI: `--studio-font-ui` 13 px; preview 12 px; metadata 11 px; подпись группы 10 px;
- основной текст редактора: `--studio-font-body` 15 px, line-height 1.7;
- заголовок документа: `--studio-font-title`, 26–34 px на desktop, 24–30 px на узком окне;
- заголовок Graphite — weight 600; code — 13 px / 1.65, без двойного уменьшения pre/code;
- H1/H2/H3 внутри документа: 28/20/17 px; это иерархия BlockNote, а не новые виды блоков.

Базовый шаг отступов 4 px, с половинным шагом 2 px для мелких деталей. Reading gutter
адаптируется к ширине окна. Типичная строка навигации — 32 px; actionable desktop icons —
не меньше 24 px. На узком экране и coarse pointer основные touch-targets увеличиваются
до 44 px. Сортировка на touch доступна через существующие контекстные действия;
узкий drag handle там не показывается.

Радиусы: 4 px для строк и chips, 6 px общий control radius, 8 px для диалогов.
Не окружать каждый список или раздел карточкой. Hover — спокойная surface заливка,
selected — цельная строка; disabled сохраняет штатную семантику и блокировку событий.
Focus-visible различим отдельно от hover/selected и не обрезается у кнопок.

Подсветка кода сохраняет Shiki. В Atelier выбирается `--shiki-light`, в Graphite —
`--shiki-dark`. `--studio-syntax-blend: 25%` добавляет долю foreground к token color:
это сохраняет различие синтаксиса и делает subdued comments читаемыми на Studio code surface.
Пары основного/вторичного текста, selected, tags и кнопок проверяются на WCAG AA 4.5:1;
focus ring — минимум 3:1. Unit-тесты не заменяют аудит всей пользовательской форматированной
страницы: произвольные ранее выбранные пользователем inline цвета не переписываются.

## Композиция

Desktop от 1200 CSS px: **навигация → список документов → рабочая область**.

- Навигация: `--studio-navigation-width`, 192–240 px.
- Список: `--studio-list-width`, 240–320 px (на промежуточных размерах — 248 px).
- Рабочая область: `minmax(0, 1fr)`, вложенные overflow containers удерживают длинный код/таблицы.
- Titlebar: 44 px; бренд, поиск и действующие window actions выровнены по колонкам.
- Reading width: normal 46 rem, narrow 40 rem, wide 64 rem; настройки ширины сохранены.
  Поля заголовка и тегов следуют той же настройке, что текст документа.
- Контекст: `--studio-context-width` 240 px применяется к уже существующему opt-in outline.

Классы `notebook-workspace-grid`, `notebook-document-layout`, `notebook-document-context`
и выделенный desktop-header создают seams для последующих этапов. Token
`--studio-document-strip-height` резервирует размер будущего document strip только в CSS.
Пустые панели, неработающие кнопки и фиктивные tabs не отображаются.

Список показывает существующие title, previewText, updatedAt и favorite. Вид списка выбирается
одной работающей menu button, а не тремя постоянными кнопками. Миниатюра появляется только при
реальном `coverUploadId`: используется существующий authenticated `/api/uploads/:id`,
`next/image` без optimizer и lazy loading. Для первого inline image отдельного summary API нет;
он не придумывается. Если обложки нет, остаётся обычная иконка документа, без фиктивной картинки.

На ширине меньше 768 px остаются последовательные Navigation / Pages / Editor screens и
явные Back actions. На 768–1199 px показываются список и редактор; навигация открывается
из компактной шапки вместо них. Без выбранного раздела overview занимает всю ширину.
От 1200 px доступны три панели. Режим определяется шириной окна, без user-agent/model checks;
coarse pointer влияет только на touch-targets. CSS — единственный источник режима layout,
JavaScript не меняет mobileView при resize и не пересоздаёт BlockNote. Переключение outline
согласовано: в Studio до 1200 px используется существующая sheet, затем боковой outline.
Safe-area CSS и Android Back protocol сохранены;
Capacitor/native setup не меняется. `prefers-reduced-motion` продолжает отключать переходы,
`prefers-reduced-transparency` не включает никаких прозрачных поверхностей.

## Отличия от утверждённых макетов

- Нет macOS window dots: это веб-клиент, а не имитация системных кнопок.
- Нет document tabs, split editor и новой правой context panel — они запрещены на этапе 1.
  Существующее оглавление остаётся доступным через свою действующую кнопку.
- Не добавлена статическая imitation formatting toolbar: форматирование остаётся родным
  BlockNote, с работающими selection/slash/block menus.
- Нет декоративных фотографий или вымышленных attachments. Существующие реальные обложки
  и изображения работают; браузерные fixtures без обложек показывают текстовые документы.
- Title/status/variables, breadcrumbs, шаблоны, теги, корзина, поиск, импорт/экспорт и настройки
  остаются действующими, даже если их расположение не совпадает с пикселями картинки.

## Архитектурные ограничения

`notebook-app.tsx` уже был крупным stateful coordinator. В этапе 1 из него извлечён только
header; полное разделение state/autosave/navigation требует отдельной задачи. Нельзя
перестраивать эти механизмы ради визуальной декомпозиции или менять серверные security boundaries.

Новые темы хранятся так же, как старые, в браузере. Это не синхронизация per-account settings
между устройствами; соответствующий формат данных и API в этапе 1 не расширяются.

## Проверки базового этапа 1

- `npm.cmd run check`: version check, lint, strict typecheck, 260 unit tests passed,
  36 skipped, production webpack build. Новые palette tests проверяют контрасты;
  theme tests — legacy identifiers, цикл и светлый editor Atelier.
- Headless Chrome действительно запускался. В изолированной оболочке рендерился реальный
  `NotebookApp` со всеми его компонентами, с тестовыми API-ответами и adapter AppRouterContext.
  Это компонентная UI-проверка, не доказательство серверного CRUD/ownership в PostgreSQL.
- Оба оформления проверены на 1920×1080, 1440×900, 1280×800, 1024×768, 360×800 и 840×960;
  отдельно проверен coarse pointer на 840×960. Скриншоты: `test-results/studio/` (ignored).
- Проверены: нет horizontal overflow/обрезанных editor actions, правильная editor palette,
  переключение темы без reload и без записи page content, persistence, focus mode, list views,
  create/open/autosave/pending flush, favorite/recent/search, Notebook/Section navigation,
  Today/Stickers/Templates/Tags/Trash, настройки, мобильный Back и reduced motion.
- Два серверных Playwright сценария сохранены в `e2e/studio.spec.ts` и зарегистрированы через
  `playwright test ... --list`. Полный DB-backed E2E недоступен без отдельно настроенной
  E2E_DATABASE_URL и явного E2E_RESET_DATABASE. Production DB для проверки не используется.
- Android client contract проходит в `version:check` и unit tests. Физический Android,
  экранная клавиатура и реальный fold hinge здесь не проверялись; эмуляция размера/touch
  в Chrome не выдаётся за тест APK на устройстве.

Deployment/CI workflows, Unraid, Dockerfile, API, Prisma и миграции не изменяются.
Production Unraid не обновляется.

## Этап 1.5 — аудит и доработка

В исходной реализации `c11692e` и скриншотах этапа 1 обнаружены:

- serif-заголовок Graphite, создающий несогласованность со строгой навигацией;
- три панели уже от 768 px, оставляющие мало ширины редактору внутреннего fold-экрана;
- отдельные mobile header, Back bar и breadcrumbs, отнимающие высоту ввода;
- однострочные названия в списке, слабая иерархия превью/даты и избыточные интервалы;
- отсутствие управления focus mode пальцем и обработки overlay keyboard viewport;
- статичные проверки размеров без проверки сохранения при переходе между layout.

Палитры сохранены без изменения. Название строки занимает до двух строк (одну в compact),
превью и дата спокойнее. Реальные обложки и контекстные действия сохранены. На телефоне Back
встроен в breadcrumbs; notebook и section остаются рабочими кнопками. Теги прокручиваются
в одной строке, действие переменных имеет компактную иконку с доступным именем. Заголовок
остаётся существующим однострочным input: длинное имя можно редактировать с горизонтальным
перемещением курсора, а не увеличивать несоразмерно высоту документа.

Кнопка фокуса доступна в breadcrumbs на всех размерах; повторное нажатие и Escape выходят
из режима. Back и переход по breadcrumbs также снимают focus, чтобы не оставить пустую
навигацию. Это существующий режим фокуса, без нового split editor или tabs.

`use-workspace-viewport.ts` слушает visualViewport resize/scroll и window resize. Через CSS
variables он ограничивает высоту оболочки, sheets и настроек; при необходимости прокручивает
только редактор к текущему caret. Pinch zoom не вызывает relayout. Без VisualViewport работает
`100dvh`; listeners и свойства очищаются при unmount. В коротком viewport уменьшаются верхние
отступы, но статус сохранения и действия остаются доступны. Код прокручивается внутри pre;
изображения ограничены шириной текста, цитаты используют существующий акцент темы.

Повторный Chrome-прогон: обе темы на 1920×1080, 1440×900, 1280×800, 1024×768, 360×800,
393×873, 430×932, 768×900, 840×960 и 960×700. Дополнительно проверены coarse pointer,
изменение размеров во время ввода с проверкой идентичности DOM-экземпляра BlockNote и
autosave, focus, fold navigation, увеличение базового текста до 20 px, короткое окно 393×380
и имитация overlay visualViewport высотой 340 px с проверкой положения caret.
Скриншоты этапа 1.5: `test-results/studio-polish/` (ignored).

`npm.cmd run check` этапа 1.5: Android version/client contract, lint, strict typecheck,
260 unit tests passed / 36 skipped и production build прошли. После финальных CSS-правок
production build и Chrome-прогон повторены. Два сценария `e2e/studio.spec.ts` успешно
регистрируются Playwright; это не выдаётся за их запуск с настоящей БД.

Это запуск реального Chrome с реальным NotebookApp и тестовыми API-ответами, как на этапе 1.
Имитация VisualViewport не является открытием Android IME. `adb devices` не обнаружил
устройств; физический Fold, настоящий hinge, системная клавиатура и WebView не проверены.
DB-backed E2E по-прежнему требует отдельной тестовой PostgreSQL. В `e2e/studio.spec.ts`
сохранены resize, pending autosave, focus/Back и overlay viewport сценарии для такого запуска.

Изменения этапа 1.5: `src/app/studio.css`; в `src/components/notebook/` — `editor-pane.tsx`,
`mobile-app-header.tsx`, `notebook-app.tsx`, `rich-text-editor.tsx`, `settings-dialog.tsx`,
новый `use-workspace-viewport.ts`; `e2e/studio.spec.ts`; этот документ.

## Файлы базового этапа 1

- `src/app/studio.css`, `src/app/globals.css` — токены и общая оболочка Studio.
- `src/lib/themes.ts`, `src/components/theme-provider.tsx`,
  `src/components/notebook/theme-settings.tsx` — совместимое подключение двух тем.
- `src/components/notebook/desktop-app-header.tsx`, `notebook-app.tsx`,
  `notebook-sidebar.tsx`, `page-list.tsx`, `editor-pane.tsx` — каркас, навигация,
  список документов и оболочка существующего редактора (последние пять путей
  находятся в том же каталоге `src/components/notebook/`).
- `src/components/notebook/search-dialog.tsx`, `template-dialogs.tsx` — открытие
  существующих групп поиска и согласованная тема редактора шаблонов.
- `src/lib/themes.test.ts`, `src/lib/studio-theme.test.ts` — совместимость и контраст.
- `e2e/studio.spec.ts`, `e2e/visual-refresh.spec.ts` — браузерные сценарии и цикл тем.
- `docs/STUDIO_DESIGN_SYSTEM.md` — дизайн-система и результаты проверки.
