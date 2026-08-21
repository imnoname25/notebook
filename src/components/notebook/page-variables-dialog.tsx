"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, Variable, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageVariablesSchema, type PageVariable } from "@/lib/page-variables";

export function PageVariablesDialog({ open, initial, onOpenChange, onApply }: { open: boolean; initial: PageVariable[]; onOpenChange(open: boolean): void; onApply(value: PageVariable[]): void }) {
  const [rows, setRows] = useState<PageVariable[]>(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: open }));
    const close = () => { setRows(initial); setError(""); onOpenChange(false); };
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => window.removeEventListener("notebook:close-editor-overlay", close);
  }, [initial, onOpenChange, open]);
  const change = (index: number, key: keyof PageVariable, value: string) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  const apply = () => { const parsed = pageVariablesSchema.safeParse(rows); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Проверьте переменные"); return; } onApply(parsed.data); onOpenChange(false); };
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) { setRows(initial); setError(""); } onOpenChange(next); }}><Dialog.Portal><Dialog.Overlay className="notebook-dialog-overlay fixed inset-0 z-[70] bg-black/40"/><Dialog.Content aria-describedby={undefined} className="notebook-dialog-content notebook-mobile-sheet fixed inset-x-0 bottom-0 z-[71] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-card p-4 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(620px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-5">
    <header className="mb-4 flex items-center gap-3"><Variable size={20}/><Dialog.Title className="flex-1 font-semibold">Переменные страницы</Dialog.Title><Dialog.Close className="notebook-live-action" aria-label="Закрыть"><X size={18}/></Dialog.Close></header>
    <p className="mb-4 text-sm text-muted-foreground">Используйте <code>{"{{host}}"}</code> в тексте. Переменные являются обычными строками и не предназначены для паролей или токенов.</p>
    <div className="space-y-2">{rows.map((row, index) => <div key={index} className="grid grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)_3rem] gap-2"><input className="input min-w-0" aria-label={`Имя переменной ${index + 1}`} placeholder="host" value={row.name} onChange={(event) => change(index, "name", event.target.value)}/><input className="input min-w-0" aria-label={`Значение переменной ${index + 1}`} placeholder="proxmox.local" value={row.value} onChange={(event) => change(index, "value", event.target.value)}/><button type="button" className="notebook-live-action h-12 w-12" aria-label={`Удалить переменную ${row.name || index + 1}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17}/></button></div>)}</div>
    {rows.length < 32 && <button type="button" className="mt-3 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setRows((current) => [...current, { name: "", value: "" }])}><Plus size={17}/>Добавить переменную</button>}
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    <footer className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={apply}>Применить</Button></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
