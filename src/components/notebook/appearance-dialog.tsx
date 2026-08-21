"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import { NOTEBOOK_COLORS, NOTEBOOK_COLOR_CLASSES, NOTEBOOK_COLOR_LABELS, NOTEBOOK_ICONS, NOTEBOOK_ICON_COMPONENTS, NOTEBOOK_ICON_LABELS, isNotebookColor, isNotebookIcon, type NotebookColor, type NotebookIconId } from "@/lib/notebook-appearance";
import { NOTEBOOK_COVER_GRADIENTS, NOTEBOOK_COVER_LABELS, type NotebookCoverType } from "@/lib/notebook-cover";
import { cn } from "@/lib/utils";
import type { Notebook } from "./types";

export type NotebookAppearanceInput = { color: NotebookColor; icon: NotebookIconId; coverType: NotebookCoverType; coverValue: string | null; coverUploadId: string | null };

export function AppearanceDialog({ notebook, open, onOpenChange, onSave }: { notebook: Notebook | null; open: boolean; onOpenChange(open: boolean): void; onSave(input: NotebookAppearanceInput): Promise<void> }) {
  const [color, setColor] = useState<NotebookColor>(() => notebook && isNotebookColor(notebook.color) ? notebook.color : "slate");
  const [icon, setIcon] = useState<NotebookIconId>(() => notebook && isNotebookIcon(notebook.icon) ? notebook.icon : "notebook");
  const [coverType, setCoverType] = useState<NotebookCoverType>(notebook?.coverType ?? "none");
  const [coverValue, setCoverValue] = useState<string | null>(notebook?.coverValue ?? null);
  const [coverUploadId, setCoverUploadId] = useState<string | null>(notebook?.coverUploadId ?? null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const PreviewIcon = NOTEBOOK_ICON_COMPONENTS[icon];
  async function uploadCover() {
    if (!notebook || !coverFile) return coverUploadId;
    const form = new FormData(); form.set("file", coverFile); form.set("notebookId", notebook.id);
    return (await api<{ id: string }>("/api/uploads", { method: "POST", body: form })).id;
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="notebook-dialog-overlay fixed inset-0 z-50 bg-black/35"/><Dialog.Content className="notebook-dialog-content fixed bottom-0 left-0 z-50 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card p-5 shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl" aria-describedby={undefined}>
    <div className="flex items-start gap-3"><div className={cn("flex size-12 items-center justify-center rounded-xl text-white", NOTEBOOK_COLOR_CLASSES[color])}><PreviewIcon size={24}/></div><div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">Настроить блокнот</Dialog.Title><p className="truncate text-sm text-muted-foreground">{notebook?.title}</p></div><Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Закрыть"><X size={18}/></Dialog.Close></div>
    <fieldset className="mt-6"><legend className="mb-2 text-sm font-medium">Цвет</legend><div className="grid grid-cols-6 gap-2">{NOTEBOOK_COLORS.map((value) => <button key={value} type="button" title={NOTEBOOK_COLOR_LABELS[value]} aria-label={NOTEBOOK_COLOR_LABELS[value]} aria-pressed={color === value} onClick={() => setColor(value)} className={cn("flex aspect-square items-center justify-center rounded-lg text-white ring-offset-2 ring-offset-background", NOTEBOOK_COLOR_CLASSES[value], color === value && "ring-2 ring-primary")}>{color === value && <Check size={16}/>}</button>)}</div></fieldset>
    <fieldset className="mt-5"><legend className="mb-2 text-sm font-medium">Иконка</legend><div className="grid grid-cols-5 gap-2">{NOTEBOOK_ICONS.map((value) => { const Icon = NOTEBOOK_ICON_COMPONENTS[value]; return <button key={value} type="button" title={NOTEBOOK_ICON_LABELS[value]} aria-label={NOTEBOOK_ICON_LABELS[value]} aria-pressed={icon === value} onClick={() => setIcon(value)} className={cn("flex aspect-square items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground", icon === value && "ring-2 ring-primary text-foreground")}><Icon size={19}/></button>; })}</div></fieldset>
    <fieldset className="mt-5"><legend className="mb-2 text-sm font-medium">Обложка</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" aria-pressed={coverType === "none"} onClick={() => { setCoverType("none"); setCoverValue(null); setCoverUploadId(null); setCoverFile(null); }} className={cn("notebook-cover-tile bg-muted", coverType === "none" && "ring-2 ring-primary")}><span>Без обложки</span></button><button type="button" aria-pressed={coverType === "solid"} onClick={() => { setCoverType("solid"); setCoverValue(color); setCoverUploadId(null); setCoverFile(null); }} className={cn("notebook-cover-tile text-white", NOTEBOOK_COLOR_CLASSES[color], coverType === "solid" && "ring-2 ring-primary ring-offset-2")}><span>Сплошной цвет</span></button>{NOTEBOOK_COVER_GRADIENTS.map((gradient) => <button key={gradient} type="button" data-notebook-cover={gradient} aria-label={NOTEBOOK_COVER_LABELS[gradient]} aria-pressed={coverType === "gradient" && coverValue === gradient} onClick={() => { setCoverType("gradient"); setCoverValue(gradient); setCoverUploadId(null); setCoverFile(null); }} className={cn("notebook-cover-tile text-white", coverType === "gradient" && coverValue === gradient && "ring-2 ring-primary ring-offset-2")}><span>{NOTEBOOK_COVER_LABELS[gradient]}</span></button>)}</div><label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm font-medium hover:bg-accent"><ImagePlus size={17}/>Загрузить изображение<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setCoverFile(file); setCoverType("image"); setCoverValue(null); setCoverUploadId(null); } }}/></label>{coverType === "image" && (coverFile || coverUploadId) && <p className="mt-2 text-xs text-muted-foreground">{coverFile?.name ?? "Изображение выбрано"}</p>}</fieldset>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><Dialog.Close asChild><Button variant="ghost">Отмена</Button></Dialog.Close><Button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const uploadedId = await uploadCover(); await onSave({ color, icon, coverType, coverValue, coverUploadId: uploadedId }); onOpenChange(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить оформление"); } finally { setBusy(false); } }}>Сохранить</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
