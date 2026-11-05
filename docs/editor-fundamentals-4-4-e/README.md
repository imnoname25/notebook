# Studio 4.4-E — evidence

Все документы здесь синтетические. Пользовательский экспорт не публикуется.
`before/` — диагностика на исходной реализации; `after/` — профильный успешный HTTP-прогон.
Снимки не заменяют итог полного regression suite из основного отчёта.

| Проверка, 1920px | До | После |
|---|---:|---:|
| `.bn-editor` / доступный контейнер, обе темы | 832 / 1360px | 1360 / 1360px |
| Split: доступно / левый слот / правый слот / divider | — | 1360 / 677 / 677 / 6px |
| Рамка paragraph с импортированным `transparent` | 3px | 0px |
| Четыре строки plain clipboard с одной пустой | 2 paragraph, hard break | 4 paragraph, пустая строка отдельным блоком |
| Преобразование 5 paragraph через меню первого блока | изменён один блок | изменены все 5, IDs сохранены |

## Скриншоты до/после

- Graphite, старые paragraph: [до](before/editor-fundamentals-studio-6dd7a-d-is-not-a-decorative-brace-chromium/studio-graphite-legacy.png), [после](after/editor-fundamentals-studio-6dd7a-d-is-not-a-decorative-brace-chromium/studio-graphite-legacy.png).
- Atelier, старые paragraph: [до](before/editor-fundamentals-studio-edfac-d-is-not-a-decorative-brace-chromium/studio-atelier-legacy.png), [после](after/editor-fundamentals-studio-edfac-d-is-not-a-decorative-brace-chromium/studio-atelier-legacy.png).
- Graphite, Single: [до](before/editor-fundamentals-studio-fa867--pane-width-for-wide-blocks-chromium/studio-graphite-single.png), [после](after/editor-fundamentals-studio-fa867--pane-width-for-wide-blocks-chromium/studio-graphite-single.png), [Split](after/editor-fundamentals-studio-fa867--pane-width-for-wide-blocks-chromium/studio-graphite-split.png).
- Atelier, Single: [до](before/editor-fundamentals-studio-f6b29--pane-width-for-wide-blocks-chromium/studio-atelier-single.png), [после](after/editor-fundamentals-studio-f6b29--pane-width-for-wide-blocks-chromium/studio-atelier-single.png), [Split](after/editor-fundamentals-studio-f6b29--pane-width-for-wide-blocks-chromium/studio-atelier-split.png).
- Шаблон: [Graphite](after/editor-fundamentals-studio-8c462-independent-transformations-chromium/studio-graphite-template.png), [Atelier](after/editor-fundamentals-studio-bb3e6-independent-transformations-chromium/studio-atelier-template.png).
- Chrome 393px: [Graphite](final-http/studio-mobile-studio-graph-c88df-les-stable-editor-and-focus-chromium/studio-graphite-outer.png), [Atelier](final-http/studio-mobile-studio-ateli-82757-les-stable-editor-and-focus-chromium/studio-atelier-outer.png).
- Chrome 840px: [Graphite](final-http/studio-mobile-studio-graph-c88df-les-stable-editor-and-focus-chromium/studio-graphite-inner.png), [Atelier](final-http/studio-mobile-studio-ateli-82757-les-stable-editor-and-focus-chromium/studio-atelier-inner.png).

Мобильные кадры снимаются с `animations: "disabled"`: Playwright завершает
штатную 180ms screen-in animation перед снимком. Ранний кадр попадал в середину
fade-in; приложение и CSS анимации для этого не изменялись. Два сценария
пересъёмки повторно прошли, но это не заменяет красный полный regression gate.

Рядом с PNG лежат JSON снимки сохранённых документов, результатов преобразования,
вставки и измерений viewport. IDs принадлежат только выделенной тестовой БД.
Результаты синтетического clipboard и viewport emulation не являются проверкой
реального Windows Notepad или физического Fold.
