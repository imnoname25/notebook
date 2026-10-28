# Studio 4.3.1 — Stabilization & Final Acceptance

## Область задачи

База — `fcf319f`. До работы `git status --short` содержал только пользовательскую
`.vscode/`; она не изменяется и не включается в commit. Проверены аудит 4.3,
сохранённый Playwright trace, `useDocumentTabs.restore`, `useWorkspaceTabs.restore`,
`loadTabDocument`, lifecycle очередей и динамическая загрузка `RichTextEditor`.
Документация Next 16 прочитана из установленного пакета.

## Что показал исходный trace

Сбой `document-tabs.spec.ts:46`, Atelier, произошёл после `page.goto('/app')`.
Проверка сразу ожидала поле заголовка с бюджетом 5 секунд. Это объединяло несколько
независимых этапов: JS/hydration, проверку сохранённой сессии, получение выбранной
страницы и загрузку динамического BlockNote.

В сохранённом trace (время относительно начала trace):

| Событие | Время, мс |
| --- | ---: |
| `goto('/app')` завершился | 36628,907 |
| Началась проверка поля заголовка | 36660,709 |
| Запросы проверки трёх вкладок | около 40963 |
| GET выбранного документа | 41185,8; HTTP 200 |
| Запрос chunk с редактором | 41560,9; HTTP 200 |
| Истечение единого бюджета проверки | около 41661 |

Финальный DOM snapshot содержит выбранную **правильную** Third tab, её корректный
`aria-labelledby`/`tabpanel` и loader из `dynamic(..., { ssr: false })`. Документ не
был потерян, другой документ не открылся, API не вернул ошибку. Readiness редактора
не равна событию загрузки HTML и не равна восстановленному списку вкладок.

Зафиксированная причина таймаута — слишком раннее одноэтапное ожидание готового
редактора, захватывавшее клиентский bootstrap. В 4.3 запуск webpack build пересекался
с dev HTTP E2E в одном checkout. Это ухудшает воспроизводимость и конкурирует за
ресурсы/генерируемые файлы Next. Конкретный вклад CPU, диска и сборщика в исходную
задержку по этому trace определить нельзя. Не утверждается наличие исправленной
race condition приложения: доказательств потерянного состояния сессии нет.

## Изменение проверки

`e2e/workspace-ready.ts` проверяет наблюдаемые фазы отдельно:

1. В левой рабочей панели выбрана ожидаемая вкладка и `tabpanel` связан с её ID.
2. Внутри этой панели загружен именно ожидаемый `data-page-id`, BlockNote имеет
   `contenteditable=true`, заголовок правильный и доступен для редактирования.

Проверка ограничена рабочей панелью, а не скрытым дублирующим представлением вкладок
в overview. Она используется после полного `/app`, deep link и восстановления
сессии с удалённой вкладкой. Добавлена проверка отсутствия pageerror.

Значения таймаутов Playwright/expect не увеличены. Суммарное ожидание всей
подготовки может превышать прежние 5 секунд: проверяется несколько последовательных
состояний, каждое со стандартным ограниченным бюджетом. Это осознанное разделение
HTML/session/editor readiness, подтверждённое исходным trace, а не обещание
прежнего общего бюджета для всего bootstrap. Новых `waitForTimeout`, networkidle,
автоматических retries, reload при ошибке и перехваченных успешных API-ответов нет.
Проверка по-прежнему падает, если конкретная фаза не достигнута, и в trace видна
именно неготовая фаза. Runtime, формат сессии, autosave, IndexedDB и индексы ссылок
не менялись. Профиль теста продолжает включать сеть 503 только для намеренной
проверки отказа сохранения.

## Воспроизведение и результаты

До изменения теста исходный Atelier-сценарий запущен **10 последовательных раз**,
один worker, retries=0, без параллельного build: **10/10 passed** (3,4 минуты).
Исторический сбой в этих условиях не повторился. Это результат попытки
воспроизведения, а не доказательство абсолютного отсутствия гонок.

После изменения: **20/20 passed** (6,2 минуты), по **10/10 Graphite и Atelier**.
Один worker, retries=0, без параллельного build. Каждый повтор выполняет полный
сценарий Document Tabs, включая ошибку autosave и повтор, Back/Forward, pinned,
порядок сессии, прямую ссылку, исключение удалённой страницы и responsive viewport.
Все повторения проверяют отсутствие JavaScript pageerror.

Финальная HTTP-приёмка 4.3: **11/11 passed** (3,0 минуты), один worker,
retries=0, без параллельной сборки:

- Document Tabs: Graphite и Atelier.
- History/recovery: обе темы, отдельный настоящий renderer crash и HTTP API сценарий.
- Internal Links/backlinks: обе темы.
- Split View/autosave/перенос/resize/Back: обе темы.
- Authentication security API.

HTTP работает через настоящий Next dev и PostgreSQL. Успешные ответы API не
заменялись тестовыми; 503 используется только для намеренного отказа autosave.
Артефакты текущего HTTP run — `test-results/`, текстовые результаты всех серий —
`node_modules/.cache/history431/{baseline-10,stabilized-20,http-acceptance}.log`.
Исходный неуспешный trace сохранён перед очисткой результатов в
`node_modules/.cache/history431/original-trace.zip`; он содержит только локальную
синтетическую тестовую сессию и не коммитится.

Финальные проверки:

| Проверка | Результат |
| --- | --- |
| `npm run lint` | успешно |
| `npm run typecheck` | успешно |
| `npm test` | 394 passed; 57 skipped в unit-режиме |
| `npm run test:integration` | 56 passed / 15 файлов, настоящая PostgreSQL |
| `npm run build` | успешно, Next 16.3.1 webpack |
| client version contract в `npm run check` | успешно |

Пропуски unit-режима не считаются успешными PostgreSQL-проверками: integration suite
запущен отдельно. Новых миграций, env vars, зависимостей или изменений production
runtime нет. Gitleaks проверяет итоговый staged diff перед commit.
Ограничения физического Fold и объём HTTP-набора указаны ниже.

## Воспроизводимые команды

Только изолированные тестовые PostgreSQL БД. E2E global setup удаляет пользователей
в подтверждённой E2E БД; никогда не использовать production connection string.
Сервер должен работать с той же БД, что и тесты. Здесь использован настоящий
Next dev на loopback:3100, PostgreSQL 18 на task-local порту 55439, установленный Chrome.
Использованы сохранённые task-local параметры PostgreSQL. Ограничения процессов
не обходились; dev HTTP запущен штатной командой и остановлен перед build.

```powershell
$env:E2E_DATABASE_URL = 'postgresql://USER@127.0.0.1:PORT/notebook_history43_e2e'
$env:E2E_RESET_DATABASE = '1'
$env:E2E_BROWSER_CHANNEL = 'chrome'
npx.cmd playwright test e2e/document-tabs.spec.ts --grep studio-atelier --repeat-each 10 --workers 1 --retries 0
npx.cmd playwright test e2e/document-tabs.spec.ts --repeat-each 10 --workers 1 --retries 0
npx.cmd playwright test e2e/document-tabs.spec.ts e2e/history-recovery.spec.ts e2e/internal-links.spec.ts e2e/split-workspace.spec.ts e2e/security.spec.ts --workers 1 --retries 0
$env:TEST_DATABASE_URL = 'postgresql://USER@127.0.0.1:PORT/notebook_history43_native'
$env:TEST_RESET_DATABASE = '1'
npm.cmd run test:integration
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
# Штатно остановить dev HTTP-сервер перед webpack build в том же checkout.
npm.cmd run build
```

Объём HTTP-приёмки — тот же набор 11 сценариев, что использовался в 4.3, плюс
повторения Document Tabs. Это не заявление о запуске всех legacy-specs репозитория.
Unit и PostgreSQL integration suites запускаются целиком. Successful local build
не означает проверку runtime production-сервера или публикацию какого-либо образа.

## Физический Fold и границы приёмки

Viewport Chrome не проверяет Android WebView, IME, реальную клавиатуру, lifecycle
Capacitor, изменение ориентации и складывание устройства. Физический Fold 8 не
подключён и на этом этапе не проверен. APK, Docker, сервер Unraid и production
configuration не менялись; deployment не выполняется.

На физическом устройстве нужно проверить reload/relaunch в обеих темах, порядок
и активную вкладку, ввод после восстановления, resize outer/inner, Split View,
ошибку autosave и последующее восстановление черновика. Это отдельная ручная
приёмка, не подменяемая успешным Chrome run.


## Изменённые файлы

- `e2e/document-tabs.spec.ts` — ожидание фаз после полной навигации и проверка pageerror.
- `e2e/workspace-ready.ts` — общий ограниченный контракт готовности восстановленного документа.
- `docs/STUDIO_STABILIZATION_4_3_1.md` — trace, причина, команды, результаты и границы приёмки.
- `docs/STUDIO_HISTORY_RECOVERY_4_3.md` — ссылка на последующую приёмку; исходные 10/11 сохранены как исторический факт.
