import { z } from "zod";
import type { TabState } from "./document-tabs";
export type WorkspacePaneId = "left" | "right";
export const otherPane = (pane: WorkspacePaneId): WorkspacePaneId => pane === "left" ? "right" : "left";
export const splitPreferenceKey = (userId: string) => `notebook:split-workspace:v1:${encodeURIComponent(userId)}`;
export const splitPreferenceSchema = z.object({ split: z.boolean(), active: z.enum(["left", "right"]), ratio: z.number().finite().min(0.2).max(0.8) });
export const DEFAULT_SPLIT = { split: false, active: "left", ratio: 0.5 } as const;
export function mergePaneTabs(first: TabState, second: TabState): TabState {
  const seen = new Set(first.tabs.map(tab => tab.pageId));
  const tabs = [...first.tabs, ...second.tabs.filter(tab => !seen.has(tab.pageId)).map(tab => ({ ...tab, mode: "permanent" as const }))];
  return { tabs: [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)], activePageId: first.activePageId ?? second.activePageId };
}
