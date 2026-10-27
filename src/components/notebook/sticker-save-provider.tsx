"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { api, jsonOptions } from "@/lib/client-api";
import type { QuickNote, QuickNotePatch } from "@/lib/quick-note";
import { StickerSaveStore, type StickerWriter } from "@/lib/sticker-save-store";

const Context = createContext<StickerSaveStore | null>(null);
async function send(id: string, patch: QuickNotePatch, base: QuickNote) {
  try {
    return (await api<{ note: QuickNote }>(`/api/quick-notes/${id}`, { ...jsonOptions("PATCH", { ...patch, expectedBody: base.body, expectedTitle: base.title }), keepalive: true })).note;
  } catch (error) {
    // A successful write may lose its response. Reconcile only an identical payload;
    // a different server text never becomes the base of an automatic overwrite.
    const remote = await api<{ note: QuickNote }>(`/api/quick-notes/${id}`).catch(() => null);
    if (remote && Object.entries(patch).every(([key, value]) => key === "archived" ? (remote.note.status !== "INBOX") === value : remote.note[key as keyof QuickNote] === (key === "title" && typeof value === "string" ? value.trim() : value))) return remote.note;
    throw error;
  }
}
export function StickerSaveProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new StickerSaveStore(send));
  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") void store.flushAll().catch(() => undefined); };
    const unload = (event: BeforeUnloadEvent) => { if (store.isDirty()) { event.preventDefault();event.returnValue = ""; } };
    document.addEventListener("visibilitychange", flush);window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", flush);window.removeEventListener("beforeunload", unload);void store.flushAll().catch(() => undefined); };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useStickerSaves() {
  const store = useContext(Context);
  if (!store) throw new Error("Sticker save provider is missing");
  return store;
}
export function useStickerDraft(note: QuickNote) {
  const store = useStickerSaves();
  const [writer] = useState(() => store.writer(note));
  useEffect(() => { writer.accept(note); }, [note, writer]);
  const snapshot = useSyncExternalStore(writer.subscribe, writer.getSnapshot, writer.getSnapshot);
  return { ...snapshot, writer };
}
export async function saveStickerDraftCopy(writer: StickerWriter) {
  await writer.flush().catch(() => undefined);
  const draft = writer.getSnapshot().note;
  const version = writer.version();
  const remote = await api<{ note: QuickNote }>(`/api/quick-notes/${draft.id}`).catch(() => null);
  const { note } = await api<{ note: QuickNote }>("/api/quick-notes", jsonOptions("POST", { title: draft.title, body: draft.body, color: draft.color, icon: draft.icon }));
  writer.resetAfterCopy(remote?.note ?? null, version);
  window.dispatchEvent(new CustomEvent("notebook:sticker-copy-saved", { detail: note.id }));
}
export function StickerSaveStatus({ writer }: { writer: StickerWriter }) {
  const snapshot = useSyncExternalStore(writer.subscribe, writer.getSnapshot, writer.getSnapshot);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  return <div className="sticker-save-status text-xs" role="status" aria-live="polite">
    {snapshot.status === "saving" ? "Сохранение…" : snapshot.status === "saved" ? "Сохранено" : <>
      <p>{snapshot.error || "Не удалось сохранить. Черновик остаётся доступен."}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded px-2 underline" onClick={() => void writer.flush().catch(() => undefined)}>Повторить сохранение стикера</button><button type="button" disabled={copying} className="min-h-11 rounded px-2 underline" onClick={() => { setCopying(true);setCopyError("");void saveStickerDraftCopy(writer).catch(() => setCopyError("Не удалось сохранить копию. Черновик остаётся здесь.")).finally(() => setCopying(false)); }}>Сохранить черновик копией</button></div>
      {copyError && <p>{copyError}</p>}
    </>}
  </div>;
}
