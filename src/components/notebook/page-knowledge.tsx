"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Link2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { t } from "@/lib/i18n/messages";

type LinkedPage = { id: string; title: string; icon: string | null; section: { title: string; notebook: { title: string } } };
type Knowledge = {
  tags: { id: string; name: string; normalized: string }[];
  backlinks: LinkedPage[];
  related: (LinkedPage & { score: number })[];
};

export function PageKnowledge({ pageId, revision, onNavigate }: { pageId: string; revision: number; onNavigate(id: string): Promise<void> }) {
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void api<Knowledge>(`/api/pages/${pageId}/knowledge`, { signal: controller.signal }).then(setKnowledge).catch(() => undefined), 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pageId, revision]);
  if (!knowledge || (!knowledge.tags.length && !knowledge.backlinks.length && !knowledge.related.length)) return null;
  return <details className="notebook-knowledge mb-8 mt-10 rounded-xl border border-border/55 bg-card/60 p-4">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Link2 size={16} className="text-primary"/>{t("knowledge.title")}<span className="ml-auto text-xs font-normal text-muted-foreground">{knowledge.backlinks.length + knowledge.related.length}</span></summary>
    <div className="mt-4 grid gap-5 lg:grid-cols-2">{knowledge.backlinks.length > 0 && <KnowledgeSection title={t("knowledge.backlinks")} pages={knowledge.backlinks} onNavigate={onNavigate}/>} {knowledge.related.length > 0 && <KnowledgeSection title={t("knowledge.related")} pages={knowledge.related} onNavigate={onNavigate}/>} {knowledge.tags.length > 0 && <section className="lg:col-span-2"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tags.title")}</h3><div className="flex flex-wrap gap-1.5">{knowledge.tags.map((tag) => <button key={tag.id} className="notebook-tag-chip" onClick={() => window.dispatchEvent(new CustomEvent("notebook:search-tag", { detail: tag.normalized }))}>#{tag.name}</button>)}</div></section>}</div>
  </details>;
}

function KnowledgeSection({ title, pages, onNavigate }: { title: string; pages: LinkedPage[]; onNavigate(id: string): Promise<void> }) {
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3><div className="space-y-1">{pages.map((page) => <button key={page.id} className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent" onClick={() => void onNavigate(page.id)}><span>{page.icon || "📄"}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.section.notebook.title} · {page.section.title}</span></span><ArrowUpRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100"/></button>)}</div></section>;
}
