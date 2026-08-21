"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, FileText, Folder, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";

export type TrashItem = { type: "notebook" | "section" | "page"; id: string; title: string; deletedAt: string; notebookTitle?: string; sectionTitle?: string };

export function TrashView({ onBack, onChanged, onRestored, onError }: { onBack(): void; onChanged(): void; onRestored?(item: TrashItem): void; onError(error: unknown): void }) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems((await api<{ items: TrashItem[] }>("/api/trash")).items); }
    catch (error) { onError(error); }
    finally { setLoading(false); }
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    api<{ items: TrashItem[] }>("/api/trash").then((response) => { if (!cancelled) setItems(response.items); }).catch(onError).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onError]);

  async function restore(item: TrashItem) {
    setBusyId(item.id);
    try { await api("/api/trash/restore", jsonOptions("POST", { type: item.type, id: item.id })); await load(); onChanged(); onRestored?.(item); }
    catch (error) { onError(error); }
    finally { setBusyId(null); }
  }

  async function remove(item: TrashItem) {
    if (!window.confirm(`Удалить «${item.title}» навсегда? Это действие нельзя отменить.`)) return;
    setBusyId(item.id);
    try { await api(`/api/trash/${item.type}/${item.id}`, jsonOptions("DELETE")); await load(); onChanged(); }
    catch (error) { onError(error); }
    finally { setBusyId(null); }
  }

  async function empty() {
    if (!window.confirm("Очистить корзину? Все элементы будут удалены навсегда.")) return;
    setBusyId("all");
    try { await api("/api/trash", jsonOptions("DELETE")); await load(); onChanged(); }
    catch (error) { onError(error); }
    finally { setBusyId(null); }
  }

  return <main className="col-span-full flex min-h-0 flex-col bg-card">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4 md:px-6"><Button variant="ghost" size="icon" onClick={onBack} aria-label="Вернуться к блокнотам"><ArrowLeft size={18}/></Button><div className="min-w-0 flex-1"><h1 className="font-semibold">Корзина</h1><p className="text-xs text-muted-foreground">Удалённые блокноты, разделы и страницы</p></div>{items.length > 0 && <Button variant="outline" size="sm" onClick={empty} disabled={busyId !== null}><Trash2 size={14}/>Очистить корзину</Button>}</header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-3xl space-y-2">
        {loading && <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="animate-spin"/></div>}
        {!loading && items.length === 0 && <div className="rounded-2xl bg-muted/40 px-6 py-20 text-center"><Trash2 className="mx-auto mb-4 text-muted-foreground/50" size={36}/><h2 className="font-medium">Корзина пуста</h2><p className="mt-1 text-sm text-muted-foreground">Удалённые элементы появятся здесь.</p></div>}
        {items.map((item) => <article key={`${item.type}:${item.id}`} className="flex flex-col gap-3 rounded-xl bg-background p-4 ring-1 ring-border/60 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">{item.type === "notebook" ? <BookOpen size={18}/> : item.type === "section" ? <Folder size={18}/> : <FileText size={18}/>}</span>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-medium">{item.title}</h2><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{item.type === "notebook" ? "блокнот" : item.type === "section" ? "раздел" : "страница"}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{[item.notebookTitle, item.sectionTitle].filter(Boolean).join(" · ") || "Без родителя"} · удалено {new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.deletedAt))}</p></div>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => restore(item)} disabled={busyId !== null}>{busyId === item.id ? <Loader2 size={14} className="animate-spin"/> : <RotateCcw size={14}/>}Восстановить</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(item)} disabled={busyId !== null}>Удалить навсегда</Button></div>
        </article>)}
      </div>
    </div>
  </main>;
}
