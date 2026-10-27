"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { MAX_DOCUMENT_MATCHES, textMatches, type DocumentSearchRequest } from "@/lib/document-search";
import { documentSearchKey, SEARCH_MATCH_EVENT, type DocumentMatchState } from "./document-search-extension";

export function useDocumentSearch(editor: Pick<BlockNoteEditor, "prosemirrorView">, title: string, request: DocumentSearchRequest | null | undefined, onClose: () => void, root: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<DocumentMatchState | null>(null);
  const [titleIndex, setTitleIndex] = useState(0);
  const alive = useRef(false);
  const titleMatches = useMemo(() => textMatches(title, state?.query ?? "", false), [title, state?.query]);
  useEffect(() => {
    alive.current = true;let frame = 0;let remove = () => {};
    const activate = () => {
      const view = editor.prosemirrorView;
      if (!view.dom.isConnected) { frame = requestAnimationFrame(activate);return; }
      const update = () => { if (alive.current) setState(documentSearchKey.getState(view.state) ?? null); };
      view.dom.addEventListener(SEARCH_MATCH_EVENT, update);remove = () => view.dom.removeEventListener(SEARCH_MATCH_EVENT, update);
      view.dispatch(view.state.tr.setMeta(documentSearchKey, { query: request?.query ?? "", snippet: request?.snippet ?? "" }).setMeta("addToHistory", false));
      update();
    };
    frame = requestAnimationFrame(activate);
    return () => { alive.current = false;cancelAnimationFrame(frame);remove(); };
  }, [editor, request]);
  const active = state?.active ?? -1;
  useEffect(() => {
    if (active < 0 || !state?.matches.length) return;
    // Wait for both the decoration and its revealed ancestors to reach the DOM.
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(".notebook-search-current")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center", inline: "nearest" });
    }); });
    return () => { cancelAnimationFrame(first);cancelAnimationFrame(second); };
  }, [active, state?.matches, root]);
  const total = titleMatches.length + (state?.matches.length ?? 0);
  const index = active >= 0 ? titleMatches.length + active : Math.min(titleIndex, Math.max(0, titleMatches.length - 1));
  function close() {
    const view = editor.prosemirrorView;
    view.dispatch(view.state.tr.setMeta(documentSearchKey, { query: "" }).setMeta("addToHistory", false));onClose();
  }
  function move(direction: number) {
    if (!total) return;
    const next = (index + direction + total) % total;
    setTitleIndex(next < titleMatches.length ? next : 0);
    const view = editor.prosemirrorView;
    view.dispatch(view.state.tr.setMeta(documentSearchKey, { active: next < titleMatches.length ? -1 : next - titleMatches.length }).setMeta("addToHistory", false));
  }
  const toolbar = state?.query ? <div className="document-match-navigator notebook-no-print" role="region" aria-label="Совпадения в документе">
    <span role="status" aria-live="polite">{total ? `Совпадение ${index + 1} из ${total}${(state.matches.length >= MAX_DOCUMENT_MATCHES || titleMatches.length >= MAX_DOCUMENT_MATCHES) ? "+" : ""}` : "Совпадение больше не найдено"}</span>
    <button type="button" aria-label="Предыдущее совпадение" disabled={!total} onClick={() => move(-1)}><ArrowUp size={16}/></button>
    <button type="button" aria-label="Следующее совпадение" disabled={!total} onClick={() => move(1)}><ArrowDown size={16}/></button>
    <button type="button" aria-label="Закрыть совпадения" onClick={close}><X size={16}/></button>
  </div> : null;
  return { toolbar, titleMatches, enabled: Boolean(state?.query), titleActive: active < 0 ? index : -1 };
}
