"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "@/lib/client-api";
import { linkTargetsSchema, type LinkTarget } from "@/lib/page-links";
import type { NotebookEditor } from "./editor-schema";

export function PageLinkPicker({ editor, onClose }: { editor: NotebookEditor; onClose(): void }) {
  const [selection] = useState(() => ({ from: editor._tiptapEditor.state.selection.from, to: editor._tiptapEditor.state.selection.to, text: editor.getSelectedText() }));
  const [query, setQuery] = useState("");const [items, setItems] = useState<LinkTarget[]>([]);const [index, setIndex] = useState(0);const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();const timer = setTimeout(() => { void api<unknown>(`/api/pages/mentions?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setItems(linkTargetsSchema.parse(value).pages); }).catch(() => { if (!controller.signal.aborted) setError("Не удалось загрузить страницы"); }); }, 180);
    return () => { clearTimeout(timer);controller.abort(); };
  }, [query]);
  const choose = (page: LinkTarget) => {
    editor._tiptapEditor.commands.setTextSelection({ from: selection.from, to: selection.to });
    editor.insertInlineContent([{ type: "pageLink", props: { pageId: page.id, text: selection.text || page.title, alias: Boolean(selection.text) } }, " "]);onClose();editor.focus();
  };
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Content aria-describedby={undefined} className="notebook-page-picker fixed left-1/2 top-[20%] z-[100] w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md" onCloseAutoFocus={event => { event.preventDefault();editor.focus(); }}>
    <div className="mb-2 flex items-center justify-between"><Dialog.Title className="text-sm font-semibold">Ссылка на страницу</Dialog.Title><Dialog.Close aria-label="Закрыть выбор страницы" className="min-h-11 px-3">×</Dialog.Close></div>
    <input aria-label="Найти страницу для ссылки" className="min-h-11 w-full rounded border bg-background px-3" value={query} onChange={event => { setQuery(event.target.value);setIndex(0);setItems([]);setError(""); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault();setIndex(old => (old + (event.key === "ArrowDown" ? 1 : -1) + Math.max(items.length, 1)) % Math.max(items.length, 1)); }
      if (event.key === "Enter" && items[index]) { event.preventDefault();choose(items[index]); }
    }}/><div className="mt-2 max-h-[45dvh] overflow-y-auto" role="list" aria-label="Найденные страницы">{items.map((page, i) => <button type="button" role="listitem" key={page.id} data-selected={i === index} className="block min-h-11 w-full rounded px-2 py-1 text-left hover:bg-accent data-[selected=true]:bg-accent" onClick={() => choose(page)}><span className="block truncate text-sm">{page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.notebookTitle} / {page.sectionTitle}</span></button>)}{error && <p role="status">{error}</p>}</div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
