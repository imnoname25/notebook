"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { FileText, Folder, Loader2, Search, X } from "lucide-react";
import { api } from "@/lib/client-api";
import type { HighlightPart, SearchResult } from "@/lib/services/search-service";
import { cn } from "@/lib/utils";
import { isNotebookColor, isNotebookIcon, NOTEBOOK_COLOR_CLASSES, NOTEBOOK_ICON_COMPONENTS } from "@/lib/notebook-appearance";

export function SearchDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange(open: boolean): void; onSelect(result: SearchResult): void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<{ results: SearchResult[]; nextOffset: number | null }>(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => { setResults(response.results); setNextOffset(response.nextOffset); })
        .catch((error: Error) => { if (error.name !== "AbortError") setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  function changeQuery(value: string) {
    setQuery(value);
    if (value.trim().length < 2) { setResults([]); setNextOffset(null); setLoading(false); }
  }

  async function loadMore() {
    if (nextOffset === null) return;
    setLoading(true);
    try { const response = await api<{ results: SearchResult[]; nextOffset: number | null }>(`/api/search?q=${encodeURIComponent(query)}&offset=${nextOffset}`); setResults((current) => [...current, ...response.results]); setNextOffset(response.nextOffset); }
    finally { setLoading(false); }
  }

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
      <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl bg-popover shadow-2xl ring-1 ring-border" aria-describedby={undefined}>
        <Dialog.Title className="sr-only">Глобальный поиск</Dialog.Title>
        <Command shouldFilter={false} loop className="bg-transparent" label="Глобальный поиск">
          <div className="flex items-center gap-3 border-b border-border px-4"><Search size={18} className="text-muted-foreground"/><Command.Input autoFocus value={query} onValueChange={changeQuery} placeholder="Поиск по заметкам…" className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />{loading && <Loader2 size={16} className="animate-spin text-muted-foreground"/>}<Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Закрыть поиск"><X size={17}/></Dialog.Close></div>
          <Command.List className="max-h-[55vh] overflow-y-auto p-2">
            {query.trim().length < 2 && <div className="px-3 py-10 text-center text-sm text-muted-foreground">Введите минимум два символа</div>}
            {!loading && query.trim().length >= 2 && results.length === 0 && <Command.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">Ничего не найдено</Command.Empty>}
            {results.map((result, index) => { const NotebookResultIcon = NOTEBOOK_ICON_COMPONENTS[isNotebookIcon(result.notebookIcon) ? result.notebookIcon : "notebook"]; const previous = results[index - 1]; const groupChanged = !previous || previous.type !== result.type; return <div key={`${result.type}:${result.id}`}>{groupChanged && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{result.type === "page" ? "Страницы" : result.type === "section" ? "Разделы" : "Блокноты"}</p>}<Command.Item value={`${result.type}:${result.id}`} onSelect={() => onSelect(result)} className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 text-sm outline-none data-[selected=true]:bg-accent">
              <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", result.type === "notebook" ? `text-white ${NOTEBOOK_COLOR_CLASSES[isNotebookColor(result.notebookColor) ? result.notebookColor : "slate"]}` : "bg-muted text-muted-foreground")}>{result.type === "page" ? <FileText size={16}/> : result.type === "section" ? <Folder size={16}/> : <NotebookResultIcon size={16}/>}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium"><Highlighted parts={result.titleParts}/></span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{result.type === "notebook" ? "Блокнот" : result.type === "section" ? `Раздел · ${result.notebookTitle}` : `${result.notebookTitle} · ${result.sectionTitle}`}</span>{result.snippetParts && <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground"><Highlighted parts={result.snippetParts}/></span>}</span>
            </Command.Item></div>; })}
            {nextOffset !== null && <div className="p-2 text-center"><button className="rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => void loadMore()} disabled={loading}>Показать ещё</button></div>}
          </Command.List>
          <div className="flex justify-end gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground"><span>↑↓ выбрать</span><span>Enter открыть</span><span>Esc закрыть</span></div>
        </Command>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function Highlighted({ parts }: { parts: HighlightPart[] }) { return <>{parts.map((part, index) => part.highlight ? <mark key={index} className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-700/60">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>; }
