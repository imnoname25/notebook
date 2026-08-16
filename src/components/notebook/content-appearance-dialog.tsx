"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { ACCENT_BG_CLASSES, ACCENT_COLORS, ACCENT_LABELS, isAccentColor, type AccentColor } from "@/lib/content-appearance";
import { t } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import type { PageSummary, Section } from "./types";

const PAGE_ICONS = ["", "📝", "📌", "💡", "✅", "📚", "🗂️", "💻", "🛠️", "🏠", "💼", "🔒", "⭐", "❤️", "🌍", "🚀"];

function ColorPicker({ value, onChange }: { value: AccentColor; onChange(value: AccentColor): void }) {
  return <fieldset><legend className="mb-2 text-sm font-medium">{t("appearance.color")}</legend><div className="grid grid-cols-6 gap-2">{ACCENT_COLORS.map((color) => <button key={color} type="button" title={ACCENT_LABELS[color]} aria-label={ACCENT_LABELS[color]} aria-pressed={value === color} onClick={() => onChange(color)} className={cn("flex size-10 items-center justify-center rounded-md ring-offset-2 ring-offset-card", ACCENT_BG_CLASSES[color], value === color && "ring-2 ring-primary")}>{value === color && <Check size={15} className={color === "default" ? "text-foreground" : "text-white"}/>}</button>)}</div></fieldset>;
}

export function SectionAppearanceDialog({ section, onClose, onSaved }: { section: Section; onClose(): void; onSaved(section: Section): void }) {
  const [color, setColor] = useState<AccentColor>(isAccentColor(section.color) ? section.color : "default");
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content aria-describedby={undefined} className="fixed bottom-0 left-0 z-50 w-full rounded-t-xl bg-card p-5 shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"><header className="mb-5 flex items-center"><Dialog.Title className="flex-1 font-semibold">{t("appearance.title")} · {section.title}</Dialog.Title><Dialog.Close className="flex size-10 items-center justify-center rounded-md hover:bg-accent" aria-label={t("common.close")}><X size={17}/></Dialog.Close></header><ColorPicker value={color} onChange={setColor}/><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={async () => { const result = await api<{ section: Section }>(`/api/sections/${section.id}`, jsonOptions("PATCH", { color })); onSaved(result.section); onClose(); }}>{t("common.save")}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function PageAppearanceDialog({ page, onClose, onSaved }: { page: PageSummary; onClose(): void; onSaved(page: PageSummary): void }) {
  const [icon, setIcon] = useState(page.icon ?? "");
  const [color, setColor] = useState<AccentColor>(isAccentColor(page.color) ? page.color : "default");
  const [coverUploadId, setCoverUploadId] = useState<string | null>(page.coverUploadId);
  const [width, setWidth] = useState<"narrow" | "normal" | "wide">("normal");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ settings: { editorContentWidth: typeof width } }>("/api/settings").then(({ settings }) => setWidth(settings.editorContentWidth)); }, []);
  async function upload(file: File) { const form = new FormData(); form.append("file", file); form.append("pageId", page.id); const result = await api<{ id: string }>("/api/uploads", { method: "POST", body: form }); setCoverUploadId(result.id); }
  async function save() { setBusy(true); try { const [{ page: saved }] = await Promise.all([api<{ page: PageSummary }>(`/api/pages/${page.id}`, jsonOptions("PATCH", { icon: icon || null, color, coverUploadId })), api("/api/settings", jsonOptions("PATCH", { editorContentWidth: width }))]); onSaved(saved); onClose(); } finally { setBusy(false); } }
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-50 overflow-y-auto bg-card p-5 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:shadow-2xl"><header className="mb-5 flex items-center"><Dialog.Title className="flex-1 font-semibold">{t("appearance.title")} · {page.title}</Dialog.Title><Dialog.Close className="flex size-10 items-center justify-center rounded-md hover:bg-accent" aria-label={t("common.close")}><X size={17}/></Dialog.Close></header><fieldset><legend className="mb-2 text-sm font-medium">{t("appearance.icon")}</legend><div className="grid grid-cols-8 gap-2">{PAGE_ICONS.map((item) => <button key={item || "none"} type="button" aria-label={item || "Без иконки"} aria-pressed={icon === item} onClick={() => setIcon(item)} className={cn("flex size-10 items-center justify-center rounded-md bg-muted text-lg hover:bg-accent", icon === item && "ring-2 ring-primary")}>{item || <X size={14}/>}</button>)}</div></fieldset><div className="mt-5"><ColorPicker value={color} onChange={setColor}/></div><fieldset className="mt-5"><legend className="mb-2 text-sm font-medium">{t("appearance.cover")}</legend>{coverUploadId && <img className="mb-2 h-28 w-full rounded-md object-cover" src={`/api/uploads/${coverUploadId}`} alt=""/>}<div className="flex gap-2"><label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent"><ImagePlus size={15}/>Добавить или сменить<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}/></label>{coverUploadId && <Button variant="ghost" onClick={() => setCoverUploadId(null)}>{t("appearance.removeCover")}</Button>}</div></fieldset><label className="mt-5 block text-sm"><span className="mb-2 block font-medium">Ширина страницы</span><select className="input" value={width} onChange={(event) => setWidth(event.target.value as typeof width)}><option value="narrow">Узкая · 42rem</option><option value="normal">Обычная · 54rem</option><option value="wide">Широкая · 74rem</option></select></label><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={busy} onClick={() => void save()}>{t("common.save")}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
