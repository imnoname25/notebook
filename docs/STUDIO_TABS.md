# Studio 2.1 — вкладки документов

## Аудит и выбранная архитектура

`NotebookApp` координирует дерево, PageSummary и активный PageDocument; `openPageById`
загружает документ и его расположение, а `getPageHref` сохраняет `/pages/:id` и block hash.
Поиск, recent/favorites, Today и внутренние ссылки сходятся к этому открытию. Browser history
использует History API / popstate, без отдельного URL вкладки. BlockNote монтируется с ключом
page.id/editorEpoch; восстановление версии меняет epoch и проверяет revision на сервере.

Обнаруженные риски: loading/unmount происходил до завершения debounce; старый ответ загрузки
мог стать активным после нового; flush(false) всегда отправлял PATCH, даже без изменений;
unmount cleanup начинал сохранение без возможности удержать редактор при ошибке.

Выбран один активный BlockNote, без скрытых редакторов и без локального хранения контента.
Очередь переходов проверяет актуальность намерения, дожидается autosave и только затем
фиксирует новый документ/вкладки/URL. Пока выполняется переход, текущий редактор виден,
но ввод приостановлен. Ошибка оставляет его и текст доступными; повторный переход повторяет
сохранение. Старый ответ не должен менять новый активный документ.

Модель вкладок и session persistence отделены от бизнес-логики заметок. Персистентная версия
содержит только pageId, preview/permanent, pinned, openedAt, lastActivatedAt и activePageId.
Сохраняются только permanent и отдельно ID последнего активного документа. Если это был
preview, при запуске он снова открывается временным, без сохранения остальных его metadata.
Ключ привязан к user.id, содержимое/названия/секреты не пишутся.
При восстановлении существующие API повторно проверяют доступ; 404 исключается, временные
сетевые ошибки не выдаются за удаление. Явный документ в URL имеет приоритет над сессией.

Ни API, ни Prisma, ни snapshot policy не расширяются. Ни один переход вкладки не создаёт
независимую историю версий. Сохранения по-прежнему идут через существующий page-service
с expectedRevision.

## Реализованная модель

- Одинарный клик списка — preview; второй документ заменяет его только после успешного flush.
- Double click — permanent. Первое открытие и второй click объединяют загрузку одного ID;
  второй click не создаёт копию/второй редактор. Ctrl/Cmd+Click и действие страницы
  «Открыть в новой вкладке» открывают permanent.
- Любая реальная правка title/content немедленно повышает preview до permanent. Для
  определения реальной правки используется исходный нормализованный JSON редактора:
  BlockNote вызывает onChange также при служебной смене editable, без изменения текста.
- Существующий ID активирует свою вкладку; permanent не понижается обратно до preview.
- Pin повышает до permanent и перемещает в первую группу. Внутри каждой группы доступен
  native drag/drop и пункты «Переместить влево/вправо»; новая DnD-библиотека не добавляется.
- Close выбирает соседа справа, затем слева; последняя вкладка оставляет список и пустой editor.
  Массовые close-others/right сохраняют pinned. Обычное закрытие/shortcut не закрывает pin;
  меню имеет отдельное явное «Закрыть закреплённую вкладку».
- Лимит — 100 одновременно открытых вкладок, чтобы ограничить session validation и размер
  локального metadata. Пользователь получает сообщение, если для новой вкладки нет места.

`src/lib/document-tabs.ts` содержит чистую модель и Zod session parser.
`use-document-tabs.ts` координирует загрузку, переходы, заголовки в памяти и persistence.
`document-tabs.tsx` — только представление/ввод. `NotebookApp` подключает этот контроллер к
существующим entry points, не создавая параллельных реализаций поиска, истории или редактора.

## Autosave и переходы

`EditorSaveQueue` существует ровно для одного смонтированного PageDocument. Замыкание send
использует его page.id и serverRevision; поздний ответ обновляет активную страницу только
при совпадении ID. Последовательность PATCH сохраняется; revision меняется после ответа.
`flush(false)` ждёт очередь и сохраняет только dirty payload, включая правку, появившуюся
во время предыдущей записи. Чистый flush не делает запросов и не создаёт snapshots.
Явный Ctrl/Cmd+S сохраняет прежнюю возможность manual snapshot.

В переходе остаётся один видимый редактор, временно read-only. Следующий документ сначала
загружается/проверяется, затем flush подтверждает текущую запись, после чего меняются
active page, вкладки и URL. Если поступило более новое намерение, результат устаревшего
перехода не применяется. Новое намерение может отменить ещё не завершённое закрытие;
пользователь всегда видит фактически оставшиеся открытые вкладки.

При save error редактор не размонтируется, dirty payload остаётся в его памяти, состояние
«Сохранено» не показывается. Доступны «Повторить сохранение», Ctrl/Cmd+S и повторная попытка
перехода. Перед logout/logout-all/сменой Android-сервера запись также подтверждается;
до окончания выхода ввод приостановлен. Error возвращает редактирование текущего документа.
Переключения Notebook/Section/Today/Stickers/Trash и browser root history проходят save guard.

Visibility flush и beforeunload — дополнительные меры, а не основная гарантия. Принудительное
завершение процесса, отказ браузера показать предупреждение или закрытие ОС при offline могут
уничтожить **неподтверждённый** текст в памяти. Без локального хранения содержимого невозможно
обещать его восстановление после аварийного завершения. Подтверждённый текст остаётся на сервере.

## Сессия, URL и разные аккаунты

Ключ `notebook:document-tabs:v1:<encoded-user-id>`, version 1. Сериализатор явно перечисляет
поля; ни title, ни content, ни tokens/session cookies туда не попадают. Metadata другой
учётной записи не читается; сам NotebookWorkspace имеет React key user.id. Другая вкладка
браузера имеет свой живой набор редакторов/свою сессию; localStorage последнего записавшего
окна станет следующей startup-сессией. Автоматическое переключение рабочего документа
между окнами не вводится, чтобы не вмешиваться в текущий ввод. Сохранения двух окон
по-прежнему защищены существующим optimistic revision.

При запуске ID проверяются через существующий authenticated GET /api/pages/:id, до четырёх
параллельных запросов. 404 исключается с уведомлением; network/5xx сохраняет вкладку как
непроверенную, даёт повторить открытие и не выдаётся за удаление. Если активный документ
нельзя загрузить, полоса вкладок остаётся видима над пустым редактором.

Приоритет: явный `/pages/:id` → последняя активная сессия → существующий start-screen.
Явный URL может добавить preview к восстановленным permanent. Startup использует replace,
обычная активация — push, Back/Forward — загрузку без добавления записи. При ошибке
history-перехода текущий URL возвращается к оставшемуся открытому документу через replace.
Если во время validation пользователь уже перешёл в другое место, старые permanent
добавляются в фоне без смены нового активного документа и без дубликатов.

Ссылки между страницами проходят тот же механизм; Ctrl/Cmd+Click повышает их до permanent.
`#block=...` сохраняется и применяется при готовности соответствующего редактора.
404 прямого server-rendered URL по-прежнему остаётся штатной Next.js not-found страницей;
вкладки не обходят server ownership и не подменяют доступ к удалённым документам.

## Desktop, Fold и доступность

Полоса занимает только рабочую область документа, без второго глобального toolbar.
Верхняя шапка показывает блокнот, а не дублирует активное имя документа. Цвета берутся из
существующих semantic tokens; Graphite/Atelier palettes и выравнивание Studio не меняются.
Preview — italic; pin — отдельный индикатор. Список переполняется горизонтальной прокруткой,
активная вкладка прокручивается в видимую область. Close доступен на hover, focus и touch;
меню видно постоянно. ARIA tablist/tab/tabpanel, выбранное состояние и текстовое описание
preview/pin связаны ID. Стрелки/Home/End на полосе активируют вкладку, Delete закрывает
незакреплённую; focus-visible сохраняется.

До 768 px вместо desktop-strip показан один компактный переключатель: активное имя, count,
sheet со списком, pin/close/actions. Мобильный Back закрывает sheet, даже если в нём только
что был закрыт активный документ и смонтирован соседний. От 768 px используется компактная
прокручиваемая полоса; 768–1199 сохраняет две панели, 1200+ — три. Существующий focus скрывает
список. Режим определяется пространством, без device/UA detection. Resize не пересоздаёт
редактор; учитываются coarse pointer, safe areas, visualViewport и reduced motion.

## Горячие клавиши и ограничения браузера

Обработчики принимают Ctrl/Cmd+Tab, Shift+Tab, W, 1…9 **если host передал keydown странице**;
9 — последняя вкладка. Modal/menu не перехватываются, Alt-комбинации не занимают системные
shortcut. В браузере нельзя гарантировать получение зарезервированных tab/window shortcuts.
В частности, [документация Chrome](https://support.google.com/chrome/answer/157179?hl=en)
назначает Ctrl+Tab/W/цифры браузерным вкладкам, а Cmd+Tab на macOS принадлежит ОС.
Не заявляется, что веб-страница может надёжно отменить закрытие вкладки браузера.

Надёжная альтернатива: Tab до полосы → Left/Right/Home/End → Delete, либо меню/кнопки.
Для внешнего экрана — переключатель и его действия. Chrome-проверка различает реальные
Arrow/Delete и искусственно доставленный keydown reserved shortcuts; последний подтверждает
логику Notebook, а не управление браузером/ОС. Отдельный native hotkey bridge не добавлялся.

## Проверки и артефакты

Unit tests покрывают preview/replace/promote, permanent/modifier-open, deduplication, pin
protection, close-neighbour, порядок, session schema/account key, last active preview,
background restoration merge, очередь pending saves, ошибку/retry и stale transitions.
`npm run check`: version/client contract, lint, typecheck, **290 unit tests passed / 36 skipped**
и production build прошли. 36 skips — существующие недоступные DB/environment сценарии.

Реальный headless Chrome с существующим NotebookApp/BlockNote и изолированными API fixtures:
обе темы прошли сценарий трёх документов с правкой, быстрыми переходами, close и reload/app;
проверены двойной клик (один GET), Ctrl/Cmd+Click, no-op PATCH count, save failure/retry,
preview edit promotion, pin/reorder/session, URL priority, Back/Forward, 404, смена аккаунта,
resize с тем же DOM редактора, mobile sheet/Back после close-active, клавиатура полосы,
close-right/others и временная недоступность при startup. Скриншоты (ignored):
`test-results/studio-tabs/*-desktop-1440.png`, `*-desktop-1920.png`, `*-fold-outer.png`
(393×873), `*-fold-inner.png` (840×960), `graphite-fold-switcher.png`; JSON report рядом.
Отдельно прошли восстановление активного preview, обзор блокнота с открытыми вкладками,
пользовательский переход во время startup validation, подавление ошибки устаревшего GET
и Ctrl+Click по внутренней ссылке с block hash. Повторный существующий Chrome-прогон Studio
прошёл create/open/autosave, поиск/favorites/recent, Today/Stickers, templates/tags/trash,
настройки тем, focus, mobile Back, resize, код и имитацию visualViewport клавиатуры.

`e2e/document-tabs.spec.ts` добавляет два DB-backed Playwright сценария, по одному на тему.
Полный запуск с PostgreSQL недоступен без отдельной E2E_DATABASE_URL/E2E_RESET_DATABASE;
production БД не используется. UI fixtures не доказывают серверный CRUD/ownership.
Физический Android/Fold и macOS не проверялись; Chrome emulation не выдаётся за тест APK.
Prisma, API, DB schema, Docker, GitHub workflows и Unraid deployment не изменены.

Изменённые файлы: `src/lib/document-tabs.ts`, `document-tabs.test.ts`, `editor-save-queue.ts`,
`editor-save-queue.test.ts`, `workspace-navigation.ts`, `workspace-navigation.test.ts`;
`src/components/notebook/use-document-tabs.ts`, `document-tabs.tsx`,
`notebook-app.tsx`, `page-list.tsx`, `editor-pane.tsx`, `rich-text-editor.tsx`, `types.ts`;
`src/app/document-tabs.css`, `globals.css`; `e2e/document-tabs.spec.ts`; этот документ.
