"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { DocumentTransitionQueue } from "@/lib/editor-save-queue";
import { closeDocumentTabs, EMPTY_TABS, mergeRestoredTabs, openDocumentTab, parseTabSession, pinDocumentTab, promoteDocumentTab, reorderDocumentTab, serializeTabSession, tabSessionKey, type DocumentTab, type TabState } from "@/lib/document-tabs";
import { getPageHref } from "@/lib/workspace-navigation";

export type DocumentHistory = "push" | "replace" | "none";
type Meta = { id: string; title: string };
type Options = {
  userId: string;
  storageKey?: string;
  excludeRestored?(): Set<string>;
  load(id: string, history: DocumentHistory, current: () => boolean, signal: AbortSignal): Promise<Meta | null>;
  flush(): Promise<void>;
  clear(): void;
  report(error: unknown): void;
  notice(message: string): void;
};
export function useDocumentTabs(options: Options) {
  const [state, setState] = useState<TabState>(EMPTY_TABS);
  const ref = useRef(state);const callbacks = useRef(options);
  useLayoutEffect(() => { callbacks.current = options; });
  const transitions = useRef(new DocumentTransitionQueue());
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const hydrated = useRef(false);
  const intent = useRef(0);
  const alive = useRef(true);
  const commit = useCallback((next: TabState) => {
    ref.current = next;setState(next);
    if (hydrated.current) try { localStorage.setItem(callbacks.current.storageKey ?? tabSessionKey(callbacks.current.userId), serializeTabSession(next)); } catch { callbacks.current.notice("Не удалось сохранить сессию вкладок в этом браузере"); }
  }, []);
  const title = useCallback((id: string, value: string) => setTitles(old => old[id] === value ? old : { ...old, [id]: value }), []);
  const run = useCallback(async (operation: (current: () => boolean, signal: AbortSignal) => Promise<boolean>) => {
    try {
      return await transitions.current.run(async (current, signal) => {
        setBusy(true);
        try { return await operation(current, signal); } finally { setBusy(false); }
      }) ?? false;
    } catch (error) {
      callbacks.current.report(error);
      const active = ref.current.activePageId;
      if (active) window.history.replaceState(null, "", getPageHref(active));
      return false;
    }
  }, []);
  const open = useCallback((id: string, mode: DocumentTab["mode"] = "preview", history: DocumentHistory = "push") => { intent.current++;return run(async (current, signal) => {
    if (ref.current.tabs.length >= 100 && !ref.current.tabs.some(t => t.pageId === id) && !(mode === "preview" && ref.current.tabs.some(t => t.mode === "preview"))) { callbacks.current.notice("Открыто 100 вкладок. Закройте ненужные документы перед открытием новых.");return false; }
    const meta = await callbacks.current.load(id, history, current, signal);
    if (!meta || !current()) return false;
    title(meta.id, meta.title);commit(openDocumentTab(ref.current, id, mode));return true;
  }); }, [commit, run, title]);
  const leave = useCallback((operation: () => void) => { intent.current++;return run(async current => {
    await callbacks.current.flush();if (!current()) return false;operation();return true;
  }); }, [run]);
  const close = useCallback((ids: string[], explicit = false) => { intent.current++;return run(async (current, signal) => {
    let next = closeDocumentTabs(ref.current, ids, explicit);
    if (next.activePageId !== ref.current.activePageId) {
      await callbacks.current.flush();if (!current()) return false;
      next = closeDocumentTabs(ref.current, ids, explicit);
      if (next.activePageId) {
        const meta = await callbacks.current.load(next.activePageId, "replace", current, signal);
        if (!meta || !current()) return false;title(meta.id, meta.title);
      } else callbacks.current.clear();
    }
    commit(next);return true;
  }); }, [commit, run, title]);
  const promote = useCallback((id: string) => commit(promoteDocumentTab(ref.current, id)), [commit]);
  const pin = useCallback((id: string) => commit(pinDocumentTab(ref.current, id)), [commit]);
  const reorder = useCallback((id: string, target: string) => commit(reorderDocumentTab(ref.current, id, target)), [commit]);
  const restore = useCallback(async (explicit: string | null, activate = true) => {
    if (hydrated.current) return;
    hydrated.current = true;
    const originalIntent = intent.current;
    let saved = EMPTY_TABS;
    try { saved = parseTabSession(localStorage.getItem(callbacks.current.storageKey ?? tabSessionKey(callbacks.current.userId))); } catch { /* Fresh session. */ }
    const excluded = callbacks.current.excludeRestored?.();
    if (excluded) saved = { ...saved, tabs: saved.tabs.filter(tab => !excluded.has(tab.pageId)), activePageId: saved.activePageId && !excluded.has(saved.activePageId) ? saved.activePageId : null };
    const available = new Set<string>();let missing = 0;let offline = false;
    const metaSchema = z.object({ page: z.object({ id: z.string(), title: z.string() }) });
    // Bound validation concurrency; no restored document content enters session state.
    const ids = [...new Set([...saved.tabs.map(t => t.pageId), ...(saved.activePageId ? [saved.activePageId] : [])])];
    for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async pageId => {
        try {
          const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`);
          if (response.status === 404) { missing++;return; }
          if (!response.ok) throw new Error("SESSION_VALIDATION_UNAVAILABLE");
          const { page } = metaSchema.parse(await response.json());available.add(pageId);title(page.id, page.title);
        } catch { available.add(pageId);offline = true; }
      }));
    }
    saved = { ...saved, tabs: saved.tabs.filter(t => available.has(t.pageId)) };
    if (!saved.activePageId || !available.has(saved.activePageId)) saved.activePageId = saved.tabs[0]?.pageId ?? null;
    if (!alive.current) return;
    if (originalIntent !== intent.current) { commit(mergeRestoredTabs(saved, ref.current));return; }
    commit(saved);
    if (missing) callbacks.current.notice(`${missing} недоступных вкладок исключено из сессии`);
    if (offline) callbacks.current.notice("Часть вкладок пока не проверена: повторите открытие после восстановления соединения");
    const id = explicit ?? saved.activePageId;
    if (id && activate) await open(id, saved.tabs.some(t => t.pageId === id) ? "permanent" : "preview", "replace");
  }, [commit, open, title]);
  useEffect(() => {
    alive.current = true;
    const dirty = (event: Event) => { const id = (event as CustomEvent<unknown>).detail;if (typeof id === "string") promote(id); };
    window.addEventListener("notebook:document-dirty", dirty);
    const queue = transitions.current;
    return () => { alive.current = false;queue.cancel();window.removeEventListener("notebook:document-dirty", dirty); };
  }, [promote]);
  return { ...state, titles, busy, open, close, leave, promote, pin, reorder, restore, title, replaceSession: commit, snapshot: () => ref.current,
    settle: async () => { transitions.current.cancel();await transitions.current.idle(); },
  };
}
