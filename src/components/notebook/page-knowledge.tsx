"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowUpRight, Link2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { PAGE_METADATA_EVENT } from "./page-link-inline";
import { t } from "@/lib/i18n/messages";

type LinkedPage = { id: string; title: string; icon: string | null; section: { title: string; notebook: { title: string } } };
type Knowledge = {
  tags: { id: string; name: string; normalized: string }[];
  backlinks: LinkedPage[];
  related: (LinkedPage & { score: number })[];
};
const linkedPageSchema = z.object({ id: z.string(), title: z.string(), icon: z.string().nullable(), section: z.object({ title: z.string(), notebook: z.object({ title: z.string() }) }) });
const knowledgeSchema = z.object({ tags: z.array(z.object({ id: z.string(), name: z.string(), normalized: z.string() })), backlinks: z.array(linkedPageSchema), related: z.array(linkedPageSchema.extend({ score: z.number() })) });

export function PageKnowledge({ pageId, revision, onNavigate }: { pageId: string; revision: number; onNavigate(id: string): Promise<void> }) {
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  useEffect(() => {
    let controller = new AbortController();let timer: ReturnType<typeof setTimeout>;let generation = 0;
    const refresh = () => { clearTimeout(timer);controller.abort();const version = ++generation;timer = setTimeout(() => { controller = new AbortController();void api<unknown>(`/api/pages/${pageId}/knowledge`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted && version === generation) setKnowledge(knowledgeSchema.parse(value)); }).catch(() => undefined); }, 350); };
    refresh();window.addEventListener(PAGE_METADATA_EVENT, refresh);window.addEventListener("focus", refresh);
    const interval = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30_000);
    return () => { clearTimeout(timer);clearInterval(interval);controller.abort();window.removeEventListener(PAGE_METADATA_EVENT, refresh);window.removeEventListener("focus", refresh); };
  }, [pageId, revision]);
  if (!knowledge || (!knowledge.tags.length && !knowledge.backlinks.length && !knowledge.related.length)) return null;
  return <details className="notebook-knowledge mb-6 mt-6 border-t border-border/55 pt-3">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Link2 size={16} className="text-primary"/>На эту страницу ссылаются<span className="ml-auto text-xs font-normal text-muted-foreground">{knowledge.backlinks.length}</span></summary>
    <div className="mt-4 grid gap-5 lg:grid-cols-2">{knowledge.backlinks.length > 0 && <KnowledgeSection title="На эту страницу ссылаются" pages={knowledge.backlinks} onNavigate={onNavigate}/>} {knowledge.related.length > 0 && <KnowledgeSection title={t("knowledge.related")} pages={knowledge.related} onNavigate={onNavigate}/>} {knowledge.tags.length > 0 && <section className="lg:col-span-2"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tags.title")}</h3><div className="flex flex-wrap gap-1.5">{knowledge.tags.map((tag) => <button key={tag.id} className="notebook-tag-chip" onClick={() => window.dispatchEvent(new CustomEvent("notebook:search-tag", { detail: tag.normalized }))}>#{tag.name}</button>)}</div></section>}</div>
  </details>;
}

function KnowledgeSection({ title, pages, onNavigate }: { title: string; pages: LinkedPage[]; onNavigate(id: string): Promise<void> }) {
  const [error, setError] = useState("");
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3><div className="space-y-1">{pages.map((page) => <button key={page.id} className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent" onClick={() => { setError("");void onNavigate(page.id).catch(() => setError("Страница недоступна или нет соединения")); }}><span>{page.icon || "📄"}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.section.notebook.title} · {page.section.title}</span></span><ArrowUpRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100"/></button>)}</div>{error && <p role="status" className="text-xs text-muted-foreground">{error}</p>}</section>;
}
