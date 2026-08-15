"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOTEBOOK_COLORS, NOTEBOOK_COLOR_CLASSES, NOTEBOOK_COLOR_LABELS, NOTEBOOK_ICONS, NOTEBOOK_ICON_COMPONENTS, NOTEBOOK_ICON_LABELS, isNotebookColor, isNotebookIcon, type NotebookColor, type NotebookIconId } from "@/lib/notebook-appearance";
import { cn } from "@/lib/utils";
import type { Notebook } from "./types";

export function AppearanceDialog({ notebook, open, onOpenChange, onSave }: { notebook: Notebook | null; open: boolean; onOpenChange(open: boolean): void; onSave(color: NotebookColor, icon: NotebookIconId): Promise<void> }) {
  const [color, setColor] = useState<NotebookColor>(() => notebook && isNotebookColor(notebook.color) ? notebook.color : "slate");
  const [icon, setIcon] = useState<NotebookIconId>(() => notebook && isNotebookIcon(notebook.icon) ? notebook.icon : "notebook");
  const [busy, setBusy] = useState(false);
  const PreviewIcon = NOTEBOOK_ICON_COMPONENTS[icon];
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content className="fixed bottom-0 left-0 z-50 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card p-5 shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl" aria-describedby={undefined}>
    <div className="flex items-start gap-3"><div className={cn("flex size-12 items-center justify-center rounded-xl text-white", NOTEBOOK_COLOR_CLASSES[color])}><PreviewIcon size={24}/></div><div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">Настроить блокнот</Dialog.Title><p className="truncate text-sm text-muted-foreground">{notebook?.title}</p></div><Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Закрыть"><X size={18}/></Dialog.Close></div>
    <fieldset className="mt-6"><legend className="mb-2 text-sm font-medium">Цвет</legend><div className="grid grid-cols-6 gap-2">{NOTEBOOK_COLORS.map((value) => <button key={value} type="button" title={NOTEBOOK_COLOR_LABELS[value]} aria-label={NOTEBOOK_COLOR_LABELS[value]} aria-pressed={color === value} onClick={() => setColor(value)} className={cn("flex aspect-square items-center justify-center rounded-lg text-white ring-offset-2 ring-offset-background", NOTEBOOK_COLOR_CLASSES[value], color === value && "ring-2 ring-primary")}>{color === value && <Check size={16}/>}<span className="sr-only">{NOTEBOOK_COLOR_LABELS[value]}</span></button>)}</div></fieldset>
    <fieldset className="mt-5"><legend className="mb-2 text-sm font-medium">Иконка</legend><div className="grid grid-cols-5 gap-2">{NOTEBOOK_ICONS.map((value) => { const Icon = NOTEBOOK_ICON_COMPONENTS[value]; return <button key={value} type="button" title={NOTEBOOK_ICON_LABELS[value]} aria-label={NOTEBOOK_ICON_LABELS[value]} aria-pressed={icon === value} onClick={() => setIcon(value)} className={cn("flex aspect-square items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground", icon === value && "ring-2 ring-primary text-foreground")}><Icon size={19}/></button>; })}</div></fieldset>
    <div className="mt-6 flex justify-end gap-2"><Dialog.Close asChild><Button variant="ghost">Отмена</Button></Dialog.Close><Button disabled={busy} onClick={async () => { setBusy(true); try { await onSave(color, icon); onOpenChange(false); } finally { setBusy(false); } }}>Сохранить</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
