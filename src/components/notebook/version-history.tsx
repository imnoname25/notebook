"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Clock3, Loader2, RotateCcw, X } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { PageDocument } from "./types";

type VersionMeta = { id: string; title: string; reason: string; createdAt: string };
type VersionDocument = VersionMeta & { pageId: string; content: unknown[] };

function relativeDate(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

function ReadonlyPreview({ version }: { version: VersionDocument }) {
  const { resolvedTheme } = useTheme();
  const editor = useCreateBlockNote({ initialContent: version.content as PartialBlock[] }, [version.id]);
  return <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8"><h3 className="px-6 pb-2 pt-6 text-2xl font-semibold">{version.title}</h3><BlockNoteView editor={editor} editable={false} theme={resolvedTheme === "dark" ? "dark" : "light"}/></div>;
}

export function VersionHistory({ page, open, onOpenChange, onRestore }: { page: PageDocument | null; open: boolean; onOpenChange(open: boolean): void; onRestore(versionId: string): Promise<void> }) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [selected, setSelected] = useState<VersionDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const pageId = page?.id;
  useEffect(() => {
    if (!open || !pageId) return;
    let cancelled = false;
    api<{ versions: VersionMeta[]; nextCursor: string | null }>(`/api/pages/${pageId}/versions?limit=25`).then((result) => { if (!cancelled) { setVersions(result.versions); setNextCursor(result.nextCursor); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, pageId]);
  async function select(versionId: string) { if (!page) return; setSelected((await api<{ version: VersionDocument }>(`/api/pages/${page.id}/versions/${versionId}`)).version); }
  async function loadMore() { if (!page || !nextCursor) return; const result = await api<{ versions: VersionMeta[]; nextCursor: string | null }>(`/api/pages/${page.id}/versions?limit=25&cursor=${encodeURIComponent(nextCursor)}`); setVersions((items) => [...items, ...result.versions]); setNextCursor(result.nextCursor); }
  async function restore() { if (!selected || !window.confirm("Восстановить эту версию? Текущее состояние будет сохранено в истории.")) return; setBusy(true); try { await onRestore(selected.id); onOpenChange(false); } finally { setBusy(false); } }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col bg-card shadow-2xl sm:w-[min(92vw,760px)]" aria-describedby={undefined}>
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"><Clock3 size={18}/><Dialog.Title className="min-w-0 flex-1 truncate font-semibold">История версий · {page?.title}</Dialog.Title><Dialog.Close className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent" aria-label="Закрыть"><X size={18}/></Dialog.Close></header>
    <div className="grid min-h-0 flex-1 sm:grid-cols-[240px_minmax(0,1fr)]"><aside className="min-h-0 overflow-y-auto border-b border-border/60 p-2 sm:border-b-0 sm:border-r">{loading ? <Loader2 className="mx-auto my-12 animate-spin text-muted-foreground"/> : versions.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">Предыдущих версий пока нет</p> : <>{versions.map((version) => <button key={version.id} className="block w-full rounded-xl px-3 py-3 text-left hover:bg-accent" onClick={() => void select(version.id)}><span className="block truncate text-sm font-medium">{version.title}</span><time className="mt-1 block text-xs text-muted-foreground">{new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.createdAt))}</time><span className="block text-xs text-muted-foreground">{relativeDate(version.createdAt)}</span></button>)}{nextCursor && <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => void loadMore()}>Загрузить ещё</Button>}</>}</aside>
      <section className="flex min-h-0 flex-col">{selected ? <><ReadonlyPreview version={selected}/><div className="shrink-0 border-t border-border/60 p-3 text-right"><Button disabled={busy} onClick={() => void restore()}>{busy ? <Loader2 size={15} className="animate-spin"/> : <RotateCcw size={15}/>}Восстановить эту версию</Button></div></> : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">Выберите версию для просмотра</div>}</section>
    </div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
