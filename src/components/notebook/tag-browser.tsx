"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, FileText, Hash, Loader2, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { t } from "@/lib/i18n/messages";

type TagSummary = { name: string; normalized: string; count: number };
type TagView = {
  name: string; normalized: string;
  pages: { id: string; title: string; icon: string | null; updatedAt: string; section: { id: string; title: string; notebook: { id: string; title: string } } }[];
  quickNotes: { id: string; title: string; body: string; color: string; icon: string | null; status: string; updatedAt: string }[];
};

export function TagBrowser({ open, initialTag = null, onOpenChange, onPage, onInbox, onError }: {
  open: boolean; initialTag?: string | null; onOpenChange(open: boolean): void; onPage(id: string): void; onInbox(): void; onError(error: unknown): void;
}) {
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(initialTag);
  const [view, setView] = useState<TagView | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const url = selected ? `/api/tags?tag=${encodeURIComponent(selected)}` : "/api/tags";
    void api<{ tags?: TagSummary[]; tag?: TagView | null }>(url, { signal: controller.signal })
      .then((result) => { if (selected) setView(result.tag ?? null); else setTags(result.tags ?? []); setLoadedKey(selected ?? "index"); })
      .catch((error: Error) => { if (error.name !== "AbortError") onError(error); });
    return () => controller.abort();
  }, [onError, open, selected]);
  const loaded = loadedKey === (selected ?? "index");
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content aria-describedby={undefined} className="notebook-mobile-sheet fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto rounded-t-2xl bg-card p-4 shadow-2xl ring-1 ring-border sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
    <header className="mb-4 flex items-center gap-3">{selected ? <button className="flex size-11 items-center justify-center rounded-lg hover:bg-accent" onClick={() => { setSelected(null); setView(null); }} aria-label={t("common.back")}><ArrowLeft size={19}/></button> : <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Hash size={20}/></span>}<div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">{view ? `#${view.name}` : t("tags.title")}</Dialog.Title><p className="text-sm text-muted-foreground">{view ? `${view.pages.length + view.quickNotes.length} ${t("tags.matches")}` : t("tags.hint")}</p></div><Dialog.Close className="flex size-11 items-center justify-center rounded-lg hover:bg-accent" aria-label={t("common.close")}><X size={18}/></Dialog.Close></header>
    {!loaded ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground"/></div> : selected ? <TagResults view={view} onPage={onPage} onInbox={onInbox}/> : tags.length ? <div className="flex flex-wrap gap-2">{tags.map((tag) => <button key={tag.normalized} className="notebook-tag-chip min-h-10 gap-2 px-3 text-sm" onClick={() => setSelected(tag.normalized)}><span>#{tag.name}</span><span className="rounded-full bg-background/70 px-1.5 text-[11px] text-muted-foreground">{tag.count}</span></button>)}</div> : <div className="py-10 text-center text-sm text-muted-foreground"><Hash className="mx-auto mb-3 opacity-30"/><p>{t("tags.empty")}</p><p className="mt-1">{t("tags.hint")}</p></div>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function TagResults({ view, onPage, onInbox }: { view: TagView | null; onPage(id: string): void; onInbox(): void }) {
  if (!view || (!view.pages.length && !view.quickNotes.length)) return <p className="py-10 text-center text-sm text-muted-foreground">{t("tags.noMatches")}</p>;
  return <div className="space-y-5">{view.pages.length > 0 && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tags.pages")}</h3><div className="space-y-1">{view.pages.map((page) => <button key={page.id} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-accent" onClick={() => onPage(page.id)}><FileText size={17} className="shrink-0 text-muted-foreground"/><span className="min-w-0"><span className="block truncate text-sm font-medium">{page.icon} {page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.section.notebook.title} · {page.section.title}</span></span></button>)}</div></section>}{view.quickNotes.length > 0 && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tags.quickNotes")}</h3><div className="grid gap-2 sm:grid-cols-2">{view.quickNotes.map((note) => <button key={note.id} data-quick-note-color={note.color} className="quick-note-card min-h-20 rounded-lg p-3 text-left ring-1 ring-border/50" onClick={onInbox}><span className="block truncate text-sm font-semibold">{note.icon} {note.title || note.body.split(/\s+/).slice(0, 5).join(" ")}</span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-foreground/70">{note.body}</span></button>)}</div></section>}</div>;
}
