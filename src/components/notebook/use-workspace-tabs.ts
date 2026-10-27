"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { EMPTY_TABS, parseTabSession, tabSessionKey, type DocumentTab } from "@/lib/document-tabs";
import { DEFAULT_SPLIT, mergePaneTabs, otherPane, splitPreferenceKey, splitPreferenceSchema, type WorkspacePaneId } from "@/lib/split-workspace";
import { getPageHref } from "@/lib/workspace-navigation";
import { useDocumentTabs, type DocumentHistory } from "./use-document-tabs";
import type { EditorSaveController, PageDocument } from "./types";

type Options = { userId: string; load(pane: WorkspacePaneId, id: string, history: DocumentHistory, current: () => boolean, preloaded?: PageDocument): Promise<PageDocument | null>; present(page: PageDocument | null): void; onController(value: EditorSaveController | null): void; report(error: unknown): void; notice(message: string): void };
export function useWorkspaceTabs(options: Options) {
  const callbacks = useRef(options);useLayoutEffect(() => { callbacks.current = options; });
  const [documents, setDocuments] = useState<Record<WorkspacePaneId, PageDocument | null>>({ left: null, right: null });
  const docs = useRef(documents);const controllers = useRef(new Map<string, EditorSaveController>());
  const [layout, setLayout] = useState<{ split: boolean; active: WorkspacePaneId; ratio: number }>(DEFAULT_SPLIT);
  const layoutRef = useRef(layout);const hydrated = useRef(false);const transaction = useRef(false);
  const [busy, setBusy] = useState(false);const [epochs, setEpochs] = useState<Record<string, number>>({});
  const staged = useRef(new Map<string, PageDocument>());
  const pendingOwners = useRef(new Map<string, { pane: WorkspacePaneId; count: number }>());
  const raw = useRef<Record<WorkspacePaneId, ReturnType<typeof useDocumentTabs>> | null>(null);
  const persist = useCallback((next: typeof layout) => {
    layoutRef.current = next;setLayout(next);
    if (hydrated.current) try { localStorage.setItem(splitPreferenceKey(callbacks.current.userId), JSON.stringify(next)); } catch { callbacks.current.notice("Не удалось сохранить компоновку рабочего пространства"); }
  }, []);
  const editor = useCallback((pane: WorkspacePaneId) => { const id = docs.current[pane]?.id;return id ? controllers.current.get(id) : undefined; }, []);
  const accept = useCallback((pane: WorkspacePaneId, page: PageDocument | null) => {
    docs.current = { ...docs.current, [pane]: page };
    if (!transaction.current) { setDocuments(docs.current);if (layoutRef.current.active === pane) callbacks.current.present(page); }
  }, []);
  const register = useCallback((id: string, controller: EditorSaveController | null) => {
    if (controller) controllers.current.set(id, controller);else controllers.current.delete(id);
    if (docs.current[layoutRef.current.active]?.id === id) callbacks.current.onController(controller);
  }, []);
  const focus = useCallback((pane: WorkspacePaneId, history: DocumentHistory = "replace") => {
    if (transaction.current) return;
    persist({ ...layoutRef.current, active: pane });callbacks.current.present(docs.current[pane]);callbacks.current.onController(editor(pane) ?? null);
    const href = docs.current[pane] ? getPageHref(docs.current[pane]!.id) : "/app";
    if (history !== "none" && `${location.pathname}${location.search}` !== href) window.history[history === "push" ? "pushState" : "replaceState"](null, "", href);
  }, [editor, persist]);
  const load = useCallback(async (pane: WorkspacePaneId, id: string, history: DocumentHistory, current: () => boolean) => {
    const page = await callbacks.current.load(pane, id, history, current, staged.current.get(id));
    staged.current.delete(id);return page;
  }, []);
  const left = useDocumentTabs({ userId: options.userId, load: (id, history, current) => load("left", id, history, current), flush: async () => { await editor("left")?.flush(false); }, clear: () => accept("left", null), report: options.report, notice: options.notice });
  const right = useDocumentTabs({ userId: options.userId, storageKey: `${tabSessionKey(options.userId)}:right`, excludeRestored: () => new Set(raw.current?.left.snapshot().tabs.map(tab => tab.pageId)), load: (id, history, current) => load("right", id, history, current), flush: async () => { await editor("right")?.flush(false); }, clear: () => accept("right", null), report: options.report, notice: options.notice });
  useLayoutEffect(() => { raw.current = { left, right }; });
  const owner = useCallback((id: string) => (["left", "right"] as const).find(pane => raw.current?.[pane].snapshot().tabs.some(tab => tab.pageId === id) || docs.current[pane]?.id === id) ?? pendingOwners.current.get(id)?.pane, []);
  const open = useCallback(async (id: string, mode: DocumentTab["mode"] = "preview", history: DocumentHistory = "push", pane?: WorkspacePaneId) => {
    if (transaction.current) return false;
    const target = owner(id) ?? pane ?? layoutRef.current.active;
    const count = new Set([...(raw.current?.left.snapshot().tabs ?? []), ...(raw.current?.right.snapshot().tabs ?? [])].map(tab => tab.pageId)).size;
    if (!owner(id) && count >= 100 && !(mode === "preview" && raw.current![target].snapshot().tabs.some(tab => tab.mode === "preview"))) { callbacks.current.notice("Открыто 100 документов. Закройте ненужную вкладку.");return false; }
    const reservation = pendingOwners.current.get(id) ?? { pane: target, count: 0 };
    reservation.count++;pendingOwners.current.set(id, reservation);
    try { const opened = await raw.current![target].open(id, mode, history);if (opened) focus(target, history);return opened; }
    finally { if (--reservation.count === 0) pendingOwners.current.delete(id); }
  }, [focus, owner]);
  const flushAll = useCallback(async () => {
    const results = await Promise.allSettled([...controllers.current.values()].map(controller => controller.flush(false)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");if (failure) throw failure.reason;
  }, []);
  const atomic = useCallback(async (operation: () => Promise<void>, present = true) => {
    if (transaction.current) return false;
    transaction.current = true;setBusy(true);
    try { await Promise.all([raw.current!.left.settle(), raw.current!.right.settle()]);await operation();return true; } catch (error) { callbacks.current.report(error);return false; }
    finally { transaction.current = false;setBusy(false);setDocuments(docs.current);if (present) callbacks.current.present(docs.current[layoutRef.current.active]);callbacks.current.onController(editor(layoutRef.current.active) ?? null); }
  }, [editor]);
  const leave = useCallback((operation: () => void) => atomic(async () => { await flushAll();operation(); }, false), [atomic, flushAll]);
  const transfer = useCallback((id: string, target: WorkspacePaneId) => atomic(async () => {
    const source = owner(id);if (!source || source === target) return;
    const oldSource = raw.current![source].snapshot();const oldDoc = docs.current[source];
    if (oldSource.activePageId === id) await editor(source)?.flush(false);
    await editor(target)?.flush(false);
    const page = docs.current[source]?.id === id ? docs.current[source]! : (await api<{ page: PageDocument }>(`/api/pages/${encodeURIComponent(id)}`)).page;
    staged.current.set(id, page);
    if (!await raw.current![source].close([id], true)) { staged.current.delete(id);throw new Error("Не удалось перенести вкладку: исходная панель сохранена"); }
    if (!await raw.current![target].open(id, "permanent", "replace")) {
      raw.current![source].replaceSession(oldSource);docs.current = { ...docs.current, [source]: oldDoc };throw new Error("Перенос отменён, исходная вкладка восстановлена");
    }
    persist({ ...layoutRef.current, split: true, active: target });window.history.replaceState(null, "", getPageHref(id));
  }), [atomic, editor, owner, persist]);
  const closeSplit = useCallback(() => atomic(async () => {
    const requested = layoutRef.current.active;const keep = docs.current[requested] ? requested : otherPane(requested);const remove = otherPane(keep);
    await editor(remove)?.flush(false);
    const merged = mergePaneTabs(raw.current![keep].snapshot(), raw.current![remove].snapshot());
    raw.current!.left.replaceSession(merged);raw.current!.right.replaceSession(EMPTY_TABS);
    for (const [id, title] of Object.entries(raw.current!.right.titles)) raw.current!.left.title(id, title);
    docs.current = { left: docs.current[keep], right: null };
    persist({ ...layoutRef.current, split: false, active: "left" });
    if (docs.current.left) window.history.replaceState(null, "", getPageHref(docs.current.left.id));
  }), [atomic, editor, persist]);
  const restore = useCallback(async (explicit: string | null, activate = true) => {
    if (hydrated.current) return;hydrated.current = true;
    let next: typeof layout = DEFAULT_SPLIT;
    try { const parsed = splitPreferenceSchema.safeParse(JSON.parse(localStorage.getItem(splitPreferenceKey(callbacks.current.userId)) ?? "null"));if (parsed.success) next = parsed.data; } catch { /* Fresh workspace. */ }
    if (explicit) {
      const ownedRight = parseTabSession(localStorage.getItem(`${tabSessionKey(callbacks.current.userId)}:right`)).tabs.some(tab => tab.pageId === explicit);
      next = { ...next, active: ownedRight ? "right" : "left" };
    }
    persist(next);
    await atomic(async () => {
      await raw.current!.left.restore(next.active === "left" ? explicit : null, activate && (next.split || next.active === "left"));
      await raw.current!.right.restore(next.active === "right" ? explicit : null, activate && (next.split || next.active === "right"));
      if (!next.split) { const target = raw.current![next.active];target.replaceSession(mergePaneTabs(target.snapshot(), raw.current![otherPane(next.active)].snapshot()));raw.current![otherPane(next.active)].replaceSession(EMPTY_TABS); }
    }, activate);
  }, [atomic, persist]);
  const updatePage = useCallback((page: PageDocument) => {
    for (const pane of ["left", "right"] as const) if (docs.current[pane]?.id === page.id) docs.current = { ...docs.current, [pane]: page };
    setDocuments(docs.current);raw.current?.left.title(page.id, page.title);raw.current?.right.title(page.id, page.title);
  }, []);
  const syncActive = useCallback((page: PageDocument | null) => {
    if (transaction.current || docs.current[layoutRef.current.active] === page) return;
    const other = otherPane(layoutRef.current.active);
    if (page && docs.current[other]?.id === page.id) { docs.current = { ...docs.current, [other]: page };setDocuments(docs.current);focus(other);return; }
    docs.current = { ...docs.current, [layoutRef.current.active]: page };setDocuments(docs.current);
  }, [focus]);
  return { ...layout, documents, docs, activeRef: layoutRef, transaction, busy, epochs, left, right, editor, accept, register, focus, open, owner, restore, leave, flushAll, transfer, closeSplit, updatePage, syncActive,
    enable() { persist({ ...layoutRef.current, split: true });focus(otherPane(layoutRef.current.active)); },
    setRatio(value: number) { persist({ ...layoutRef.current, ratio: Math.max(0.2, Math.min(0.8, value)) }); },
    refresh(id: string) { setEpochs(old => ({ ...old, [id]: (old[id] ?? 0) + 1 })); },
    editorFor(id: string) { return controllers.current.get(id); },
    async close(ids: string[], explicit = false) { if (transaction.current) return false;const results = await Promise.all((['left', 'right'] as const).map(pane => raw.current![pane].close(ids.filter(id => owner(id) === pane), explicit)));return results.every(Boolean); },
    controller(pane: WorkspacePaneId) { const controller = pane === "left" ? left : right;return { ...controller, open: (id: string, mode?: DocumentTab["mode"], history?: DocumentHistory) => open(id, mode, history, pane), close: async (ids: string[], explicit = false) => !transaction.current && await controller.close(ids, explicit) }; },
  };
}
