"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Clock3, FileText, Inbox, Loader2, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import { t } from "@/lib/i18n/messages";

type TodayPage = { id: string; title: string; icon: string | null; updatedAt: string; sectionTitle?: string; notebookTitle?: string; section?: { title: string; notebook: { title: string } } };
type TodayData = {
  inbox: { id: string; title: string; body: string; color: string; icon: string | null; isPinned: boolean; updatedAt: string }[];
  recent: TodayPage[]; favorites: TodayPage[]; changed: TodayPage[];
  tags: { name: string; normalized: string; count: number }[];
  attention: { status: "WARNING" | "OFFLINE"; value: string; detail: string | null; checkedAt: string; widget: { blockId: string; title: string; type: string; page: { id: string; title: string; icon: string | null } } }[];
};

export function TodayView({ revision, onBack, onCapture, onInbox, onPage, onTag, onError }: {
  revision: number; onBack(): void; onCapture(): void; onInbox(): void; onPage(id: string): void; onTag(tag: string): void; onError(error: unknown): void;
}) {
  const [response, setResponse] = useState<{ revision: number; data: TodayData } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<TodayData>("/api/today", { signal: controller.signal }).then((data) => setResponse({ revision, data })).catch((error: Error) => { if (error.name !== "AbortError") onError(error); });
    return () => controller.abort();
  }, [onError, revision]);
  const data = response?.revision === revision ? response.data : null;
  return <main className="col-span-full min-h-0 overflow-y-auto bg-background px-4 pb-8 md:px-8 md:py-7">
    <div className="mx-auto max-w-6xl"><header className="mb-6 flex min-h-14 items-center gap-3"><Button variant="ghost" className="size-11 px-0 md:hidden" onClick={onBack}><ArrowLeft size={20}/></Button><span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles size={21}/></span><div><p className="text-sm text-muted-foreground">{new Date().toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" })}</p><h1 className="text-2xl font-semibold tracking-tight">{t("today.title")}</h1></div><Button className="ml-auto min-h-11" onClick={onCapture}>{t("today.capture")}</Button></header>
      {!data ? <div className="flex py-20 justify-center"><Loader2 className="animate-spin text-muted-foreground"/></div> : <div className="grid items-start gap-5 lg:grid-cols-2">
        {data.attention.length > 0 && <TodaySection title={t("today.attention")} icon={<AlertTriangle size={17}/>}><div className="space-y-1">{data.attention.map((item) => <button key={`${item.widget.page.id}:${item.widget.blockId}`} className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-accent" onClick={() => onPage(item.widget.page.id)}><span className="notebook-live-dot" style={{ "--live-rgb": item.status === "OFFLINE" ? "239 68 68" : "245 158 11" } as React.CSSProperties}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.widget.title || item.widget.page.title}</strong><span className="block truncate text-xs text-muted-foreground">{item.value}{item.detail ? ` · ${item.detail}` : ""}</span></span></button>)}</div></TodaySection>}
        {data.inbox.length > 0 && <TodaySection title={t("quickNotes.inbox")} icon={<Inbox size={17}/>} action={onInbox}><div className="grid gap-2 sm:grid-cols-2">{data.inbox.map((note) => <button key={note.id} data-quick-note-color={note.color} className="quick-note-card min-h-24 rounded-xl p-3 text-left ring-1 ring-border/40" onClick={onInbox}><strong className="block truncate text-sm">{note.icon} {note.title || note.body.split(/\s+/).slice(0, 5).join(" ")}</strong><span className="mt-1 block line-clamp-2 text-sm leading-5 text-foreground/70">{note.body}</span></button>)}</div></TodaySection>}
        {data.recent.length > 0 && <TodaySection title={t("overview.recent")} icon={<Clock3 size={17}/>}><PageRows pages={data.recent} onPage={onPage}/></TodaySection>}
        {data.favorites.length > 0 && <TodaySection title={t("overview.favorites")} icon={<Star size={17}/>}><PageRows pages={data.favorites} onPage={onPage}/></TodaySection>}
        {data.changed.length > 0 && <TodaySection title={t("today.changed")} icon={<FileText size={17}/>}><PageRows pages={data.changed} onPage={onPage}/></TodaySection>}
        {data.tags.length > 0 && <TodaySection title={t("today.tags")}><div className="flex flex-wrap gap-2">{data.tags.map((tag) => <button key={tag.normalized} className="notebook-tag-chip min-h-9 px-3" onClick={() => onTag(tag.normalized)}>#{tag.name}<span className="ml-1 opacity-60">{tag.count}</span></button>)}</div></TodaySection>}
      </div>}
    </div>
  </main>;
}

function TodaySection({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: () => void; children: React.ReactNode }) { return <section className="notebook-surface rounded-xl p-4"><header className="mb-3 flex items-center gap-2 text-muted-foreground">{icon}<h2 className="font-semibold text-foreground">{title}</h2>{action && <button className="ml-auto text-xs hover:text-foreground" onClick={action}>{t("common.open")}</button>}</header>{children}</section>; }
function PageRows({ pages, onPage }: { pages: TodayPage[]; onPage(id: string): void }) { return <div className="space-y-1">{pages.map((page) => <button key={page.id} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-accent" onClick={() => onPage(page.id)}><span className="w-6 text-center">{page.icon || ""}</span><span className="min-w-0"><strong className="block truncate text-sm font-medium">{page.title}</strong><span className="block truncate text-xs text-muted-foreground">{page.notebookTitle ?? page.section?.notebook.title} · {page.sectionTitle ?? page.section?.title}</span></span></button>)}</div>; }
