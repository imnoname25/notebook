# Studio 4.4-E.2 — Final Regression Gate & Release Readiness

## Состояние

**CONDITIONAL GO для release candidate.** Полный автоматический gate зелёный; физическая и production-приёмка ещё требуется. База `abcac2961a0c7c08403b51be4db82da40a15c37e`, main в C:/Project/Note; существующие E/E.1 сохранены. Полный финальный HTTP gate: 94/94, skipped=0, flaky=0, retries=0. Push, GHCR publication и production deployment запрещены и не выполняются.

## Дисковая диагностика до очистки

ENOSPC полного E.1 возник при записи C:/Project/Note/node_modules/.cache/e1-acceptance-20261105/artifacts/workspace-responsiveness-s-e6a19-avigation-and-delayed-reads-chromium/performance.json. Тот же C: используется для Windows TEMP/TMP: C:/Users/metroom/AppData/Local/Temp. Полный том NTFS: 84,753,248,256 bytes; свободно около 1.78 GB (1.66 GiB) перед E.2. Get-Volume: Healthy. Отдельный фиксированный пул inode к NTFS неприменим; fsutil fsinfo ntfsinfo требует недоступного повышения прав (Access denied), поэтому свободные записи MFT не заявляются измеренными.

| Каталог | Bytes | Назначение |
|---|---:|---|
| C:/Project/Note/.next | 4,256,824,128 | Generated build/dev; cache 2,339,258,448, dev 1,821,423,183 |
| baseline worktree .next | 1,597,919,313 | Generated baseline build/dev |
| test-results | 257,989 | Два старых screenshots + last-run |
| node_modules/.cache | 1,941,054,612 | Тестовые БД, инструменты и сохранённые evidence; не массовая очистка |
| e1-acceptance-20261105 | 98,553,181 | CDP 85,610,528; PNG 12,311,142; ZIP 35,716; video 0 |
| e1-workspace-disk-check | 150,266,078 | CDP 149,932,888; PNG 264,728; video 0 |

Проверены доступные Playwright temporary profiles: шесть директорий по 4.7–9.1 MB и transform cache 4.1 MB. Они не удалялись. Установленный Playwright создаёт browser temporary artifacts через os.tmpdir()/playwright-artifacts- (coreBundle.js), runner хранит временные traces в artifactsDir/traces (workerProcessEntry.js). Итоговые HTTP artifacts направлены runner в отдельный ignored каталог. Videos не включены; trace retain-on-failure и screenshot only-on-failure сохранены.

Очистка двух конкретных generated .next каталогов была согласована пользователем; execution policy повторно запретила команду. Затем пользователь самостоятельно освободил место: перед новым build доступно 12,268,339,200 bytes (11.43 GiB). Наличие .next после этого не доказывает, какие именно файлы удалял пользователь; агент удалений не выполнял. Исходники, .vscode и сохранённые evidence проверены хешами и сохранены.

## План полного gate

Свежая отдельная PostgreSQL test DB; настоящий Next HTTP и Chrome; один worker; retries=0; весь suite, не grep/rerun. Build и dev HTTP выполняются последовательно. Предыдущие E.1 93/94 и diagnostic 3/3 не подменяют новый результат.

## Ручные ограничения

Физический Fold, Android IME и вставка из внешнего Windows Notepad требуют пользовательской проверки. PostgreSQL тестируется локально, production PostgreSQL/Unraid не подключаются. Старые пустые derived search indices массово не перестраиваются: штатный save/restore/import применяет исправленный extractor.

## Проверки до освобождения диска

Повторены lint PASS, typecheck PASS, unit 450 passed / 70 skipped (79 files passed / 18 skipped), exit 0. Логи в ignored node_modules/.cache/e2-{lint,typecheck,unit}.log. После ручного освобождения места production build PASS, отдельная integration DB получила migrations через migrate deploy, PostgreSQL integration PASS 69/69 (18 files), exit 0. Полный HTTP gate запущен на новой отдельной DB, 94 tests, retries=0. Прежние E.1 результаты не засчитываются за E.2.

Финальный полный gate зелёный. Разрешён один локальный commit E/E.1/E.2; push/publication/deployment не выполняются.

## Подтверждённая очистка: блокировка среды

Пользователь явно разрешил удаление обоих указанных generated .next каталогов. Повторная команда с проверкой точных абсолютных путей и отказом для reparse points отклонена execution policy до запуска процесса. Удалений не было; разрешение пользователя не отменило запрет инструмента. Обход другой оболочкой или filesystem API не выполнялся. На этом шаге gate и commit были отложены; далее пользователь освободил место, как зафиксировано ниже. Предыдущая формулировка «подтверждение ожидается» относится к моменту до получения ответа и больше не является текущим блокером.


## Повторный запуск после освобождения места

Native PostgreSQL18.6 слушает только 127.0.0.1:55439. Новые UTF8/ICU databases: notebook_e2_integration_20261105 и notebook_e2_gate_20261105. Первоначальная команда pg_ctl start без -o не переиспользовала предыдущий порт и получила bind error на default settings; повторный запуск с явными -h 127.0.0.1 -p 55439 успешен. Параметры production не читались и не менялись.

Production build завершён до старта dev HTTP. Runner сохраняет итоговый JSON и artifacts в ignored node_modules/.cache/e2-full-20261105, отдельные uploads/backups там же. Для контроля ENOSPC каждые 30 секунд записывается свободное место C: в disk.csv. Ошибки сохраняют trace/screenshot; видео по-прежнему не включено. Настройки assertions, retries, test timeout и состав тестов относительно E.1 не менялись. Приложение и тестовый код E/E.1 остаются неизменными: source manifest проверен перед прогоном.

## Отличие E.2 от E.1: document readiness в touch DnD test

Первая попытка полного E.2 прервана после подтверждённого failure Graphite page-row DnD. Это диагностический неполный запуск, не финальный gate. Trace сохранён локально в e2-full-20261105. После touch reload GET preferences/notebooks заняли около 4s; GET целевой страницы начался после bootstrap. Проверка `.bn-editor` уже отсчитывала свои 5s до завершения bootstrap. Ответы сервера 200, диск имеет >11 GiB; ENOSPC не повторялся. Atelier прошёл.

В e2e/drag-handles.spec.ts добавлен helper readyDocument: ожидание успешного GET конкретного pageId, зарегистрированное до goto/reload, затем прежний assert contenteditable=true. Вызовы применены к touch goto/reload. Не добавлены sleep/retries, не увеличены timeout, не удалены DnD/navigation/selection assertions. Product code относительно E.1 не менялся. Новый финальный полный запуск использует отдельную свежую notebook_e2_gate_final_20261105; результаты первой попытки не суммируются с ним.


## Состав релиза и границы

Включаются E editor fundamentals/adaptive CSS, E.1 extraction/mobile/logout CSS/runtime guard fixes, regression tests, документация и синтетические evidence E/E.1/E.2. [Полный перечень файлов](editor-release-4-4-e-2/release-files.txt). Отдельно исключаются пользовательская .vscode/, Studio4.5 acceptance/runbook/evidence, node_modules/.cache, .next, test-results, локальные uploads/backups и PostgreSQL data. Точные staged paths будут сверены с manifest перед коммитом.

Схема Prisma, migrations, зависимости/package-lock, Docker/CI/Unraid и Android APK не меняются этим релизом. Исходные E/E.1 хеши проверены перед стартом; единственное изменение тестового кода в E.2 — readyDocument в drag-handles spec. Файлы E.2 documentation/evidence добавлены отдельно.

## Рекомендации по безопасному выпуску

1. После зелёного полного gate создать один локальный commit E/E.1/E.2; никаких tags или push без отдельного разрешения.
2. Перед разрешённым push проверить удалённый main, согласовать возможные новые commits без потери пользовательских изменений. CI и GHCR не считаются проверенными, пока не выполнены на конкретном release SHA.
3. Перед production получить пригодный PostgreSQL dump вместе с uploads/appdata и конфигурацией, проверить восстановление изолированно; подтвердить текущий и новый image digest, схему и rollback. Статус этих production данных здесь не проверялся.
4. Обновлять production только по отдельной команде пользователя, pinned digest; применять существующий entrypoint migrate deploy. Отсутствие новых migrations в этом diff не заменяет проверку текущего production baseline.
5. После разрешённого обновления выполнить smoke на синтетической странице: auth, дерево, edit/autosave/reload, поиск, Split, таблицы, history, backlinks, templates. Не восстанавливать backup поверх production ради smoke.

## Ручная приёмка

- Windows: многострочный plain text из настоящего Notepad, пустые строки, вставка в середину, Undo/Redo, autosave, reload.
- Fold: внешний/внутренний экран, IME, выделение/long press, touch table controls, поворот и resize, Single/Split, восстановление после сворачивания.
- Контрольный старый документ: nested paragraphs/transparent props без изменения JSON, сохранение и backup round-trip.
- Подтвердить backup/rollback и итоговые CI/image revision перед production. Не заявлять эти пункты пройденными по Chrome viewport emulation.


## Финальный regression gate — 5 ноября 2026

| Проверка | Результат |
|---|---|
| lint | PASS; повторён после readyDocument |
| typecheck | PASS; повторён после readyDocument |
| production build | PASS; до dev HTTP, product code после build не менялся |
| unit | 450 passed / 70 skipped, 79 files passed / 18 skipped |
| PostgreSQL integration | 69/69, 18 files, 0 skipped, новая PostgreSQL18.6 DB |
| полный HTTP/browser | **94/94 PASS, 0 failed, 0 skipped, 0 flaky, retries=0**, 25.7 min |

Unit database-gated skips явно сохранены в отчёте, не названы успехом: интеграционные файлы отдельно запускались с PostgreSQL. Различающиеся totals разных режимов не складываются в искусственный suite.

[Полный список 94 сценариев](editor-release-4-4-e-2/full-http-summary.json), [машинная сводка gate](editor-release-4-4-e-2/gates.json), [мониторинг диска](editor-release-4-4-e-2/disk.csv), [source identity](editor-release-4-4-e-2/source-identity.json).

Финальный run использовал свежую DB и настоящий Next/Chrome, не mock API. Диагностика ошибок сохранена в конфигурации, assertions/таймауты не ослаблены; CDP performance traces обоих Workspace scenarios записаны, последующие assertions выполнены. Build и dev E2E не выполнялись параллельно. Все 37 source/test files из identity manifest оставались неизменными во время финального run. Сырые локальные артефакты: node_modules/.cache/e2-final-20261105; они не включаются в Git, поскольку могут содержать test session metadata.

Минимум свободного места C: за финальный run: **10,549,997,568 bytes (9.83 GiB)**; старт 13,158,666,240, конец 12,578,459,648, 53 измерений. ENOSPC не повторился. Массовая очистка, Docker prune и удаление пользовательских файлов агентом не выполнялись.

### Решение и оставшиеся риски

**CONDITIONAL GO**: локальный release candidate готов по доступному автоматическому gate. Неизвестных HTTP failures в финальном наборе нет. Первая прерванная E.2 попытка и её readiness correction документированы отдельно, не скрыты и не суммированы с финальным результатом.

Условия перед production: ручные Windows/Fold проверки выше, подтверждённый backup/restore/rollback, CI и image digest на release SHA после отдельно разрешённого push. Физический Fold, PostgreSQL17 и production environment здесь не проверены. Старый пустой derived search index не переиндексируется автоматически массово; индекс обновляется обычным save/restore/import. Release tags и deployment не разрешены этой задачей.


## Review перед коммитом

Gitleaks default отметил ровно три generic-api-key matches в source identity manifests: значения SHA-256 e2e/auth.setup.ts. Все три сравнены с фактическим хешем файла и совпадают. Повторный scan с единственным точным исключением этого подтверждённого source digest (не исключением путей/правил) PASS. В исходниках и тестовых материалах реальных секретов не найдено; broad allowlist или изменений security/CI configuration в репозитории нет. Временный scanner config остаётся ignored. Staged diff проверен; git diff --check и git diff --cached --check PASS. Staged secret scan с единственным проверенным source-digest исключением PASS. Все 225 staged files совпадают с явным release manifest, несвязанных файлов нет.

Проверка сохранности исходного рабочего дерева E.2: изменён только ожидаемый e2e/drag-handles.spec.ts; остальные существовавшие пользовательские файлы, в том числе .vscode/ и Studio4.5 docs/evidence, сохранили исходные хеши. Полный перечень release files приложен; пользовательские и временные файлы исключены.
