"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, Loader2, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import { ACCENT_DOT_CLASSES, resolveAppearanceAccent } from "@/lib/content-appearance";
import { isNotebookColor, isNotebookIcon, NOTEBOOK_COLOR_CLASSES, NOTEBOOK_ICON_COMPONENTS } from "@/lib/notebook-appearance";
import { t } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { SectionIcon } from "./section-icon";
import type { Notebook, Section } from "./types";

export type OverviewPage = {
  id: string;
  title: string;
  icon: string | null;
  sectionId: string;
  sectionTitle: string;
  updatedAt: string;
  lastOpenedAt?: string;
};
type OverviewData = {
  notebook: Notebook & { pageCount: number; updatedAt: string };
  sections: Array<Section & { pageCount: number }>;
  favorites: OverviewPage[];
  recent: OverviewPage[];
};

export function NotebookOverview({ notebook, revision, onSection, onPage, onAddSection, onError, onBack }: {
  notebook: Notebook;
  revision: number;
  onSection(section: Section): void;
  onPage(pageId: string): void;
  onAddSection(): void;
  onError(error: unknown): void;
  onBack(): void;
}) {
  const [response, setResponse] = useState<{ key: string; data: OverviewData } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<OverviewData>(`/api/notebooks/${notebook.id}/overview`, { signal: controller.signal })
      .then((data) => setResponse({ key: `${notebook.id}:${revision}`, data }))
      .catch((error: Error) => { if (error.name !== "AbortError") onError(error); });
    return () => controller.abort();
  }, [notebook.id, onError, revision]);

  const data = response?.key === `${notebook.id}:${revision}` ? response.data : null;
  const Icon = NOTEBOOK_ICON_COMPONENTS[isNotebookIcon(notebook.icon) ? notebook.icon : "notebook"];
  const color = isNotebookColor(notebook.color) ? notebook.color : "slate";
  if (!data) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  const sections = data?.sections ?? [];
  return (
    <main className="h-full min-h-0 overflow-y-auto bg-card px-5 pb-7 md:px-10 md:py-10">
      <div className="-mx-3 mb-3 flex h-14 items-center md:hidden"><Button variant="ghost" className="h-12 px-3 text-base" onClick={onBack}><ArrowLeft size={22}/>{t("quick.notebooks")}</Button></div>
      <div className="max-w-5xl">
        <header className="flex items-center gap-4 border-b border-border/50 pb-7">
          <span className={cn("flex size-14 items-center justify-center rounded-xl text-white", NOTEBOOK_COLOR_CLASSES[color])}><Icon size={28} /></span>
          <div className="min-w-0"><p className="text-sm text-muted-foreground">{t("overview.title")}</p><h1 className="truncate text-2xl font-semibold md:text-3xl">{notebook.title}</h1><p className="mt-1 text-sm text-muted-foreground">{data?.notebook.pageCount ?? 0} {t("overview.pages")}</p></div>
        </header>
        <OverviewSection title={t("overview.sections")} action={<Button variant="ghost" size="sm" onClick={onAddSection}><Plus size={16} />{t("overview.createSection")}</Button>}>
          {sections.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sections.map((section) => <button key={section.id} onClick={() => onSection(section)} className="group flex min-h-14 items-center gap-3 rounded-lg border border-border/50 px-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><SectionIcon value={section.icon} size={19} className={cn("shrink-0", ACCENT_DOT_CLASSES[resolveAppearanceAccent(null, section.color, notebook.color)])}/><span className="min-w-0 flex-1"><span className="block truncate font-medium" title={section.title}>{section.title}</span><span className="text-xs text-muted-foreground">{section.pageCount} {t("overview.pages")}</span></span></button>)}</div> : <Empty text={t("overview.noSections")} />}
        </OverviewSection>
        {!!data?.favorites.length && <OverviewSection title={t("overview.favorites")} icon={<Star size={16} />}><PageRows pages={data.favorites} onPage={onPage} /></OverviewSection>}
        <OverviewSection title={t("overview.recent")} icon={<Clock3 size={16} />}>
          {data?.recent.length ? <PageRows pages={data.recent} onPage={onPage} /> : <Empty text={t("overview.noRecent")} />}
        </OverviewSection>
      </div>
    </main>
  );
}

function OverviewSection({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="mt-8"><div className="mb-3 flex min-h-9 items-center gap-2"><span className="text-muted-foreground">{icon}</span><h2 className="font-semibold">{title}</h2><span className="ml-auto">{action}</span></div>{children}</section>;
}
function PageRows({ pages, onPage }: { pages: OverviewPage[]; onPage(id: string): void }) {
  return <div className="divide-y divide-border/40 rounded-lg border border-border/50">{pages.map((page) => <button key={page.id} onClick={() => onPage(page.id)} className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><span className="w-6 shrink-0 text-center text-lg">{page.icon ?? ""}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium" title={page.title}>{page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.sectionTitle}</span></span></button>)}</div>;
}
function Empty({ text }: { text: string }) { return <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">{text}</p>; }
