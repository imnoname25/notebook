# Search 3.2 — быстрый поиск в рабочем контексте

## Диагностика до исправлений

Сравнивались `57a18b6` (до Search 3.1) и состояние после `a62ab6d` на отдельной настоящей PostgreSQL 18. Контрольная заметка: заголовок `ЗаголовокИскра7310`, содержимое `ТелоКварц8291 заметка о резервировании PostgreSQL`. Пользовательские данные и production не использовались.

Подтверждено:

- Точные слова из заголовка и содержимого находились в обеих версиях. Пустые серверные фильтры сами по себе выдачу не ограничивали.
- Search 3.1 повторно использовал состояние расширенного поиска при глобальном открытии. После «Избранного» сохранялся `group=favorites`, даже если пользователь начинал глобальный поиск из редактора. В Chrome воспроизведён ноль результатов для существующей подходящей, но не избранной заметки. Аналогично могли сохраняться другие выбранные фильтры. Это подтверждённая регрессия UI.
- Обычный `websearch_to_tsquery('simple', ...)` искал целые лексемы. Частичные слова `телокварц`, `резерв`, `postgr` из содержимого не находились ни до, ни после Search 3.1. Title fallback не исправлял поиск по содержимому. Это существовавшее ограничение, особенно заметное при живом вводе.
- На тестовой БД с libc locale `C` кириллица не приводилась к нижнему регистру как на Unicode locale. Отдельная БД с builtin `C.UTF-8` подтвердила различие. Locale production неизвестна: этот результат не доказывает проблему конфигурации сервера пользователя.

Нет оснований утверждать, что production требует миграции, переиндексации или восстановления данных. Доступа к его PostgreSQL не было. Команды диагностики ниже позволяют проверить конфигурацию без изменения данных.

## Реализация

В шапке находится реальное поле ввода высотой 30 px, шириной 190–280 px в Studio. Atelier использует существующую нейтральную рабочую поверхность; палитры не менялись. Поле не участвует в расчёте регулируемых панелей.

Клик или Ctrl/Cmd+K открывает панель поверх интерфейса без затемнения, изменения URL, размонтирования редактора и предварительного flush autosave. При пустом запросе показываются недавние документы. До восьми результатов отображаются с путём и безопасной текстовой подсветкой; стрелки/Enter выбирают документ, Escape и клик снаружи закрывают панель. Ошибка сервера отличается от пустой выдачи; доступен повтор.

Быстрый поиск имеет собственный запрос и всегда пустые фильтры. «Все результаты» / «Расширенный поиск» явно открывает прежний Search View, передавая запрос без старых фильтров. Контекстные «Избранное», «Недавние» и поиск по тегу сохраняют свои явные фильтры. Расширенный экран сохраняет URL, Back/Forward, серверные фильтры и пагинацию. Ctrl/Cmd+Shift+P открывает командную палитру.

Оба интерфейса используют один `useLiveSearch` и `/api/search`: debounce 200 ms, AbortController, проверка поколения запроса и ключа параметров, ограниченная пагинация с исключением дублей. Устаревший ответ или ошибка не заменяют текущую выдачу. Бизнес-логика поиска остаётся в `search-service`.

Для простых слов сервер добавляет параметризованный prefix tsquery к существующему FTS. Все слова должны присутствовать как префиксы лексем. Кавычки, операторы, пунктуация и hashtag сохраняют прежнюю websearch/tag-семантику. Используются существующие generated vectors и GIN; schema и API не меняются. Подстрока внутри слова в содержимом не поддерживается; конфигурация `simple` не добавляет русский стемминг. Лимит расширенной выдачи остаётся прежним: до 275 результатов, затем нужно уточнить запрос.

Открытие страницы проходит через существующие вкладки и защиту autosave. При ошибке сохранения текущий документ остаётся открытым, поиск показывает ошибку перехода; статус «Сохранено» не выставляется до ответа сервера. Содержимое заметок не попадает в состояние поисковой сессии.

Ниже Studio breakpoint 1200 px поиск становится отдельным компактным слоем с собственным полем ввода и закрытием. Редактор остаётся под ним. Учитываются safe-area и изменение viewport; desktop-размеры панелей не применяются к поисковому слою. Режим фокусировки поддерживает поле внутри панели, когда общая шапка скрыта.

## Проверки и доказательства

- `npm run check`: version check, lint, typecheck, unit tests и production build.
- `search-live.integration.test.ts`: 11 проверок на настоящей отдельной PostgreSQL 18, включая запись через `page-service`, derived index, заголовок/содержимое/кириллицу/префиксы, пустые фильтры, ownership, теги, дату, пагинацию и параметризованные значения.
- Chrome с настоящими компонентами Notebook: обе темы, результаты из той же PostgreSQL, отсутствие скрытых фильтров, задержанный устаревший ответ, HTTP 503/повтор, сохранение DOM редактора и ширины панелей, «Сегодня»/«Стикеры», отказ autosave и повтор с проверкой записи в БД, Enter, расширенная выдача 25+6, Back/Forward, командная палитра, 1280/1440/1920 и 393/840 px, уменьшение высоты viewport.
- Обновлены существующие Playwright-сценарии и добавлен `e2e/quick-search.spec.ts` с реальной API-подготовкой контрольной заметки. Полный запуск этих HTTP E2E не выполнен: автоматическая проверка инструментов отклонила запуск локального Next.js-сервера с тестовыми настройками (`blocked by policy`, без дополнительной причины). Chrome-проверка использовала перехват запросов с адаптером настоящих сервисов/Prisma, а не работающий Next.js HTTP/auth boundary. Это не доказательство прохождения полного HTTP E2E.
- Скриншоты и JSON-отчёты: локальный каталог `test-results/search-3-2/`, `index.html`. Данные синтетические, снимки до/после сделаны с одинаковым содержимым. Артефакты не включены в Git.

Физический Fold, Android WebView/клавиатура и production-поиск требуют проверки пользователем. Уменьшение viewport в Chrome не эквивалентно экранной клавиатуре Android. Production deploy, APK, Docker, CI и Unraid не изменялись.

## Изменённые файлы

- `src/components/notebook/quick-search.tsx` — выпадающая панель и мобильный слой.
- `src/components/notebook/use-live-search.ts` — общий жизненный цикл запросов.
- `src/components/notebook/search-result-content.tsx` — общее отображение совпадений.
- `src/components/notebook/search-view.tsx` — подключение общего механизма.
- `src/components/notebook/notebook-app.tsx` — навигация, горячие клавиши, открытие результата и mobile Back.
- `src/components/notebook/desktop-app-header.tsx`, `src/app/search.css` — компактная строка и геометрия панели.
- `src/lib/search-query.ts`, `src/lib/services/search-service.ts` — безопасный prefix FTS.
- `src/lib/search-query.test.ts`, `src/lib/services/search-live.integration.test.ts` — unit и PostgreSQL regression.
- `e2e/quick-search.spec.ts`, `e2e/unified-search.spec.ts`, `e2e/notebook.spec.ts`, `e2e/stage4.spec.ts` — новые и обновлённые HTTP E2E-сценарии.
- `README.md`, `docs/STUDIO_SEARCH_3_2.md` — поведение, диагностика и ограничения.

## Воспроизводимые команды

Только для отдельной локальной тестовой БД с уже применёнными миграциями, никогда не production:

```powershell
$env:TEST_DATABASE_URL = '<URL отдельной тестовой PostgreSQL с Unicode locale>'
$env:TEST_RESET_DATABASE = '1'
npx vitest run src/lib/services/search-live.integration.test.ts
```

Для полного HTTP E2E в разрешённой среде: отдельная БД, `E2E_DATABASE_URL` и `E2E_RESET_DATABASE=1`, затем `npx playwright test e2e/quick-search.spec.ts e2e/unified-search.spec.ts`. E2E global setup очищает тестовую БД.

## Production: read-only диагностика

Выполнить в psql, подключённом к существующей БД обычным доверенным способом. Не копировать connection string, cookies, токены или содержимое документов в отчёт.

```sql
BEGIN READ ONLY;
SELECT version();
SELECT datcollate, datctype, datlocprovider
FROM pg_database WHERE datname = current_database();
SELECT lower('ПРИВЕТ') AS lowercase_cyrillic,
       to_tsvector('simple', 'КонтрольноеСлово') AS vector,
       websearch_to_tsquery('simple', 'контрольное') AS exact_query,
       to_tsquery('simple', 'контрольное:*') AS prefix_query;
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 8;
SELECT tablename, indexdef FROM pg_indexes
WHERE tablename IN ('Page', 'Section', 'Notebook');
SELECT c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) AS expression
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relname IN ('Page', 'Section', 'Notebook')
  AND a.attname = 'searchVector';
SELECT count(*) AS active_pages,
       count(*) FILTER (WHERE "searchText" = '') AS empty_search_text,
       count(*) FILTER (WHERE "searchVector" IS NULL) AS null_vectors
FROM "Page" WHERE "deletedAt" IS NULL;
ROLLBACK;
```

Пустой `searchText` может соответствовать действительно пустой заметке; одно число не доказывает повреждение индекса. Для `Page` ожидается generated expression с title/searchText и GIN по searchVector, для Section/Notebook — по title.

В DevTools своего авторизованного приложения проверить Network для уникального слова из заголовка и другого слова из содержимого контрольной заметки: статус `/api/search`, точный `q`, отсутствие notebookId/sectionId/tag/date/group в быстром поиске, число результатов. Текст результатов, HAR и заголовки авторизации никуда не отправлять. При сбое достаточно статуса, количества результатов и обезличенных параметров.

Если `lower('ПРИВЕТ')` не возвращает `привет`, сначала подтвердить locale и обе стороны FTS на копии БД. `REINDEX` сам по себе не исправляет сохранённые лексемы generated vectors. Смена locale/пересоздание БД, backfill или применение отсутствующих миграций требуют отдельного плана с backup и проверки на копии; автоматически эти действия не выполняются.
