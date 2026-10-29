# Старые заметки: декоративные направляющие вложенности

Дата: 29.10.2026. База `473c1e3`, BlockNote 0.54.0.

## Подтверждённая причина

На контрольном старом BlockNote JSON воспроизведена серая направляющая слева от
обычного текста. Это не символ `{` в JSON, не устаревший custom block и не новая
версия формата. Исходный тип воспроизведённых строк — **`paragraph`**, вложенных
через `children` в другой `paragraph`. Новый плоский `paragraph` такого элемента
не создаёт. Возраст документа сам по себе не является условием: важна вложенность.

```json
[{"type":"paragraph","content":"Родитель","children":[
  {"type":"paragraph","content":"Первая строка"},
  {"type":"paragraph","content":"Вторая строка"},
  {"type":"paragraph","content":"Третья строка"}
]}]
```

DOM: `.bn-block-group .bn-block-group > .bn-block-outer::before`.

- `@blocknote/core/src/editor/Block.css:90`: `content: " "`, absolute left -20px,
  height 100%, с `:not([data-prev-depth-changed])`.
- `@blocknote/react/src/editor/styles.css:114`: серая левая граница 1px для nested
  blocks, кроме native toggle wrapper.
- `src/app/globals.css`: прежнее правило Notebook подавляло `content`, но имело
  одинаковую специфичность с native content rule `(0,4,1)`. В проверенном браузере
  более поздний стиль библиотеки победил: computed content `" "`, border 1px.
- На соседнем плоском абзаце: computed content `none`, border 0px.

Направляющая обозначает вложенность визуально, но не управляет документом и не
содержит текст. Сама структура функциональна: сохраняются дети, порядок и отступ.
Нельзя устранять этот эффект удалением `children` или преобразованием блоков.

## Git-аудит и исправление

`git log -S` / `git show` показывают, что прежнее подавление направляющих и unit
проверки сохранения legacy nesting добавлены в `a589590` от 16.10.2026. Эта строка
оставалась в текущем main. BlockNote 0.54.0 указан уже в начальном `7444a37`:
доказательств, что дефект вызван недавним обновлением версии библиотеки, нет.

Правило усилено только дополнительным `.bn-editor` scope `(0,5,1)` и `display:none`.
Оно действует на декоративный псевдоэлемент `.bn-block-outer`, включая вложенность
нескольких уровней, и не зависит от порядка lazy CSS. `!important` не требуется.
List markers находятся на **`.bn-block-content::before`**, поэтому остаются.
Настоящая граница `quote > blockquote`, текстовые `{скобки}`, bold, children и ID
не меняются. Это исключительно CSS, преобразование/миграция JSON не нужны.

Не менялись schema, autosave, нормализация, история, backup v5 и импорт.
Существующие документы и архивы используют то же сохранённое содержимое.

## Проверки

- До изменения новый HTTP regression упал в обеих темах именно на computed
  content: ожидалось `none`, получено `" "`. DOM JSON и снимки сохранены.
- После: `e2e/legacy-nesting.spec.ts` — 2/2 passed; каждая тема проверена в Chrome
  на 1440×900 и 360×900. Вложенный/глубоко вложенный paragraph без направляющей;
  плоский paragraph, bullet/numbered markers, quote border и bold сохранены.
- Открытие не отправляет PATCH; ответ API целиком (content/revision и метаданные)
  совпадает с исходным сохранённым состоянием.
- Старый standalone visual-refresh тест первоначально не дошёл до редактора:
  login helper предполагал уже созданного администратора. Helper теперь явно
  делает setup/login через настоящий API, без зависимости от соседних suites.
- Полный `npm run check`: passed — version contract, lint без warnings, typecheck,
  unit 435 passed / 69 skipped, production build. PostgreSQL запущен отдельно.
- Native PostgreSQL: 68/68 passed, 17 файлов. Все существующие 17 migrations
  применены на новой отдельной Unicode test DB; миграции не изменялись.
- Финальный HTTP `visual-refresh` + `legacy-nesting`: **4/4 passed**, включая
  переключение всех тем. Изменённый login-helper отдельно linted; повторный typecheck passed.

[До, Graphite](legacy-nesting/before/studio-graphite-1440.png),
[до, Atelier](legacy-nesting/before/studio-atelier-1440.png).
[После, Graphite](legacy-nesting/after/studio-graphite-1440.png),
[после, Atelier](legacy-nesting/after/studio-atelier-1440.png).
[Mobile Graphite](legacy-nesting/after/studio-graphite-360.png),
[mobile Atelier](legacy-nesting/after/studio-atelier-360.png).
Computed styles JSON находятся рядом. В after добавлена отдельная настоящая цитата
для проверки границы; остальные контрольные строки/вложенность одинаковые.

## Ограничения

Фактический JSON/DOM страницы пользователя «Прокси ТГ» недоступен. Подтверждённый
исходный тип `paragraph` относится к воспроизведённому legacy fixture; приписывать
его пользовательской странице без проверки нельзя. На fixture показаны **серые
линии вложенности**, а не печатные фигурные скобки. Если на «Прокси ТГ» это другой
элемент, нужен обезличенный JSON с type/props/children или DOM этого элемента;
настоящее содержимое, адреса и секреты не нужны. Массовой очистки текста нет.

Chrome viewport не является проверкой физического Fold/WebView. Production не
обновлялся, пользовательская `.vscode/` не затронута.

## Изменённые файлы

- `src/app/globals.css`: одно scoped CSS-правило.
- `e2e/legacy-nesting.spec.ts`: старый/новый JSON и data-preservation regression.
- `e2e/visual-refresh.spec.ts`: самостоятельный setup/login тестов.
- Этот отчёт и `docs/legacy-nesting/`: синтетические снимки и DOM measurements.
