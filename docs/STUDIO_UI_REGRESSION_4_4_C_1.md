# Studio 4.4-C.1 — P0 Workspace Responsiveness

Дата: 29.10.2026. Baseline: `fbefc42`, актуальный `origin/main` перед задачей.
Работа ограничена диагностикой и стабилизацией. Новые функции Studio не добавлялись.

## Подтверждённые причины

1. **Head-of-line blocking чтений.** `DocumentTransitionQueue` проверяла номер намерения,
   но не отменяла начатый GET. Следующая страница ожидала `tail` старого ответа. В обеих
   темах при удержанном HTTP-ответе новый выбор не становился готовым за 1500 мс;
   сам API уже успешно ответил, задерживалась только доставка браузеру.
   Теперь каждое намерение получает отдельный AbortSignal. Сигнал передаётся только
   в GET документа/его расположения; PATCH и `EditorSaveQueue` его не получают.
2. **Потеря последнего выбора во время autosave.** `useWorkspaceTabs.leave` вызывал
   `atomic`, а `atomic` немедленно возвращал false при занятом transaction. Тест из 30
   выборов раздела во время ожидающего PATCH воспроизводимо оставлял первый раздел
   вместо последнего. Добавлена очередь последних намерений для leave: активная запись
   завершается, промежуточные намерения пропускаются, последнее применяется после flush.
   Сам save protocol, revision, snapshot policy и транзакции сервера не менялись.
3. **Лишняя глобальная invalidation.** `recordOpenedPage` после POST `/api/recent`
   увеличивал `workspaceRevision`: повторно загружался список текущего раздела,
   распространялся `PAGE_METADATA_EVENT`, обновлялись links/knowledge. Запись факта
   открытия больше не считается изменением документа. «Недавние» по-прежнему записываются;
   открытие соответствующего поискового экрана делает актуальный серверный запрос.
4. **Повторные GET неизменных настроек.** Каждый mount редактора загружал account
   preferences заново; Strict Mode давал по два запроса. Workspace уже загружал те же
   данные. Редакторы теперь получают валидированные настройки из user-scoped React
   Context, живущего ровно столько, сколько текущий Workspace. Сохранение настроек
   обновляет Context только после успешного ответа. Это не persistent/cross-user cache.
5. **Лишняя работа главного потока.** `sharedEditorOptions(page.content)` делал deep
   normalization на каждом render, хотя BlockNote использует initial options только
   при создании instance. Аналогично аргумент `useRef(canonicalJson(...))` вычислялся
   повторно. Оба начальных значения теперь lazy state. Реальный новый документ/epoch
   по-прежнему создаёт новый редактор. Дерево DnD раньше получало новые callback props
   на каждом workspace commit. Добавлена memo boundary с forwarding к последним
   committed callbacks; stale closures не используются.

## Исчезновение sidebar: предел подтверждения

**Исчезновение уже загруженных блокнотов и полное зависание приложения не воспроизведены.**
Baseline и последующие проверки не зарегистрировали пустого дерева, удаления его DOM
или повторного mount `NotebookWorkspace`. Поэтому причина пользовательского исчезновения
не установлена, а этот симптом не объявляется исправленным.

Найден отдельный подтверждённый дефект пустого состояния: до первого GET исходный `[]`
показывался как «Здесь появятся ваши блокноты», а ошибка списка страниц могла выглядеть
как «В разделе пока нет страниц». Теперь initial loading/error различаются. Повторное
обновление дерева отменяет старое чтение, сохраняет прежнее дерево при ошибке, показывает
ошибку и повтор запроса. Загрузка нового раздела не показывает страницы другого раздела;
refresh того же раздела сохраняет его данные при ошибке. Запоздалый ответ не меняет
актуальный список. Устаревший document load проверяется **до** обновления дерева.

Для закрытия исходного симптома нужны Performance/Network и Console с реального
проблемного запуска, размеры библиотеки и server logs в тот же период. Нельзя делать
вывод о повторной авторизации, медленной SQL или OOM только по исчезновению sidebar.

## Методика и evidence

- Настоящие Chrome + Next dev HTTP + PostgreSQL 18 на loopback. Не mocked API server.
- Отдельная новая БД `notebook_workspace_c1_20261029`; существующие базы не очищались.
  В investigation config нет globalSetup, TRUNCATE, reset или teardown удаления.
  Фикстуры содержат только синтетические страницы; после усиления изоляции каждый
  сценарий создаёт отдельного пользователя. Production, `.vscode/`, uploads пользователя
  и серверная конфигурация не затрагивались.
- 5 разделов, 2 страницы в каждом, по 35 абзацев + таблица и внешняя ссылка.
  По 30 циклов «выбрать раздел → открыть страницу», затем Split View и 30 переключений.
- Браузерный `PerformanceObserver(longtask)`, CDP `Tracing.start`, JS heap sampling.
  React DevTools commit hook собирает реальные commits, `actualDuration`, renders/mounts;
  development Performance trace содержит React component timing events.
  DevTools GUI не использовался. Этот сборщик находится только в E2E, не в приложении.
- Искусственно задерживается **доставка настоящего ответа**, не успешность записи.
  Сценарий 503 явно помечен synthetic. Ни один неуспешный PATCH не выдан за успешный.
- Время включает Playwright click/actionability, browser layout и ожидание состояния,
  это не production microbenchmark. Strict Mode, Dev compiler и tracing повышают overhead.
  Baseline Graphite имел один синтетический блокнот, Atelier — несколько накопленных;
  итоговые измерения изолированы по пользователям. Проценты ускорения не экстраполируются.

[Baseline Network/React measurements, Performance traces и снимки](workspace-c1-evidence/before/).
Файлы `*-performance.json.gz` нужно распаковать и открыть в Chrome Performance.
`*-measurements.json` содержит каждый запрос (без body/cookies) и каждый цикл.
[SQL timings](workspace-c1-evidence/sql-timings.json): representative ownership-scoped
EXPLAIN ANALYZE SELECT на синтетических данных — дерево 0.084 мс, список 0.099 мс,
документ 0.177 мс. Это не полный SQL profile HTTP handler и не замер production.
Схема/индексы/серверные запросы не менялись. HTTP server log также показывает значимый
Next/browser overhead; медленная SQL не подтверждена как единственная причина.

## До/после

[Финальные Network/React measurements, Performance traces и снимки](workspace-c1-evidence/after/).
HTTP E2E завершён: **31/31 passed**, 12.2 минуты, без retries. Из них 4 — новые P0-сценарии,
27 — регрессии из 11 существующих файлов. Полный каталог остальных E2E не запускался.
[Фрагмент реального локального server log](workspace-c1-evidence/server-log-sample.txt).
Baseline, 30 циклов в каждой теме:

| Метрика | Graphite | Atelier |
| --- | ---: | ---: |
| Раздел, median / p95 | 419 / 574 мс | 360 / 735 мс |
| Страница, median / p95 | 493 / 746 мс | 481 / 859 мс |
| Завершённые API requests | 155 | 155 |
| GET настроек в циклах | 60 | 60 |
| GET списков в циклах | 32 | 32 |
| React root commits | 1063 | 1021 |
| React actualDuration sum | 9609 мс | 11033 мс |
| NotebookSidebar renders | 743 | 720 |
| Long tasks, count / sum | 109 / 12622 мс | 112 / 15045 мс |
| JS heap до → после, без forced GC | 59.2 → 84.5 MB | 67.3 → 103.4 MB |

Итоговый прогон с теми же 30 циклами:

| Метрика | Graphite после | Atelier после |
| --- | ---: | ---: |
| Раздел, median / p95 | 267 / 339 мс | 261 / 368 мс |
| Страница, median / p95 | 359 / 449 мс | 396 / 475 мс |
| Завершённые API requests | 92 | 93 |
| GET настроек в циклах | 0 | 0 |
| GET списков в циклах | 30 | 30 |
| React root commits | 921 | 921 |
| React actualDuration sum | 5840 мс | 6338 мс |
| Memoized NotebookSidebarTree renders | 30 | 30 |
| Long tasks, count / sum | 85 / 8088 мс | 83 / 8501 мс |
| JS heap до → после, без forced GC | 50.7 → 53.4 MB | 46.7 → 55.2 MB |
| Новый выбор при удержанном старом GET | 189 мс | 221 мс |

Разница 92/93 вызвана последним отложенным knowledge GET на границе окна измерения.
Завершённые запросы считаются по `requestfinished`; отменённый GET сюда не входит.
Это не утверждение об отсутствии всех long tasks: они остались и видны в evidence.

| Действие | HTTP до | HTTP после | Время / причина |
| --- | --- | --- | --- |
| Выбор раздела | 1 GET списка, плюс incidental invalidation | 1 GET списка | median 419→267 / 360→261 мс; flush/React + HTTP, без GET дерева |
| Открытие страницы | GET документа + 2 GET preferences + отложенный knowledge; иногда recent/invalidation | GET документа + отложенный knowledge; recent остаётся | median 493→359 / 481→396 мс; удалены повторные настройки и invalidation |
| Новый выбор при задержанном GET | ждёт предыдущую доставку | старый GET abort, новый выбор готов | >1500→189 / >1500→221 мс; write не отменяется |
| Split: открыть второй документ | GET документа + 2 GET preferences + knowledge | GET документа + knowledge | внутри общего HTTP прогона, отдельный latency percentile не собирался |
| Split: 30 активаций уже открытых документов | без обязательной загрузки документа | 0 GET документов, 0 editor remount | проверено явными assertions; pane focus обновляет URL без сброса соседа |

Один mount редактора на реально открытый новый документ (30) ожидаем; держать 10
постоянно работающих BlockNote ради ускорения не стали. Heap без forced GC не доказывает
утечку памяти. Порог 1500 мс в regression — ограниченное окно до разблокировки специально
удержанного ответа, а не увеличение timeout приложения или UX-задержка.

## Регрессионные проверки

`e2e/workspace-responsiveness.spec.ts`:

- 30 последовательных циклов, обе темы; число HTTP, commits, long tasks, heap.
- Новый выбор не ждёт старый задержанный GET; старый ответ не переоткрывает документ.
- Списки разделов доставляются в обратном порядке.
- Ошибка GET даёт явное состояние и успешный повтор, без ложного пустого списка.
- Initial loading дерева не выдаётся за пустой Notebook.
- 30 быстрых выборов раздела во время задержанного autosave; последний выбор побеждает,
  сохранённый сервером текст проверяется повторным открытием.
- 30 переключений между уже открытыми документами Split View без повторного mount/GET.
- Размеры 360/840/1920, без потери текста и горизонтального overflow.

Unit coverage очереди: отменяется устаревшее чтение; cancel/unmount не прерывает запись;
новое намерение ждёт уже начатый write и не фиксирует старое состояние.
Дополнительно запускаются доступные HTTP regressions autosave, IndexedDB recovery,
history, backlinks, tables, templates/dirty-close, DnD и Split View.

## Повторение без очистки БД

Создать **новую отдельную** локальную PostgreSQL БД с именем `notebook_workspace_*`,
задать `DATABASE_URL` на неё и выполнить `npx prisma migrate deploy`. Для тестов задать
`E2E_DATABASE_URL` на эту же БД, `E2E_BROWSER_CHANNEL=chrome` и выполнить:

```text
npx playwright test --config playwright.workspace.config.ts
```

Config разрешает только loopback server/database и специальный префикс имени БД.
`E2E_RESET_DATABASE` не нужен. Прежний стандартный globalSetup с TRUNCATE не используется.
Проверки оставляют синтетические записи; существующие пользовательские данные не удаляются.
Для production нельзя запускать этот сценарий. Пользовательские HAR/trace могут содержать
текст документов и cookie; не публиковать их без очистки.

## Изменённые файлы

- `src/lib/editor-save-queue.ts`, `.test.ts`: cancellation только reads, тесты порядка writes.
- `use-document-tabs.ts`, `use-workspace-tabs.ts`: signal propagation, latest leave intent.
- `notebook-app.tsx`: invalidation, загрузка дерева/списка, shared preferences.
- `notebook-sidebar.tsx`: memo boundary и состояния loading/error/retry.
- `page-list.tsx`: error/retry вместо ложного empty.
- `rich-text-editor.tsx`, `editor-preferences.ts`, `settings-dialog.tsx`: начальные значения,
  Workspace Context и подтверждённое обновление настроек.
- `e2e/workspace-responsiveness.spec.ts`, `playwright.workspace.config.ts`: измерения и regressions.
- Этот документ и `docs/workspace-c1-evidence/`: воспроизводимые synthetic evidence.

## Ограничения

Полное зависание и временное исчезновение **загруженного** дерева остаются неподтверждёнными.
Нет теста на физическом Fold/Android IME. Viewport Chrome не считается физическим устройством.
Production performance/build-server latency нужно измерить отдельно. Не выполнялись
production deployment, обновление APK, зависимости, миграции или изменения API/save protocol.
`npm run check` завершён с exit 0 после остановки dev:

| Проверка | Результат |
| --- | --- |
| version contract | passed, без сборки/изменения APK |
| lint | passed |
| typecheck | passed |
| unit tests | 435 passed, 69 opt-in integration tests skipped |
| webpack production build | passed |
| HTTP E2E, настоящая PostgreSQL | 31/31 passed, 12.2 минуты |
| investigation config discovery | 4 P0-теста, без globalSetup/reset |

 Native PostgreSQL
integration suite в этой задаче отдельно не запускался: его fixtures используют очистку БД.
PostgreSQL/save/revision/backlinks проверены настоящими HTTP E2E на новой изолированной БД.
Baseline и промежуточные тестовые ошибки сохранены в описании: rejected latest intent
воспроизводился в обеих темах; ошибки test harness (unroute до завершения deferred handler,
неоднозначный DnD live region selector) устранены без изменения приложения или таймаутов.
