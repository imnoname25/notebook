# Диагностика выделения вокруг ссылки

Откройте заметку в Notebook и выделите проблемную строку мышью. Выполните выражение ниже локально в DevTools. Повторите для выделения в обратном направлении и с клавиатуры. Передайте только JSON, возвращённый выражением, и укажите способ выделения, версию Notebook и браузер. Повторите на синтетической заметке, если браузер сбрасывает выделение при переключении в DevTools.

Выражение показывает, находятся ли концы выделения в одном блоке, какие типы узлов пересекает выделение и есть ли мягкие переносы в крайних блоках. Оно не читает содержимое буфера, текст, длину текста, адреса, идентификаторы или атрибуты ссылки. Оно не отправляет запросы и не меняет документ. Порядок узлов ограничен первыми 12 группами.

```js
(() => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    return JSON.stringify({ status: "no-range" })
  }

  const element = node => node instanceof Element ? node : node?.parentElement
  const container = node => element(node)?.closest(".bn-inline-content")
  const anchor = container(selection.anchorNode)
  const focus = container(selection.focusNode)
  const editor = anchor?.closest(".bn-editor")
  if (!editor || !focus || focus.closest(".bn-editor") !== editor) {
    return JSON.stringify({ status: "outside-one-editor" })
  }

  const range = selection.getRangeAt(0)
  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  )
  const groups = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!container(node) || !range.intersectsNode(node)) continue
    const kind = node instanceof HTMLBRElement && !node.classList.contains("ProseMirror-trailingBreak")
      ? "soft-break"
      : node.nodeType === Node.TEXT_NODE ? (element(node)?.closest("a") ? "link-text" : "text") : null
    if (kind && groups.at(-1) !== kind) groups.push(kind)
    if (groups.length > 12) break
  }

  const hasSoftBreak = block => !!block.querySelector("br:not(.ProseMirror-trailingBreak)")
  return JSON.stringify({
    status: "ok",
    sameInlineBlock: anchor === focus,
    backward: !(selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset),
    anchorInLink: !!element(selection.anchorNode)?.closest("a"),
    focusInLink: !!element(selection.focusNode)?.closest("a"),
    anchorBlockHasSoftBreak: hasSoftBreak(anchor),
    focusBlockHasSoftBreak: hasSoftBreak(focus),
    groups: groups.slice(0, 12),
    truncated: groups.length > 12,
  })
})()
```

Для проверки самого буфера используйте синтетическую заметку с безопасными строками и тестовым адресом. Из исходной заметки достаточно результата диагностики выделения.
