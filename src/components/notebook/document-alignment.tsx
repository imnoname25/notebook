"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { DOCUMENT_ALIGNMENT_KEY, resolveDocumentAlignment, type DocumentAlignment } from "@/lib/document-alignment";

const CHANGE_EVENT = "notebook:document-alignment-changed";
let fallback: DocumentAlignment | null = null;
function snapshot() {
  if (fallback !== null) return fallback;
  try { return resolveDocumentAlignment(localStorage.getItem(DOCUMENT_ALIGNMENT_KEY)); }
  catch { return "left" as const; }
}
function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === DOCUMENT_ALIGNMENT_KEY) {
      fallback = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
export function useDocumentAlignment() {
  return useSyncExternalStore(subscribe, snapshot, () => "left" as const);
}
function setAlignment(value: string) {
  const alignment = resolveDocumentAlignment(value);
  try { localStorage.setItem(DOCUMENT_ALIGNMENT_KEY, alignment); fallback = null; }
  catch { fallback = alignment; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function DocumentAlignmentSettings() {
  const value = useDocumentAlignment();
  const { resolvedTheme } = useTheme();
  if (resolvedTheme !== "studio-graphite" && resolvedTheme !== "studio-atelier") return null;
  return <label className="block text-sm">
    <span className="mb-1.5 block text-muted-foreground">Выравнивание документа</span>
    <select className="input" value={value} onChange={(event) => setAlignment(event.target.value)}>
      <option value="left">Слева</option><option value="center">По центру</option>
    </select>
    <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">Для тем Studio. Сохраняется в этом браузере и применяется сразу. В режиме фокуса документ центрируется.</span>
  </label>;
}
