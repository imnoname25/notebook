"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Printer, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function PrintDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [breadcrumbs, setBreadcrumbs] = useState(true); const [date, setDate] = useState(true); const [compact, setCompact] = useState(false);
  function print() {
    const root = document.documentElement; root.dataset.printBreadcrumbs = String(breadcrumbs); root.dataset.printDate = String(date); root.dataset.printMargins = compact ? "compact" : "default";
    const cleanup = () => { delete root.dataset.printBreadcrumbs; delete root.dataset.printDate; delete root.dataset.printMargins; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup); onOpenChange(false); window.setTimeout(() => window.print(), 80);
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content aria-describedby={undefined} className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-card p-5 shadow-2xl sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"><div className="flex items-center gap-3"><Printer size={18}/><Dialog.Title className="flex-1 font-semibold">Печать / PDF</Dialog.Title><Dialog.Close className="flex size-10 items-center justify-center rounded-lg hover:bg-accent" aria-label="Закрыть"><X size={18}/></Dialog.Close></div><p className="mt-2 text-sm text-muted-foreground">В системном диалоге выберите «Сохранить как PDF», если нужен PDF-файл.</p><div className="mt-5 space-y-2"><Option label="Показывать breadcrumbs" checked={breadcrumbs} onChange={setBreadcrumbs}/><Option label="Показывать дату изменения" checked={date} onChange={setDate}/><Option label="Компактные поля страницы" checked={compact} onChange={setCompact}/><p className="px-2 pt-1 text-xs text-muted-foreground">Toggle-блоки всегда печатаются раскрытыми.</p></div><div className="mt-6 flex justify-end gap-2"><Dialog.Close asChild><Button variant="ghost">Отмена</Button></Dialog.Close><Button onClick={print}><Printer size={15}/>Печать</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function Option({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) { return <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-muted/50"><input type="checkbox" className="size-4" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span className="text-sm">{label}</span></label>; }
