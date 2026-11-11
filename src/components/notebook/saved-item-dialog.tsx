"use client";

import { useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import type { Notebook } from "./types";
import { savedEndpoint, savedError, savedItemEndpoint, savedRequestKey, savedTitle, type SavedItem } from "./saved-items-client";

export type SavedDialogAction = { type: "create" } | { type: "edit" | "delete" | "convert"; item: SavedItem };
const titles = { create: "Добавить материал", edit: "Изменить материал", delete: "Удалить материал?", convert: "Перенести в страницу" };
const labels = { create: "Добавить", edit: "Применить", delete: "Удалить", convert: "Перенести" };
const field = "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground";

export function SavedItemDialog({ action, notebooks, onClose, onComplete }: {
  action: SavedDialogAction; notebooks: Notebook[]; onClose(): void; onComplete(result?: { item?: SavedItem; pageId?: string }): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef("");
  const running = useRef(false);
  const item = action.type === "create" ? null : action.item;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const tags = String(form.get("tags") ?? "").split(/[,\s]+/u).filter(Boolean);
    const title = String(form.get("title") ?? "");
    try {
      if (action.type === "create") {
        const url = String(form.get("url") ?? "").trim() || null;
        const text = String(form.get("text") ?? "");
        const files = form.getAll("file").filter((file): file is File => file instanceof File && file.size > 0);
        if (files.length > 4) throw new Error("Можно добавить не более четырёх файлов");
        const payload = { title, text, url, tags };
        key.current ||= savedRequestKey();
        const headers = { "idempotency-key": key.current };
        if (files.length) {
          const body = new FormData();
          body.set("payload", JSON.stringify(payload));
          files.forEach(file => body.append("file", file));
          onComplete(await api<{ item: SavedItem }>(savedEndpoint, { method: "POST", headers, body }));
        } else {
          onComplete(await api<{ item: SavedItem }>(savedEndpoint, {
            ...jsonOptions("POST", payload), headers: { ...headers, "content-type": "application/json" },
          }));
        }
      } else if (action.type === "edit") {
        onComplete(await api<{ item: SavedItem }>(savedItemEndpoint(action.item.id), jsonOptions("PATCH", { title, tags })));
      } else if (action.type === "convert") {
        key.current ||= savedRequestKey();
        const body = { sectionId: form.get("sectionId") };
        onComplete(await api<{ pageId: string }>(`${savedItemEndpoint(action.item.id)}/convert`, {
          ...jsonOptions("POST", body), headers: { "content-type": "application/json", "idempotency-key": key.current },
        }));
      } else {
        const response = await fetch(savedItemEndpoint(action.item.id), { method: "DELETE" });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Не удалось удалить материал");
        }
        onComplete();
      }
    } catch (cause) {
      setError(savedError(cause));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const hasSections = notebooks.some(notebook => notebook.sections.length);
  return <Dialog.Root open onOpenChange={open => { if (!open && !running.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/>
      <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-card p-5 text-card-foreground shadow-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(32rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl" aria-describedby={undefined}>
        <header className="mb-3 flex items-center justify-between gap-2">
          <Dialog.Title className="text-lg font-semibold">{titles[action.type]}</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" className="size-11 px-0" aria-label="Закрыть" data-saved-dialog-close disabled={busy}><X size={18}/></Button></Dialog.Close>
        </header>
        <form onSubmit={submit} onChange={() => { key.current = ""; }} className="space-y-4">
          {(action.type === "create" || action.type === "edit") && <>
            <label className="block space-y-1"><span>Название</span><input name="title" className={field} maxLength={200} defaultValue={item?.title} disabled={busy}/></label>
            {action.type === "create" && <>
              <label className="block space-y-1"><span>Ссылка</span><input name="url" type="url" inputMode="url" placeholder="https://" className={field} maxLength={2048} disabled={busy}/></label>
              <label className="block space-y-1"><span>Текст</span><textarea name="text" className={`${field} py-2`} rows={4} maxLength={50_000} disabled={busy}/></label>
              <label className="block space-y-1"><span>Изображения или PDF</span><input name="file" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf" multiple className={`${field} py-2 text-sm`} disabled={busy}/></label>
            </>}
            <label className="block space-y-1"><span>Теги через пробел или запятую</span><input name="tags" className={field} defaultValue={item?.tags.map(tag => tag.normalized).join(", ")} disabled={busy}/></label>
          </>}
          {action.type === "delete" && <p className="break-words text-sm text-muted-foreground">«{savedTitle(action.item)}» будет удалён. {action.item.convertedAt && "Созданная страница сохранится."}</p>}
          {action.type === "convert" && (hasSections
            ? <label className="block space-y-1"><span>Блокнот и раздел</span><select name="sectionId" className={field} required defaultValue="" disabled={busy}><option value="" disabled>Выберите раздел</option>{notebooks.filter(book => book.sections.length).map(book => <optgroup key={book.id} label={book.title}>{book.sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</optgroup>)}</select></label>
            : <p className="text-sm text-muted-foreground">Создайте раздел в блокноте, чтобы перенести материал.</p>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <footer className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={onClose} disabled={busy}>Отмена</Button>
            <Button type="submit" variant={action.type === "delete" ? "destructive" : "default"} className="min-h-11" disabled={busy || (action.type === "convert" && !hasSections)}>{busy ? "Выполняется…" : labels[action.type]}</Button>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
