"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Notebook } from "./types";

type MoveTarget = { type: "page"; id: string; currentSectionId: string; title: string } | { type: "section"; id: string; currentNotebookId: string; title: string };

export function MoveDialog({ target, notebooks, open, onOpenChange, onMove }: { target: MoveTarget | null; notebooks: Notebook[]; open: boolean; onOpenChange(open: boolean): void; onMove(destinationId: string): Promise<void> }) {
  const pageDestinations = notebooks.flatMap((notebook) => notebook.sections.filter((section) => target?.type === "page" && section.id !== target.currentSectionId).map((section) => ({ id: section.id, label: `${notebook.title} / ${section.title}` })));
  const sectionDestinations = notebooks.filter((notebook) => target?.type === "section" && notebook.id !== target.currentNotebookId).map((notebook) => ({ id: notebook.id, label: notebook.title }));
  const destinations = target?.type === "page" ? pageDestinations : sectionDestinations;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content className="fixed bottom-0 left-0 z-50 max-h-[85vh] w-full overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl" aria-describedby={undefined}>
    <header className="flex items-center gap-3 border-b border-border/60 p-4"><div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">{target?.type === "page" ? "Переместить страницу" : "Переместить раздел"}</Dialog.Title><p className="truncate text-sm text-muted-foreground">{target?.title}</p></div><Dialog.Close className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent" aria-label="Закрыть"><X size={18}/></Dialog.Close></header>
    <div className="max-h-[60vh] overflow-y-auto p-2">{destinations.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{target?.type === "page" ? "Нет доступных разделов для перемещения" : "Нет доступных блокнотов для перемещения"}</p> : destinations.map((destination) => <Button key={destination.id} variant="ghost" className="h-auto w-full justify-between px-3 py-3 text-left" onClick={() => void onMove(destination.id)}><span className="truncate">{destination.label}</span><ArrowRight size={15}/></Button>)}</div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export type { MoveTarget };
