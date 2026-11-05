# Studio 4.4-E.1 — HTTP regression audit and stabilization

## Scope and identity

Аудит выполняется на `abcac2961a0c7c08403b51be4db82da40a15c37e` и сохранённых локальных изменениях Studio 4.4-E. Production по сообщению пользователя healthy после 4.5.1; в рамках этого этапа production не подключался и не изменялся. Публикация образа и push запрещены этим ТЗ и не выполняются.

`C:/Project/Note` содержит E; чистый checkout `C:/Users/metroom/.codex/worktrees/startup-recovery-4-5-1/Note` используется для baseline. Существующие изменения не сбрасываются; исходный diff сохранён в ignored cache. `.vscode/` не редактируется.

## Evidence before changes

Предыдущий полный E run: **70 passed / 14 failed / 7 did not run**, 91 test, без retries: [summary](editor-fundamentals-4-4-e/final-full-http-summary.json). Предыдущий baseline 43a972d: 77 tests, 52/18/7. Это разные составы; сравниваются имена сценариев и причины, а не только totals.

Ниже — классификация исходных 14 failures по сохранённым полным traces и коду; текущий чистый baseline проверяется отдельно. Ни один незапущенный serial-тест не считается успешным.

| File / scenario | Expected / actual | Initial classification and evidence |
|---|---|---|
| appearance: mobile Back | Login → appearance; кнопки «Войти» нет | test defect: первый файл запускается до создания администратора, UI показывает setup |
| daily-workflow: capture/tag | Открыть tag; locator выбирает 5 кнопок | test defect: regexp совпадает с названием страницы, избранным и действиями вкладки; tags после 4.4-D находятся в нижнем details |
| mobile-shell: header | Все кнопки ≥48 px; brand имеет высоту 36 px | pre-existing defect candidate: фактическая доступная область brand меньше контракта; нужны измерения отдельно от Studio overrides |
| mobile-shell: Back | Открыть section; строка существует, но скрыта | test defect candidate: восстановленный рабочий экран/Studio drawer не открыты перед поиском section |
| notebook: first user workflow | Setup UI; admin уже создан другими файлами | test defect: зависимость от порядка файлов; 4 serial-сценария после него не выполняются |
| stage4: portable notebook import | Открыть data UI; старой кнопки нет | test defect: настройки доступны через profile/menu, затем данные; 3 serial-сценария после него не выполняются |
| stage5: editor preferences | Открыть настройки; старой кнопки в шапке нет | test defect: актуальный mobile menu не открыт |
| stage5: backup create/delete | Открыть backup UI; старой кнопки нет | test defect: актуальное profile menu не открыто |
| stage5: TOC/deep link | Найти heading; совпали heading и TOC button | test defect: неуникальный locator; проверка должна различать документ и оглавление |
| stage6: FTS | Заполнить поиск; совпали 4 notebook/action buttons | test defect: старый modal workflow; использовать Ctrl+K и существующий quick-search combobox |
| studio-polish Graphite: mouse resize | 440×430; осталось 320×340 | test defect confirmed by browser probe: handle расположен вне viewport, mouse не попадает в DOM; после прокрутки настоящий pointer resize меняет ширину до 440 |
| studio-polish Atelier: mouse resize | То же | та же причина; функциональность mouse resize нельзя проверять координатой за пределами окна |
| studio-polish Atelier: tree DnD | Одна notebook row; найдены две | test defect: тематические сценарии создают одинаковые названия в одном аккаунте |
| unified-search Atelier | Один результат; найдены два Network runbook | test defect: повторяющийся fixture; поиск корректно возвращает оба документа |

Resize probe на чистом main, 14 синтетических карточек в отдельном USER: handle rect `{x:874,y:1909,width:28,height:28}` при viewport 1440×900, `elementFromPoint=null`; mouse ничего не меняет. После прокрутки rect y=808, hit принадлежит целевой карточке; width становится 440. Самостоятельный repro сохраняется в local ignored `node_modules/.cache/e1-probe/resize.json`. Это реальные Chromium/HTTP/pointer events, не API mock. Начало drag следует центрировать внутри scroll container, чтобы не смешивать resize с edge auto-scroll.

## Environment findings

- Dedicated native PostgreSQL 18.6, localhost:55439, новые отдельные UTF8/ICU databases; production DATABASE_URL не используется.
- До первого HTTP-запуска нужна schema. Playwright webServer readiness выполняется до globalSetup: при URL `/` пустая БД даёт 500 на login и readiness timeout. Начальные неготовые запуски не являются app regression result.
- Playwright 1.62.1 ожидает отсутствующий bundled Chromium 1234. Доступный системный Chrome запускается; валидные прогоны явно используют `E2E_BROWSER_CHANNEL=chrome`.
- Параллельные dev servers истощили память (около 550 МБ свободно); диагностические запуски остановлены. Валидное сравнение выполняется последовательно на production builds, без увеличения test timeouts.
- В нескольких старых touch/security тестах захардкожен localhost:3100. Baseline на 3102 с переходом touch-контекста на 3100 некорректен; остановлен и исключён из выводов. Повторный baseline использует 3100.
- Физический Fold, реальная Windows clipboard/Notepad и Android IME здесь не проверяются.

## Acceptance status

**NO-GO для окончательной релизной приёмки:** полный свежий HTTP run 5 ноября завершился 93/94. Единственный failure — ENOSPC при записи CDP артефакта; последующие assertions этого сценария не исполнились. Это подтверждённое ограничение тестового окружения, а не доказательство ошибки приложения. Пропуск не считается успехом. Нужен новый полный зелёный прогон в окружении с достаточным свободным местом. Production и origin/main не изменялись.

## Повторное полное сравнение до исправлений E.1

| Состояние | Runtime | Passed | Failed | Not run |
|---|---|---:|---:|---:|
| Чистый abcac29, 77 tests | production build | 51 | 19 | 7 |
| Сохранённая E, 91 tests | production build | 68 | 16 | 7 |

[Baseline](editor-http-4-4-e-1/baseline-http-summary.json), [E до исправлений](editor-http-4-4-e-1/before-http-summary.json). Сопоставление общих test keys: 14 исходных failures присутствуют в обоих запусках; editor-layout и 2 studio-mobile исправлены в сохранённой E. Все 14 новых E-сценариев прошли. Два дополнительных failure в обоих production-запусках — C.1 Fiber probe: minification удаляет исходное имя `NotebookWorkspace`, поэтому `metrics.mounts` равно `{}`. Это **environment / unsupported diagnostic build mode**, не доказательство remount. Assertions не удаляются: окончательный полный gate выполняется на одном dev-сервере, как исходный HTTP suite. Предыдущие 52/18/7 и 70/14/7 не подменяют эти новые результаты.

## Дополнительные причины, выявленные после разблокировки serial-тестов

| Наблюдение | Причина / классификация | Изменение |
|---|---|---|
| Непустой compact JSON показывает «Пустая страница» | **pre-existing defect**: `extractBlockNoteText` игнорировал строковый `content` и shorthand table cells; существовал на чистом main | Чтение только текстовых content/cells (не appearance props), unit и реальная PG save/search/revision регрессия. JSON не преобразуется |
| «Выйти на всех устройствах» отсутствует в accessibility tree | **pre-existing defect**: глобальный `.notebook-no-print button:has(> .lucide-shield-check) { display:none }`, git blame `dc453366` | Удалено скрывающее правило; существующая операция и авторизация не меняются |
| Studio header всё ещё 44px после изменения studio.css | Реальный источник окончательного override — `studio-mobile.css`, более специфичный селектор | 48px hit areas в конечном mobile override; высота 52px шапки и палитры сохранены. Обычный brand получил min-height 48px |
| dev/webpack не запускается: Edge bundle требует fs | **pre-existing dev-build defect**, исходник main тот же: early-return guard оставлял Node-only import в графе Edge | Положительная ветка `NEXT_RUNTIME === "nodejs"` по установленному Next guide; scheduler запускается как раньше в Node, 3 unit contracts. Production функциональность scheduler не расширяется |
| Новый setup тратит 23s на первый GET / | **environment**: холодная dev compilation внутри 30s пользовательского теста | Ограниченная подготовка реальных маршрутов до тестов, OPTIONS без мутации; защищённые GET обязаны вернуть 401. Test timeouts не увеличены |
| Секция закрыта / click закрывает дерево | **test defect**: контекст после login/reload не подготовлен; check-then-toggle гоняется с RAF восстановления expansion | Идемпотентный выбор нужного notebook и ожидание конкретного overview/готового документа; после reload проверяется сохранённое назначение, а не выполняется преждевременная навигация |
| Старые history locators ищут editable BlockNote | **test defect**: после 4.3 история read-only и содержит structural comparison | Выбор historical timeline entry, assertion содержимого diff, отсутствие editable snapshot и реальное восстановление с reload |
| Ожидание «Сохранение...» | **test defect**: актуальная строка «Сохранение…»; после forced save transient может уже исчезнуть | Состояние debounce проверяется актуальной строкой, forced save подтверждается успешным PATCH и последующим reload |
| Space/ArrowUp/Space не отправляет reorder | **test defect**: следующий key отправлялся до активации keyboard sensor | Ожидание focus, aria-pressed и drop target, затем HTTP200 и сохранённый порядок |
| Цвет notebook сбрасывается после мгновенного reload | **test defect**: reload выполнялся до ответа PATCH | Обязательные успешный ответ и обновлённый UI до reload, затем те же persistence assertions |
| Imported section выбирается дважды | **test defect**: источник и импорт имеют одинаковые допустимые имена | Выбор конкретного импортированного notebook; проверка содержимого остаётся |
| Импортированное изображение hidden | **test defect**: fixture содержал только 8 байтов PNG signature, не изображение | Валидный synthetic PNG; помимо видимости проверяется naturalWidth=1 |
| Columns selector не находит grid | **test defect**: старое предположение о соседстве `.bn-block-content + .bn-block-group` не соответствует React wrapper | Поиск по стабильному fixture blockId; проверка реального display:grid и вертикального положения обеих колонок на mobile |
| Mobile appearance ищет кнопку скрытого списка | **test defect**: рабочий список не отображается одновременно с редактором | Открытие appearance на desktop и resize открытого диалога в mobile; Android Back возвращает прежний редактор |

Самостоятельный браузерный probe подтвердил, что выбор notebook из **готового** открытого документа действительно показывает overview. Ожидания готовности не заменяются sleep. Сценарий клика во время самого bootstrap не заявляется отдельно проверенным контрактом.

## Границы исправления индекса

Исправление extractor применяется через существующий save/restore/import lifecycle. Содержимое, blockId, формат истории и backup v5 не меняются. Массовое обновление старых сохранённых `searchText` **не выполняется**: если такие записи уже имеют пустой производный индекс, он обновится при штатном сохранении/восстановлении/импорте. Отдельный целевой reindex потребует самостоятельной диагностики и решения; старые данные не переписываются ради зелёного теста.

## Организация тестов

Первый administrator создаётся настоящим UI в dependency project `setup`. Это сохраняет first-run coverage и устраняет предположение, что конкретный feature file обязан быть первым. Добавлены две тематические проверки шапки, старый default/light сценарий сохранён. Feature files запускаются после setup; retries=0 в acceptance-команде. Вложенные browser contexts получают `baseURL` из публичной конфигурации Playwright, включая API-only сценарии, где текущая страница ещё `about:blank`.

Точечные прогоны служат диагностике, а не доказательством полного gate. Их logs/traces находятся в локальном ignored `node_modules/.cache/e1-*`; неудачные и прерванные попытки сохранены отдельно. Полные pre-fix summaries приложены выше. Финальные числа и артефакты свежего полного запуска приведены ниже; частичные reruns не заменяют его результат.

## Полный post-fix run 1 и продолжение 5 ноября

Запуск 30 октября на порту 3103 завершился **83 passed / 7 failed / 4 not run**, 94 tests, retries=0, flaky=0. [Сводка](editor-http-4-4-e-1/attempt-1-http-summary.json). Это красный gate, несмотря на прохождение большей части набора.

| Failure | Root cause | Последующая правка |
|---|---|---|
| history foreign-account API, template integrity Graphite/Atelier (3) | **test regression, внесённая в E.1**: `new URL(page.url()).origin` при `about:blank` возвращает `null`; исходные hardcoded URL работали на 3100 | `test.info().project.use.baseURL`; сохраняются ownership 404 и настоящие ZIP restore assertions |
| notebook restore | **test defect**: общий fixture уже содержит 3 элемента корзины; глобальный locator «Восстановить» неоднозначен | Scope конкретного article по заголовку целевой удалённой страницы |
| sticker resize Graphite/Atelier (2) | **test defect**: прокрутка к поздней карточке недостаточна для центровки у конца canvas; drag пересекает edge zone, штатный auto-scroll добавляет 108px к высоте (538 вместо 430) | Отдельный USER и две карточки; endpoint drag проверяется вне edge zone. Точные 440×430 сохранены, auto-scroll приложения не отключается |
| editor paste/code Graphite | **environment/test readiness**: после очередного полного перехода workspace ещё загружает дерево и документ, `.bn-editor` отсутствует; Atelier прошёл | Сначала ожидается конкретный GET страницы с HTTP200, затем editable editor с правильным pageId; лимиты времени не увеличены |

После паузы тестовый PostgreSQL восстановил свой локальный WAL штатно и сообщил ready; production не подключался. Старые неудачные результаты не удалены. Новое продолжение использует ту же базу исходников `abcac29` + локальные E/E.1; origin/main не изменился.

В точечном продолжении прошли 29/30 сценариев. Оставшийся Atelier paste проверял вставку в середину строки, но фактически получил `PrefixSuffixOne` + `Two`: положение курсора перед paste не проверялось. Драйвер `Home` + 6 стрелок заменён реальным mouse click по измеренной DOM Range координате; до paste обязательно проверяется текст слева от caret, равный `Prefix`. DOM редактора не изменяется. Ожидания `PrefixOne` и `TwoSuffix` сохранены. Это не принимается за доказательство дефекта преобразования текста без проверки исходного selection.

## Ручная приёмка, которая остаётся за пределами автоматизации

- Windows: создать синтетический документ, скопировать из настоящего Notepad несколько CRLF-строк, включая пустые, вставить в пустую заметку и в середину строки. Проверить оба края, Undo/Redo, autosave, reload и поиск. Автоматические clipboard events Chromium не считаются тестом внешнего Notepad.
- Проверить многострочное выделение и преобразование типов, ввод сразу после добавления блока, историческую заметку с transparent props без изменения её JSON.
- На физическом Fold: внешний/внутренний экран, поворот и resize Single/Split, Android IME, системное выделение текста, таблица с длинными значениями, клавиатура и отсутствие перекрытия курсора.
- Синтетический текст при потере сети: дождаться явной ошибки сохранения, восстановить сеть, подтвердить сохранение и повторное открытие; восстановить локальный draft после аварийного завершения. Проверки Chrome/IndexedDB ниже не заменяют Android wrapper.

## Воспроизведение автоматических проверок

Рабочая копия — `C:/Project/Note`; подключение только к специально созданным test databases. В установленном окружении есть native PostgreSQL 18.6 и системный Chrome. Запускать build и dev HTTP последовательно.

```powershell
npm.cmd run check
# TEST_DATABASE_URL — отдельная PostgreSQL test DB с применёнными migrations.
$env:TEST_RESET_DATABASE = '1'
npm.cmd run test:integration
# E2E_DATABASE_URL — другая отдельная test DB; глобальный setup удаляет её User data.
$env:E2E_RESET_DATABASE = '1'
$env:E2E_BROWSER_CHANNEL = 'chrome'
$env:E2E_BASE_URL = 'http://127.0.0.1:3103'
# UPLOAD_DIR и BACKUP_DIR должны совпадать у runner и запущенного им сервера,
# указывать на отдельные тестовые каталоги и не использовать production mounts.
npx.cmd playwright test --retries=0 --reporter=list,json
```

Перед HTTP убрать TEST_DATABASE_URL/TEST_RESET_DATABASE из окружения, если они не нужны; конфигурация Playwright берёт DATABASE_URL из E2E_DATABASE_URL. Не запускать эти команды с production URL. Пароли/production connection strings в отчёт не включаются.

## Снимки интерфейса

Chrome, dev build, синтетический аккаунт. Next dev indicator не является частью production UI. Физический Fold не тестировался.

- [Graphite header](editor-http-4-4-e-1/images/studio-graphite-header.png), [Graphite menu](editor-http-4-4-e-1/images/studio-graphite-menu.png).
- [Atelier header](editor-http-4-4-e-1/images/studio-atelier-header.png), [Atelier menu](editor-http-4-4-e-1/images/studio-atelier-menu.png).

## Итоговые проверки 5 ноября 2026

| Проверка | Фактический результат |
|---|---|
| `npm run check`: version contract, lint, typecheck | PASS, exit 0 |
| Production build | PASS; выполнен до запуска dev HTTP, не параллельно |
| Unit | 450 passed / 70 skipped, 79 files passed / 18 skipped |
| PostgreSQL integration | 69/69, 18 files; native PostgreSQL 18.6 UTF8/ICU, не PG17 |
| Полный HTTP + browser | **93 passed / 1 failed / 0 skipped / 0 flaky**, retries=0, 94 tests, 24.5 min |
| Git diff whitespace | PASS |
| Gitleaks | Код, тесты и остальные evidence PASS; два heuristic matches в identity manifests вручную подтверждены как SHA-256 `e2e/auth.setup.ts`, совпадающий с хешем файла |

[Полный HTTP summary](editor-http-4-4-e-1/final-http-summary.json), [gate status](editor-http-4-4-e-1/gates.json), [идентификация проверенных исходников](editor-http-4-4-e-1/source-identity-20261105.json).

Unit skips не названы успехом: PostgreSQL-gated файлы отдельно запускались в integration mode. Обычный reporter дал aggregate 70 skips, тогда как включённый integration mode собрал 69 tests; эти разные числа не складываются в фиктивный общий suite.

### Оставшийся failure

`workspace-responsiveness.spec.ts:61`, Graphite, `measured workspace navigation and delayed reads`: `ENOSPC: no space left on device, write` на строке 96, запись `performance.json`. Файл оборван на 11,534,336 bytes; error-context и trace также не записались из-за ENOSPC. После закрытия Chrome свободно около 2 GB; это не доказывает наличие свободного места в момент сбоя. Atelier тот же сценарий прошёл, записав CDP trace 74,076,192 bytes и `measurements.json`; оба reversed-lists / 30 rapid selections / pending-autosave сценария прошли. Ошибка воспроизводимого полного run сохранена, а не объявлена таймаутом или UI regression.

Поскольку запись артефакта стоит перед итоговыми assertions, Graphite-сценарий **не считается принятым**. Удаление записи trace или перенос/ослабление assertions ради зелёного результата не выполнялись. Сырые артефакты остаются локально в ignored `node_modules/.cache/e1-acceptance-20261105/`; полный JSON summary выше пригоден для review. Измерительное ограничение не означает, что ранее описанный пользователем transient исчезновения Workspace окончательно устранён на его production: физическое наблюдение пользователя отдельно не воспроизведено.

### Проверенные области и ограничения

В полном run прошли редактор Single/Split, paste/caret, многоблочные операции, исторический JSON без его преобразования, autosave/revision conflict, IndexedDB recovery, история и partial restore, внутренние ссылки/backlinks, поиск/фильтры, шаблоны, ZIP/backup v5, таблицы/structural columns, блоковый и page DnD, темы и mobile viewports. Реальный HTTP использовал Next и тестовую PostgreSQL; это не перехваченный mock-server. Некоторые сценарии намеренно задерживают настоящий HTTP response или подают synthetic 503 для проверки обработки ошибок.

Не проверены физический Fold/Android IME, вставка из внешнего Windows Notepad, PostgreSQL17, production environment, Docker/CI и развёртывание. Chrome synthetic clipboard и viewport emulation не подменяют эти проверки. Массовый reindex старых документов не выполнялся; см. границы исправления индекса выше.

### Файлы текущего этапа

Минимальные product fixes: `src/lib/blocknote-text.ts`, `src/instrumentation.ts`, `src/components/notebook/mobile-app-header.tsx`, `src/app/studio-mobile.css`, удаление одного скрывающего правила из `src/app/globals.css`.

Regression coverage: `src/lib/blocknote-text.test.ts`, `src/instrumentation.test.ts`, `src/lib/services/page-preview.integration.test.ts`. HTTP infrastructure: `playwright.config.ts`, `e2e/global-setup.ts`, новые `e2e/auth.setup.ts` и `e2e/ui-actions.ts`. Исправленные существующие HTTP specs перечислены в identity manifest; в `e2e/editor-fundamentals.spec.ts` сохранены исходные E-сценарии и добавлены проверяемые readiness/caret preconditions.

Существующая Studio 4.4-E сохранена. Сравнение с исходной hash-инвентаризацией: из 187 исходных пользовательских файлов изменены только намеренно затронутые `globals.css` и `editor-fundamentals.spec.ts`; остальные, включая `.vscode/` и Studio4.5 docs/evidence, не изменены. 37 файлов финального source manifest не менялись во время полного run, package-lock не менялся.

**Commit/push не выполнялись:** ТЗ E.1 требует отдельного разрешения на обновление origin/main. Index пуст, работа остаётся reviewable в `C:/Project/Note`. Deployment, публикации образов и production migrations не выполнялись.

### Диагностический rerun ENOSPC

Без изменения кода/тестов, отключения trace или увеличения timeouts выполнены setup + оба `measured workspace navigation and delayed reads`: **3/3 passed**, retries=0, 2.3 min. Включая Graphite: 41.3s; Atelier: 34.8s. Запись CDP trace и все последующие assertions успешно завершились. [Сводка](editor-http-4-4-e-1/workspace-disk-rerun-summary.json). Это подтверждает environment classification, но **не заменяет полный 93/94 run**.

Для освобождения запаса диска была предложена очистка только ignored `.next` чистого baseline worktree (1.52 GB сгенерированных файлов). Команда отклонена execution policy; обход другим инструментом не выполнялся. Пользовательские данные, прежние test evidence и `.vscode/` не удалялись. Следующий шаг — обеспечить достаточный запас свободного места разрешённым способом и повторить весь 94-test suite. До этого общий release gate остаётся NO-GO.
