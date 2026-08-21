"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, FileText, ListTree, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/messages";
import { resolveAppearanceAccent } from "@/lib/content-appearance";
import type {
  EditorSaveController,
  Notebook,
  PageDocument,
  Section,
} from "./types";
import type { PageOutlineItem } from "@/lib/page-outline";
import { OutlineList } from "./page-outline";

const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((module) => module.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    ),
  },
);

export function EditorPane({
  page,
  notebook,
  section,
  loading,
  editorEpoch,
  onBack,
  onSaved,
  onController,
  onNotebookClick,
  onSectionClick,
  onInternalNavigate,
  outline,
  outlineVisible,
  onOutlineChange,
  onOutlineToggle,
  onOutlineSelect,
  onCreatePage,
}: {
  page: PageDocument | null;
  notebook: Notebook | null;
  section: Section | null;
  loading: boolean;
  editorEpoch: number;
  onBack(): void;
  onSaved(page: PageDocument): void;
  onController(controller: EditorSaveController | null): void;
  onNotebookClick(): void;
  onSectionClick(): void;
  onInternalNavigate(pageId: string): Promise<void>;
  outline: PageOutlineItem[];
  outlineVisible: boolean;
  onOutlineChange(items: PageOutlineItem[]): void;
  onOutlineToggle(): void;
  onOutlineSelect(id: string): void;
  onCreatePage(): void;
}) {
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-card shadow-[inset_1px_0_0_color-mix(in_srgb,var(--border)_45%,transparent)]">
      <div className="notebook-no-print flex h-16 shrink-0 items-center border-b border-border/50 px-2 md:hidden">
        <Button variant="ghost" className="h-12 px-3 text-base" onClick={onBack}>
          <ArrowLeft size={22} />
          Страницы
        </Button>
      </div>
      {page && (
        <nav
          aria-label="Хлебные крошки"
        className="notebook-breadcrumbs flex min-w-0 items-center gap-1.5 overflow-hidden border-b border-border/45 bg-card/80 px-4 py-2 text-[13.5px] text-muted-foreground/90 backdrop-blur md:px-12 md:text-[13px]"
        >
          <button
          className="max-w-[38%] truncate hover:text-foreground md:max-w-[28%]"
            title={notebook?.title}
            onClick={onNotebookClick}
          >
            {notebook?.title}
          </button>
          <span aria-hidden="true" className="text-muted-foreground/60">
            /
          </span>
        <span aria-hidden="true" className="md:hidden">…</span>
        <button
          className="hidden max-w-[28%] truncate hover:text-foreground md:block"
            title={section?.title}
            onClick={onSectionClick}
          >
            {section?.title}
          </button>
          <span aria-hidden="true" className="text-muted-foreground/60">
            /
          </span>
          {page.icon && <span aria-hidden="true">{page.icon}</span>}
          <span
            className="min-w-0 truncate font-medium text-foreground/85"
            title={page.title}
          >
            {page.title}
          </span>
          {outline.length > 0 && <button type="button" onClick={onOutlineToggle} className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8" aria-label={t("outline.title")} aria-pressed={outlineVisible}><ListTree size={17}/></button>}
        </nav>
      )}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin" />
        </div>
      ) : page ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          <RichTextEditor
            key={`${page.id}:${editorEpoch}`}
            page={page}
            resolvedAccent={resolveAppearanceAccent(page.color, section?.color, notebook?.color)}
            onSaved={onSaved}
            onController={onController}
            onInternalNavigate={onInternalNavigate}
            onOutlineChange={onOutlineChange}
          />
          {outlineVisible && outline.length > 0 && <aside className="notebook-no-print hidden w-56 shrink-0 overflow-y-auto border-l border-border/50 p-3 lg:block"><p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("outline.title")}</p><OutlineList items={outline} onSelect={onOutlineSelect}/></aside>}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-xs">
            <span className="mx-auto flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileText size={20} />
            </span>
            <h2 className="mt-4 font-semibold">{t("empty.selectPage")}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("empty.selectPageDescription")}
            </p>
            {section && <Button className="mt-5" onClick={onCreatePage}><Plus size={16}/>{t("empty.createPage")}</Button>}
          </div>
        </div>
      )}
    </main>
  );
}
