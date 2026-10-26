import { z } from "zod";

export const tabSchema = z.object({
  pageId: z.string().min(1).max(200), mode: z.enum(["preview", "permanent"]), pinned: z.boolean(),
  openedAt: z.number().finite().nonnegative(), lastActivatedAt: z.number().finite().nonnegative(),
});
export type DocumentTab = z.infer<typeof tabSchema>;
export type TabState = { tabs: DocumentTab[]; activePageId: string | null };
export const EMPTY_TABS: TabState = { tabs: [], activePageId: null };
const sessionSchema = z.object({ version: z.literal(1), tabs: z.array(tabSchema).max(100), activePageId: z.string().max(200).nullable() });
export const tabSessionKey = (userId: string) => `notebook:document-tabs:v1:${encodeURIComponent(userId)}`;
function ordered(tabs: DocumentTab[]) { return [...tabs.filter(t => t.pinned), ...tabs.filter(t => !t.pinned)]; }
export function openDocumentTab(state: TabState, pageId: string, mode: DocumentTab["mode"], now = Date.now()): TabState {
  now = Math.max(now, ...state.tabs.map(t => t.lastActivatedAt + 1));
  const existing = state.tabs.find(t => t.pageId === pageId);
  const tabs = existing ? state.tabs.map(t => t.pageId === pageId ? { ...t, mode: mode === "permanent" ? mode : t.mode, lastActivatedAt: now } : t)
    : [...state.tabs.filter(t => mode !== "preview" || t.mode !== "preview"), { pageId, mode, pinned: false, openedAt: now, lastActivatedAt: now }];
  return { tabs: ordered(tabs), activePageId: pageId };
}
export function promoteDocumentTab(state: TabState, pageId: string): TabState {
  return { ...state, tabs: state.tabs.map(t => t.pageId === pageId ? { ...t, mode: "permanent" } : t) };
}
export function pinDocumentTab(state: TabState, pageId: string): TabState {
  return { ...state, tabs: ordered(state.tabs.map(t => t.pageId === pageId ? { ...t, mode: "permanent", pinned: !t.pinned } : t)) };
}
export function closeDocumentTabs(state: TabState, ids: string[], explicit = false): TabState {
  const removed = new Set(ids);
  const tabs = state.tabs.filter(t => !removed.has(t.pageId) || (t.pinned && !explicit));
  if (tabs.some(t => t.pageId === state.activePageId)) return { ...state, tabs };
  const oldIndex = state.tabs.findIndex(t => t.pageId === state.activePageId);
  return { tabs, activePageId: tabs[Math.min(Math.max(oldIndex, 0), tabs.length - 1)]?.pageId ?? null };
}
export function reorderDocumentTab(state: TabState, pageId: string, targetId: string): TabState {
  const tabs = [...state.tabs];const from = tabs.findIndex(t => t.pageId === pageId);const to = tabs.findIndex(t => t.pageId === targetId);
  if (from < 0 || to < 0 || tabs[from]!.pinned !== tabs[to]!.pinned) return state;
  const [tab] = tabs.splice(from, 1);tabs.splice(to, 0, tab!);return { ...state, tabs };
}
export function serializeTabSession(state: TabState) {
  const tabs = state.tabs.filter(t => t.mode === "permanent");
  const activePageId = state.activePageId;
  return JSON.stringify({ version: 1, tabs, activePageId });
}
export function parseTabSession(raw: string | null): TabState {
  try {
    const data = sessionSchema.parse(JSON.parse(raw ?? "null"));const seen = new Set<string>();
    const tabs = ordered(data.tabs.filter(t => t.mode === "permanent" && !seen.has(t.pageId) && Boolean(seen.add(t.pageId))));
    return { tabs, activePageId: data.activePageId ?? tabs[0]?.pageId ?? null };
  } catch { return EMPTY_TABS; }
}
export function mergeRestoredTabs(saved: TabState, current: TabState): TabState {
  const ids = new Set(current.tabs.map(t => t.pageId));
  const restored = saved.tabs.filter(t => !ids.has(t.pageId)).slice(0, Math.max(0, 100-current.tabs.length));
  return { tabs: ordered([...restored, ...current.tabs]), activePageId: current.activePageId };
}
