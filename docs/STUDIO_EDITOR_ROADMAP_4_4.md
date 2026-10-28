# Studio 4.4 — Proposed Editor Roadmap

Предложение для согласования, 28.10.2026, база `33a2b08`.
[Основания, матрица и доказательства](STUDIO_EDITOR_AUDIT_4_4.md).
Аудит описывает базу `33a2b08`. Этап **4.4-A согласован и реализован**:
R0, R2 и R6; [контракт и результаты](STUDIO_DATA_INTEGRITY_4_4_A.md).
**4.4-B реализует R1, R3 и presets R8**; [поведение, проверки и ограничения](STUDIO_DAILY_EDITING_4_4_B.md).
**4.4-C реализует основной UX R4 и R5**; [контракт, проверки и ограничения](STUDIO_TEMPLATES_TABLES_4_4_C.md).
Shared template editor, dirty-close/CAS и native touch table actions проверены в Chrome/PG.
Физический Fold/IME и настоящий Excel остаются ручной приёмкой. Остальные пункты — предложение.

## Продуктовое решение

Сохранить Notebook → Section → Page и существующий BlockNote. Studio 4.4 — качество
ежедневного ввода и безопасность уже существующих возможностей, а не новый набор
PKM-функций. Не создавать ещё один slash parser, callout schema, template store
или table engine. Принять несколько небольших этапов с отдельной приёмкой.

Оценки ниже — рабочие дни одного разработчика, включая целевые тесты и документацию,
без production deployment и ожидания проверки физического Fold. Они приблизительные;
для R0 сначала нужен короткий design review portable-контракта. Нельзя механически
суммировать оценки как обещание срока релиза.

## Приоритеты

| ID | Приоритет | Что предлагается | Уже существует / почему нужно | Изменяемые области | Зависимости | Риск | Оценка |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R0 · выполнен 4.4-A | **P0** | Восстановимый portable контракт PageLink пользовательского шаблона | A01: HTTP backup restore разрывает цель ссылки, хотя Page восстановлена | export/import/portable-content, versioned format validation и regression fixtures | Согласовать legacy behavior | Высокий, данные/backup | 3–5 дней |
| R1 · выполнен 4.4-B | **P1** | Исправить H1 selector, проверить размеры и focus | A02: нет default data-level, H1 45px на touch 360/840 | studio/studio-mobile/editor-advanced CSS; a11y tests | Runtime DOM contract 0.54 | Низкий–средний | 1–2 дня |
| R2 · выполнен 4.4-A | **P1** | Контекстная security validation шаблонов | A03: обычный code literal `data:` получает 400 | page-templates validator + security tests | Сохранить URL/attachment security boundary | Средний–высокий | 1–3 дня |
| R3 · выполнен 4.4-B | **P1** | Slash 2.0 как каталог поверх native controller | A05: 44 пункта, 14 повторяющихся group sections | slashMenuItems, labels/aliases/order, targeted UI tests | R1 для narrow QA, неизменные BlockNote callbacks | Низкий–средний | 2–3 дня |
| R4 · основной UX 4.4-C | **P1** | Согласовать UI шаблона с main editor и защитить dirty close | A04: schema уже общая, разные команды/словарь/сохранение | TemplateEditDialog + общий тонкий UI/config adapter | R0/R2, явное решение template save semantics | Средний | 3–5 дней |
| R5 · native UX 4.4-C | **P1** | Табличный UX: доступные row/column actions на touch + regression | Native CRUD/resize есть; реальный Excel/touch/merged paste не проверены | Существующие TableHandles/default components, paste tests; только доказанные UI gaps | R1, установленный 0.54 table contract | Средний | 2–4 дня |
| R6 · выполнен 4.4-A | **P2** | Единый контракт fresh blockId при создании из шаблона | A06: исходные IDs сохраняются; междокументный дубль сам по себе не corruption | Template→Page clone utility, create lifecycle | R0, запрет смешивать blockId и pageId | Средний | 1–2 дня |
| R7 | **P2** | Профилировать длинные документы и доработать history fidelity | JSON сериализация, два editors, worker diff уже есть | Замеры save/outline/highlight, read-only tables preview | Контрольный fixture/бюджеты производительности | Средний; оптимизировать после измерений | 2–3 дня на аудит/малые правки |
| R8 · выполнен 4.4-B | **P2** | Presets «Важно»/«Идея», если согласованы названия | info/warning/note и Lightbulb уже есть | Labels/aliases/default title существующих kinds | R3 · выполнен 4.4-B | Низкий, без нового JSON типа | 0,5–1 день |
| R9 | **P2, опционально** | Отдельный Find input текущего документа | Exact-match navigator уже есть, отдельного ввода нет | use-document-search и небольшой contextual UI | Подтверждённая потребность в длинной заметке; горячие клавиши | Средний | 2–4 дня |
| R10 | **P2, отложить** | Cell colors через native flags | API есть, выключен; польза не доказана | tables flags + history/HTML визуальное покрытие | R5/R7 | Средний; код мал, QA существенно больше | 1–3 дня |

**P3:** дополнительные декоративные иконки, анимации, новые variants без сценария,
дублирующие banner/callout/alert types — не включать в 4.4. AI, graph, databases,
формулы и project management не являются следующей стадией этого roadmap.
Не добавлять функцию только из-за её наличия у другого редактора.

## Критерии приёмки по пунктам

### R0 — целостность backup и ссылок шаблонов

Подтверждение A01: [реальный round-trip](audit-4-4/template-backup-findings.json).
Использовать тот же принцип независимых ключей и mapping, который уже работает
для Pages, а не сохранять PostgreSQL IDs как portable template references.

Критерии:

1. Создать Pages A/B, шаблон с internal link на B и пользовательским alias.
2. Выполнить JSON/ZIP backup/restore в отдельной тестовой БД/владельце.
3. B получает новый pageId, шаблон ссылается именно на новую B; alias сохраняется.
4. Созданная из шаблона Page открывает B; backlinks появляются только от сохранённой
   Page, не от каталога шаблонов или исторического preview.
5. Отдельно проверить missing/foreign targets, nested/table/callout inline references,
   несколько одинаковых названий, циклические ссылки и self-reference policy.
6. Проверить чтение старых форматов. Если в старом backup недостаточно данных для
   однозначного сопоставления raw pageId, сохранять безопасную недоступную ссылку
   и понятный отчёт. **Не угадывать по названию.**
7. Изменение формата явно версионировать при необходимости; не обещать lossless
   conversion старых backups без доказательства. Existing importer v1–v4 не ломать.
8. Restore остаётся атомарным, с safety backup, ownership и rollback при ошибке.

Миграция Prisma не выглядит необходимой. Риск высокий из-за backup compatibility,
а не из-за сложности изменения одной строки. Это отдельный первый PR/commit после
согласования, не часть визуального polish.

### R1 — типографика и доступность существующих controls

- Default H1 без data-level получает предусмотренный Studio размер; H2–H6 не меняются
  случайно. В fixture длинный русский заголовок, обе темы, 1920/1440/1024/840/360.
- Нет `zoom`, `scale`, глобального уменьшения шрифтов или записи в content JSON.
- В Split View размер определяется рабочей областью и существующей responsive моделью.
- Видимый focus у callout title/kind и code controls; правильные имена и порядок Tab.
- На pointer:coarse hit targets сохраняются минимум 44px; не ухудшать уже рабочие
  coarse CSS-правила из-за fine-pointer screenshot 17px.
- Замерить body/metadata/selection contrast в обеих темах. Не заявлять AA по одному скриншоту.

### R2 — валидация без ложного запрета обычного кода

- Шаблон с code/text literal `data:`, `blob:` или примером `<script>` хранит именно
  текст без исполнения. Вывод экранируется.
- Настоящий `javascript:`/неразрешённый data URL в ссылке или image URL блокируется.
- Private uploads по-прежнему запрещены до явного безопасного clone lifecycle.
- Неподдерживаемый новый тип не нормализуется молча в paragraph.
- Проверить nested inline, table cells, malformed JSON, import/export и sourcePageId
  чужого пользователя. Не принимать userId или attachment ownership с клиента.

### R3 — Slash Commands 2.0

- Один каталог команд с устойчивым порядком и непрерывными группами; не повторять
  «Дополнительно» в нескольких местах без намеренного UI-решения. Нет React
  duplicate-key errors из-за повторяющихся group label keys (A05).
- Основные ежедневные команды доступны первыми; сложные существующие элементы
  остаются обнаружимыми, функции не удаляются вместе с лишним дубликатом entry point.
- Native getDefaultReactSlashMenuItems/insertOrUpdateBlockForSlashMenu сохраняют
  корректное выделение, курсор, history и Undo/Redo.
- `/цит`, `/таб`, русские aliases «Важно»/«Идея» работают без новой серверной логики.
- Arrow/Enter/Esc/PageUp/Down, click, touch, cursor near bottom, scroll и Split View.
- При IME composing Enter не выбирает пункт преждевременно; отмена не уничтожает
  введённую строку. Отдельные negative tests для code/inline code и `[[`.
- Только одна активная suggestion panel после завершения загрузки; не считать
  переходный DOM count до ответа API доказательством двух меню.

Возможность category filtering/ranking через данные контроллера — после простого
переупорядочивания. Никакого второго parser или тяжёлой библиотеки.

### R4 — Page Templates UX

- Все семь имеющихся built-in сценариев доступны; не создавать второй каталог с
  теми же значениями и отдельным API.
- Общие dictionary, schema, command catalog, supported styles и read-only preview.
  Adapter не должен переносить page-specific ownership/save state в template.
- Built-in редактируется через копию; private template принадлежит конкретному user.
- Перед закрытием dirty template — явный безопасный выбор. Не объявлять текущий
  modal содержимым Page с autosave/history, которых у него нет.
- Новая Page создаётся существующим POST /api/pages с templateId и активной Section;
  все destinations вызывают этот путь, не дублируют backend creation.
- Internal links отображаются безопасно, открытие не теряет draft шаблона. Upload
  controls не обещают private files, которые server validator не позволяет сохранить.
- Если нужен autosave шаблонов как отдельное продуктовое решение: отдельная revision/
  conflict/recovery модель после оценки, а не reuse Page controller с фиктивным ID.

### R5 — Table Experience

- Native insert/delete row/column и header/merge/split достижимы без мышиного hover
  на touch. Не создавать собственный table engine или менять JSON structure.
- Mouse resize сохраняет columnWidths после autosave/reload, Undo/Redo и partial restore.
- Tab/Shift+Tab в начале/середине/конце, выделение диапазона, перенос между ячейками.
- Вставка из настоящего Excel: rich HTML и plain TSV, quoted tabs/newlines, пустые
  ячейки, длинные URL, merged cells; не выдавать unit TSV parser за Excel-проверку.
- На mobile прокрутка одной таблицы, не всей страницы; min cell width не переписывает
  desktop widths в JSON. Курсор/экранная клавиатура не скрываются.
- History/diff/JSON/ZIP сохраняют spans, widths, children и pageLinks. Новый cell-color
  UI не включать, пока read-only preview и экспорт не дают понятного результата.

### R6–R10 — только после основных исправлений

R6: единая глубокая clone-функция, свежие blockId во всех descendants, stable pageId/
alias внутри pageLink. Никакого массового переписывания уже сохранённых Pages.
Проверить collision, self link, duplicate titles, nested child links и отдельные блоки history.

R7: сначала измерить 100/1000+ блоков и большие таблицы в двух editors, delay autosave,
input latency, JSON/outline/highlight cost и IndexedDB limit. Не добавлять caching,
virtualization или worker на каждую задачу без профиля. При upgrade отдельно проверять
private `_tiptapEditor` usage, native toggle ARIA wrapper и MutationObserver code buttons.

R8: новые названия — aliases/presets существующих kind; Error/Совет и прежние JSON
остаются читаемыми. Отдельный `idea` type без необходимости не вводить.

R9: согласовать один compact contextual Find, reuse document-search extension и
existing matches. Не добавлять новый серверный поиск или постоянно открытую панель.
Ctrl+F/браузер и BlockNote shortcuts требуют отдельного решения, не перехватывать вслепую.

R10: четыре flags уже есть в MPL core; включить два дополнительных только при пользе,
без изменения palette Studio и с полным table/restore regression покрытием.

## Предлагаемые небольшие этапы

| Этап | Состав | Условие входа | Условие выхода |
| --- | --- | --- | --- |
| 4.4-A — Data integrity | R0 + R2 + реализация R6 — выполнены | Согласован portable/legacy контракт | Backup round-trip links, security tests, PG rollback проходят |
| 4.4-B — Daily editing | R1 + R3 + R8 — реализованы | A01 не остаётся скрытым P0 | H1/focus/slash keyboard/Chrome touch проверены; физический Fold/IME остаётся |
| 4.4-C — Existing tools consistency | R4 + R5 реализованы; R6 уже выполнен | Общее UI без изменения save boundaries | Templates/table creation/edit/export/recovery совместимы |
| 4.4-D — Optional | Выбранные R7–R10 | Пользовательская потребность/профиль | Отдельные узкие acceptance criteria; можно не делать |

Каждый этап — отдельно reviewable diff и commit только после успешных проверок.
Если бюджет ограничен, достаточно A и B: большая часть требуемых функций уже есть.
Не объединять все пункты в ещё одну крупную переработку редактора.

## Общие технические ограничения и QA gates

- Новая функциональность не ослабляет user ownership/CSRF/normalized errors.
- Page title/content сохраняются через page-service с expectedRevision и существующей
  транзакцией/индексами; не трогать этот протокол ради slash/menu polish.
- Preview истории не отправляет PATCH, новые custom blocks не обходят unknown guard.
- Проверить оба независимых редактора, autosave во время навигации, DB conflict,
  IndexedDB acknowledgement/recovery и отсутствие ложного «Сохранено».
- Сохранить JSON/ZIP backward compatibility, full content unknown blocks и safe HTML.
- Для feature-реализации: lint, typecheck, full unit, build, PostgreSQL integration,
  HTTP acceptance 4.3.1 + новые сценарии текущего этапа. Build не выполнять параллельно
  dev E2E в одном checkout; это вывод из 4.3.1.
- Desktop 1920/1440/1024, touch outer 360 и inner 840, обе темы, Split View.
  Native Android IME/keyboard/folding — отдельная физическая проверка пользователем.
- Не обновлять BlockNote, Prisma, Docker/CI/Unraid/APK в этих этапах без отдельной
  доказанной необходимости и согласования. Production deploy — отдельная команда.

## Что согласовать перед реализацией

1. Принять порядок **A → B → C**, отложить D.
2. Подтвердить P0 severity A01 и политику старых portable template links.
3. Для шаблонов выбрать небольшой shared UI adapter + защиту закрытия, сохранив
   отдельный PageTemplate store; полноценный template autosave пока не предполагать.
4. Согласовать основной видимый toggle entry point и aliases «Важно»/«Идея».
5. Определить физическую проверку Fold/IME как явный этап приёмки, а не утверждение
   по одному Chrome viewport.

Этот документ — основание для решения о следующей задаче. Найденные проблемы
не исправлены, commit/push и production deployment в рамках аудита не выполнялись.


## Результат 4.4-C

Тонкий общий adapter не переносит Page autosave/revision/recovery/uploads в шаблоны.
Явное сохранение, canonical dirty state, 3-way close, ошибки без потери draft и CAS
по updatedAt подтверждены HTTP и PostgreSQL тестами. Семь built-ins и backup v5 сохранены.
Native table CRUD/headers/CellSelection/merge/split доступны без hover; mouse resize,
clipboard, widths/reload, обе темы, structural columns и Split View проверены в Chrome.
Каталог TemplatePicker сохраняет компактный текстовый preview; новый rich read-only
preview не вводился. Native Excel clipboard, Android клавиатура и физический Fold
не считаются проверенными. Template crash recovery и private attachment cloning
остаются за рамками согласованного 4.4-C.
