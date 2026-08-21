"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { CommandIcon, FileText, Folder, Hash, Loader2, Search, StickyNote, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { t } from "@/lib/i18n/messages";
import type { HighlightPart, SearchResult } from "@/lib/services/search-service";
import { rankQuickSwitcherResults } from "@/lib/quick-switcher";
import { cn } from "@/lib/utils";
import { commandQuery, filterCommands, type PaletteCommand } from "@/lib/command-palette";
import { isNotebookColor, isNotebookIcon, NOTEBOOK_COLOR_CLASSES, NOTEBOOK_ICON_COMPONENTS } from "@/lib/notebook-appearance";

type QuickData = { recent: SearchResult[]; favorites: SearchResult[]; notebooks: SearchResult[]; sections: SearchResult[] };
const EMPTY_QUICK: QuickData = { recent: [], favorites: [], notebooks: [], sections: [] };

export function SearchDialog({ open, initialQuery = "", commands = [], onOpenChange, onSelect }: { open: boolean; initialQuery?: string; commands?: PaletteCommand[]; onOpenChange(open: boolean): void; onSelect(result: SearchResult): void }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [quick, setQuick] = useState<QuickData>(EMPTY_QUICK);
  const [loading, setLoading] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<QuickData>("/api/navigation/quick", { signal: controller.signal }).then(setQuick).catch(() => undefined);
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    if (!open || commandQuery(query) !== null || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void api<{ results: SearchResult[]; nextOffset: number | null }>(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => { setResults(response.results); setNextOffset(response.nextOffset); })
        .catch((error: Error) => { if (error.name !== "AbortError") setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);
  const ranked = useMemo(() => rankQuickSwitcherResults(results, query, new Set(quick.recent.map((item) => item.id)), new Set(quick.favorites.map((item) => item.id))), [query, quick, results]);
  const commandMode = commandQuery(query);
  const matchedCommands = commandMode === null ? [] : filterCommands(commands, commandMode);
  const recentIds = new Set(quick.recent.map((item) => item.id));
  const groups = commandMode !== null ? [] : query.trim().length >= 2 ? [{ label: t("quick.results"), items: ranked }] : [
    { label: t("overview.recent"), items: quick.recent },
    { label: t("overview.favorites"), items: quick.favorites.filter((item) => !recentIds.has(item.id)) },
    { label: t("quick.notebooks"), items: quick.notebooks },
    { label: t("overview.sections"), items: quick.sections },
  ].filter((group) => group.items.length);
  function changeQuery(value: string) { setQuery(value); if (value.trim().length < 2) { setResults([]); setNextOffset(null); setLoading(false); } }
  async function loadMore() { if (nextOffset === null) return; setLoading(true); try { const response = await api<{ results: SearchResult[]; nextOffset: number | null }>(`/api/search?q=${encodeURIComponent(query)}&offset=${nextOffset}`); setResults((current) => [...current, ...response.results]); setNextOffset(response.nextOffset); } finally { setLoading(false); } }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content className="fixed left-1/2 top-[8dvh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-border sm:top-[12vh]" aria-describedby={undefined}><Dialog.Title className="sr-only">{t("quick.title")}</Dialog.Title><Command shouldFilter={false} loop className="bg-transparent" label={t("quick.title")}>
    <div className="flex items-center gap-3 border-b border-border px-3 sm:px-4"><Search size={19} className="text-muted-foreground"/><Command.Input autoFocus value={query} onValueChange={changeQuery} placeholder={t("quick.searchPlaceholder")} className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"/>{loading && <Loader2 size={16} className="animate-spin text-muted-foreground"/>}<Dialog.Close className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label={t("common.close")}><X size={18}/></Dialog.Close></div>
    <Command.List className="max-h-[65dvh] overflow-y-auto p-2">{commandMode !== null && <div><p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("commands.title")}</p>{matchedCommands.map((item) => <Command.Item key={item.id} value={`command:${item.id}`} disabled={item.disabled} onSelect={() => { onOpenChange(false); item.run(); }} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm outline-none data-[disabled=true]:opacity-40 data-[selected=true]:bg-accent"><span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary"><CommandIcon size={16}/></span><span className="font-medium">{item.title}</span></Command.Item>)}</div>}{commandMode !== null && matchedCommands.length === 0 && <Command.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">{t("commands.empty")}</Command.Empty>}{commandMode === null && groups.length === 0 && !loading && <Command.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">{query.trim().length >= 2 ? t("search.empty") : t("overview.noRecent")}</Command.Empty>}{groups.map((group) => <div key={group.label}><p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>{group.items.map((result) => <Result key={`${group.label}:${result.type}:${result.id}`} result={result} onSelect={onSelect}/>)}</div>)}{commandMode === null && nextOffset !== null && query.trim().length >= 2 && <div className="p-2 text-center"><button className="rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => void loadMore()} disabled={loading}>{t("quick.showMore")}</button></div>}</Command.List>
    <div className="hidden justify-end gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex"><span>↑↓ {t("quick.select")}</span><span>Enter {t("quick.open")}</span><span>Esc {t("quick.close")}</span></div>
  </Command></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function Result({ result, onSelect }: { result: SearchResult; onSelect(result: SearchResult): void }) {
  const NotebookIcon = NOTEBOOK_ICON_COMPONENTS[isNotebookIcon(result.notebookIcon) ? result.notebookIcon : "notebook"];
  const icon = result.type === "page" ? <FileText size={16}/> : result.type === "section" ? <Folder size={16}/> : result.type === "tag" ? <Hash size={16}/> : result.type === "quickNote" ? <StickyNote size={16}/> : <NotebookIcon size={16}/>;
  const meta = result.type === "notebook" ? t("quick.notebook") : result.type === "section" ? `${t("quick.section")} · ${result.notebookTitle}` : result.type === "tag" ? t("tags.title") : result.type === "quickNote" ? t("quickNotes.inbox") : `${result.notebookTitle} · ${result.sectionTitle}`;
  return <Command.Item value={`${result.type}:${result.id}`} onSelect={() => onSelect(result)} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-[selected=true]:bg-accent"><span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", result.type === "notebook" ? `text-white ${NOTEBOOK_COLOR_CLASSES[isNotebookColor(result.notebookColor) ? result.notebookColor : "slate"]}` : "bg-muted text-muted-foreground")}>{icon}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium"><Highlighted parts={result.titleParts}/></span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>{result.snippetParts && <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground"><Highlighted parts={result.snippetParts}/></span>}</span></Command.Item>;
}
function Highlighted({ parts }: { parts: HighlightPart[] }) { return <>{parts.map((part, index) => part.highlight ? <mark key={index} className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-700/60">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>; }
