# Studio 4.4-A — Data Integrity & Template Portability

28.10.2026. База: `main` / `33a2b08`. Изменены только целостность шаблонов,
серверный create lifecycle, отчёт восстановления и тесты. Prisma, зависимости,
палитры, Docker/CI, Android APK и production не изменены.

## Причины и исправления

**A01 / R0:** `buildPortableExport` преобразовывал Page/Version content через
portable mappings, но возвращал `PageTemplate.content` без преобразования.
`restoreBackupData` создавал новые Page IDs, а шаблоны записывал с raw IDs исходной
БД. Это воспроизведено до исправления реальным HTTP backup/restore в
[audit findings](audit-4-4/template-backup-findings.json). По названию надёжно
восстановить связь нельзя, особенно при одинаковых названиях.

**A03 / R2:** рекурсивный поиск `data:`, `blob:`, `javascript:` и `<script>` во всех
строках смешивал текст с исполняемыми URL. Безопасная инструкция отклонялась,
хотя BlockNote/React показывают её как текст.

**A06 / R6:** POST `/api/pages` копировал JSON шаблона вместе с исходными blockId.
Теперь создание централизовано в `page-service.createPage`; каждый новый документ
получает новую независимую identity tree блоков.

## Portable-контракт v5

- `data-format.ts`: новая версия **5**, читатель ZIP manifest принимает **1–5**.
  Читатель JSON Page сохраняет ранее поддержанные 1/3/4 и принимает 5.
- ZIP содержит `manifest.json` и структурированный `backup.json`. В JSON payload
  шаблоны используют те же независимые `notebook-page://<portablePageKey>`, что Pages.
- Обычные внутренние inline-ссылки `/pages/id` сохраняют query/hash; типизированный
  `pageLink` сохраняет `text`, `alias` и остальные props.
- `template-portability.ts` обрабатывает вложенные блоки, callout и table cells
  рекурсивно. Никакого сопоставления названий и массовой перезаписи документов.
- Restore сначала выделяет новые IDs всех Pages. Тем же mapping внутри одной
  транзакции преобразуются шаблоны. Ключ может разрешиться только в страницу
  импортируемого набора, принадлежащую владельцу восстановления.
- Дублирующиеся portable keys Notebook/Section/Page/Attachment отклоняются до записи:
  неоднозначное сопоставление недопустимо.
- Шаблон не является Page и не попадает в PageLink/FTS/history индексы. Backlinks
  создаются `syncPageLinks` после успешного создания настоящей Page из шаблона.

### Старые копии и недоступные цели

Для v1–v4 raw ID шаблона **не считается portable key**, даже если строки совпали.
Связь становится `missing-…`, сохраняются исходный текст и alias. Автоматический
label недоступной ссылки тоже сохраняет известный текст, а не заменяет его общим
сообщением. Переход блокируется штатным сообщением недоступности.

В v5 отсутствующий ключ или raw ID тоже не разрешаются. `missing-` — служебный
маркер недоступной цели; он исключён из типизированного индекса ссылок и остаётся
стабильным при повторных backup/restore. Чужие метаданные не запрашиваются.
Предупреждение содержит число ссылок и причину, без названий чужих страниц.
Оно возвращается preview/restore API, показывается в существующем сообщении Data
Settings и попадает в уведомление о local/remote restore.

v1 ранее не содержал пользовательские шаблоны: его прежний lifecycle сохранён.
Для v2–v4 шаблоны восстанавливаются, но неоднозначные ссылки недоступны. Полную
переносимость старых raw IDs обещать нельзя. Самостоятельный JSON backup restore
не добавлен: существующий restore принимает ZIP; JSON Page import остаётся доступен.

Отдельный экспорт шаблона имеет версию **2**, импорт читает **1/2**. Такой файл
не содержит Pages, поэтому не может гарантировать перенос целей. Внутренние ссылки
сохраняются как недоступные, с текстом/alias и явным предупреждением при импорте.
Это отличается от полного backup v5, где целевые Pages включены в архив.

## Контекстная валидация

`template-validation.ts` сохраняет исходный JSON без преобразования типов.

- Текст, codeBlock, подписи, форматированные строки и table cells допускают
  литералы схем, HTML и фрагменты JavaScript. HTML остаётся текстом; безопасный
  HTML export экранирует его, реальный BlockNote не исполняет `<script>`.
- Настоящие `link.href`, `image.props.url`, `bookmark.props.url` проверяются как URL.
  `javascript:`, `data:`, `blob:`, control characters и неподдерживаемые схемы запрещены.
  Link допускает HTTP(S), mailto/tel, внутренний абсолютный путь или anchor;
  media/bookmark допускают HTTP(S).
- Приватные `/api/uploads/…`, включая percent-encoded путь и `attachment://…`,
  запрещены в URL-контекстах. Текстовый пример пути сам по себе не является вложением.
  Клонирование приватных файлов шаблонами по-прежнему не поддерживается.
- Live Widget сохраняет строгую проверку существующей config schema; его реальные
  HTTP URL дополнительно проходят запрет private upload references.
- Вложенные блоки, inline и table-cell content валидируются; неизвестные блоки и
  inline-типы получают ошибку, а не преобразуются в paragraph. Ограничения — 64
  уровня структуры и 10 000 блоков. Проверка не мигрирует существующие документы.
- Создание/изменение шаблона с raw ссылкой на чужую страницу возвращает 404.
  Создание Page проверяет владельца секции и шаблона на сервере.
- Уже сохранённый шаблон может пережить окончательное удаление цели: при создании
  Page такие ссылки становятся недоступными без изменения самого шаблона. Поиск
  разрешённых целей ограничен владельцем; совпадение названий не используется.

## Контракт идентификаторов блоков

`document-state.cloneBlocksWithFreshIds` глубоко клонирует root/children и создаёт
новые blockId для каждой новой Page, включая вложенные таблицы/callout/list blocks.
Существующие ID резервируются, новые уникальны в документе. Inline `props.pageId`,
alias, форматирование и содержимое не меняются.

Различаются операции:

| Операция | Identity |
| --- | --- |
| Новая Page из шаблона | Все blockId новые; доступные pageId целей сохраняются |
| Clipboard/block copy | Существующий `normalizeEditorBlocks(..., true)` / freshBlock создаёт новые IDs |
| History replacement | Существующий block-recovery сохраняет identity заменяемого блока; устраняет конфликты вложенных IDs |
| History copy | Существующий cloneBlockWithIds получает набор занятых IDs и избегает дубликатов |
| Полный restore версии/backup | Историческая структура сохраняется; документы не переписываются ради ID |

Прежние документы/шаблоны не мигрируются. Content create теперь проходит через
`page-service`; autosave/revision/snapshot policy не изменены.

## Атомарность и safety backup

`restoreBackupData` записывает дерево, историю, uploads metadata, quick notes,
производные tag/PageLink/widget индексы и пользовательские шаблоны в общей Prisma
транзакции. Шаблоны валидируются до их записи внутри неё. Ошибка после создания
Pages откатывает удаление старых данных и все новые записи. Новые materialized
файлы при отказе удаляются; старые uploads удаляются только после commit.

HTTP `/api/data/restore` и local/remote restore сначала создают safety ZIP. При
ошибке он сохраняется, при успехе удаляется. Запрет на restore без safety backup,
admin authorization, CSRF, confirmation RESTORE и общий operation lock сохранены.
Изменение layout/переход по ссылке не создаёт save/history. Миграций БД нет.

Операция БД атомарна; БД и filesystem не становятся общей распределённой транзакцией.
Это прежнее ограничение: сохранённый safety backup и PostgreSQL dump + persistent
uploads остаются средствами disaster recovery при сбое самого процесса/диска.

## Проверки

Проверки 28.10.2026:

| Проверка | Результат |
| --- | --- |
| version contract / lint / typecheck | Пройдены |
| `npm test` | 414 passed; 67 environment-gated tests skipped в обычном unit режиме |
| `npm run test:integration` | 66/66, 16 suites, настоящая PostgreSQL 18, отдельная тестовая БД |
| HTTP regression 4.1–4.3 + 4.4-A | Финальный повтор: 13/13, 3.8m, Chrome + настоящий Next dev server + PostgreSQL |
| Уточнённые HTTP template scenarios | Повторно 2/2, Graphite и Atelier |
| Production build | Пройден, `next build --webpack`, 57 static pages |

Отдельный PostgreSQL прогон выполняет DB-gated integration suites; пропуски unit
режима не считаются пройденными тестами. Тесты с дополнительными внешними условиями
(например, live network probe) сохраняют собственные gates.
Dev/E2E и production build запускались последовательно в одном checkout.
[Машиночитаемые итоги](data-integrity-4-4-a/checks.json).
В финальном dev-прогоне наблюдались предупреждения Next/Node о slow filesystem,
`NO_COLOR`/`FORCE_COLOR` и `MaxListenersExceededWarning` для dev Socket. Тесты
завершились успешно; лимиты listeners и таймауты не увеличивались. Проверка
production HTTP здесь не выполнялась — HTTP сценарии использовали Next dev.
Ожидаемые HTTP 500 в negative restore tests проверяли rollback/safety backup;
они не выдаются за успешное восстановление.
В первом HTTP fixture администратор назначения требовал смены временного пароля
(ожидаемый 403); fixture явно использует существующий `mustChangePassword: false`.
Авторизация приложения не ослаблялась. Полный unit прогон также выявил изменение
контракта `internalPageIdsInContent`: оно исправлено сохранением прежнего extractor
и переносом фильтрации служебных missing IDs в `syncPageLinks`, без ослабления теста.

Новые regression suites:

- `src/lib/template-integrity.test.ts`: nested/native/typed links, alias, legacy,
  отсутствующие цели, идемпотентность missing IDs, fresh IDs, безопасные литералы,
  escaped HTML и опасные URL/private uploads/unknown blocks/Live Widget config.
- `src/lib/services/template-integrity.integration.test.ts`: настоящая PostgreSQL,
  ZIP v5, v1–v4, разные владельцы, одинаковые названия, nested table/callout links,
  backlinks только от Pages, fresh ID trees, missing targets, duplicate keys,
  окончательное удаление цели и полный rollback.
- `e2e/template-integrity.spec.ts`: настоящий Next HTTP server + PostgreSQL + Chrome,
  отдельный admin-владелец назначения, ZIP export/restore через API, создание Page,
  переход по ссылке, backlinks, renderer escaping, legacy warning/label,
  безопасность API, отказ транзакции и появление нового safety ZIP.

Браузерные screenshots: [Graphite](data-integrity-4-4-a/studio-graphite-restored.png),
[Atelier](data-integrity-4-4-a/studio-atelier-restored.png),
[360 px](data-integrity-4-4-a/studio-atelier-restored-360.png),
[840 px](data-integrity-4-4-a/studio-atelier-restored-840.png).
Это реальные компоненты приложения и синтетические данные. Desktop — 1440 px;
11 regression HTTP сценариев Studio 4.1–4.3 дополнительно проверяют 1920/1440,
две панели, recovery и responsive transitions.

## Ограничения и ручная проверка

Физический Galaxy Z Fold, Android WebView/IME, реальные remote backup провайдеры
и production данные не проверялись. Mobile screenshots — viewport Chrome,
а не приёмка физического устройства. Deployment не выполнялся.

Для ручной проверки: создать A/B и шаблон с alias на B, nested callout и таблицей;
скачать backup, восстановить под отдельным тестовым владельцем, создать Page из
шаблона, открыть B и проверить backlinks. Повторить после переименования/перемещения
B. Для старого архива ожидать предупреждение и сохранённый текст недоступной ссылки.
В production restore ради проверки не запускать; использовать тестовую копию.

R0/R2/R6 завершены в этом этапе. H1, slash groups, template editor UX и табличный
polish из аудита остаются отдельными задачами; визуальный дизайн здесь не менялся.

## Изменённые области и файлы

- Контракты: `src/lib/data-format.ts`, `page-templates.ts`, новые
  `template-validation.ts`, `template-portability.ts`, `document-state.ts`,
  малая idempotence-правка `portable-content.ts`.
- Сервер: `src/lib/services/export-service.ts`, `import-service.ts`,
  `template-service.ts`, `page-service.ts`, `page-link-service.ts`,
  `backup-restore-service.ts`; route handlers `src/app/api/pages/route.ts`,
  `src/app/api/data/restore/route.ts`, `src/app/api/templates/import/route.ts`.
- Existing UI: `data-settings.tsx` и `template-dialogs.tsx` показывают warnings;
  `page-link-inline.tsx` сохраняет label недоступной ссылки. Палитры/CSS не меняются.
- Тесты: `data-format.test.ts`, `page-templates.test.ts`, новый
  `template-integrity.test.ts`, `services/template-integrity.integration.test.ts`,
  `e2e/template-integrity.spec.ts`.
- Документация: этот отчёт, исходный аудит/roadmap 4.4 и их синтетические findings,
  шесть текущих screenshot в `docs/data-integrity-4-4-a/`.
