"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EditorSaveController, Notebook, PageDocument, Section } from "./types";

const RichTextEditor = dynamic(() => import("./rich-text-editor").then((module) => module.RichTextEditor), { ssr: false, loading: () => <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div> });

export function EditorPane({ page, notebook, section, loading, editorEpoch, onBack, onSaved, onController, onNotebookClick, onSectionClick, onInternalNavigate }: { page: PageDocument | null; notebook: Notebook | null; section: Section | null; loading: boolean; editorEpoch: number; onBack(): void; onSaved(page: PageDocument): void; onController(controller: EditorSaveController | null): void; onNotebookClick(): void; onSectionClick(): void; onInternalNavigate(pageId: string): Promise<void> }) {
  return <main className="flex h-full min-h-0 min-w-0 flex-col bg-card">
    <div className="notebook-no-print flex h-14 shrink-0 items-center border-b border-border/50 px-3 md:hidden"><Button variant="ghost" className="h-11" onClick={onBack}><ArrowLeft size={17} />Страницы</Button></div>
    {page && <nav aria-label="Хлебные крошки" className="notebook-breadcrumbs flex min-w-0 items-center gap-1 border-b border-border/40 px-5 py-2 text-xs text-muted-foreground md:px-12"><button className="max-w-[28%] truncate hover:text-foreground" onClick={onNotebookClick}>{notebook?.title}</button><span>/</span><button className="max-w-[28%] truncate hover:text-foreground" onClick={onSectionClick}>{section?.title}</button><span>/</span><span className="min-w-0 truncate text-foreground">{page.title}</span></nav>}
    {loading ? <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div> : page ? <RichTextEditor key={`${page.id}:${editorEpoch}`} page={page} onSaved={onSaved} onController={onController} onInternalNavigate={onInternalNavigate} /> : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">Выберите страницу или создайте новую</div>}
  </main>;
}
