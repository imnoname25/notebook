import { z } from "zod";

export const DESKTOP_PANELS_BREAKPOINT = 1200;
export const MIN_EDITOR_WIDTH = 480;
export const PANEL_LIMITS = { sidebar: { min: 190, max: 420 }, list: { min: 220, max: 520 } } as const;
export const RESET_DESKTOP_PANELS = "notebook:reset-desktop-panels";
export type Panel = keyof typeof PANEL_LIMITS;
export type PanelWidths = { sidebar: number; list: number };
export type PanelPreferences = { sidebar: number | null; list: number | null };
export const DEFAULT_PANEL_PREFERENCES: PanelPreferences = { sidebar: null, list: null };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const schema = z.object({ version: z.literal(1), sidebar: z.number().finite().nullable(), list: z.number().finite().nullable() });
export const panelLayoutKey = (userId: string) => `notebook:desktop-panels:v1:${encodeURIComponent(userId)}`;

export function defaultPanelWidths(width: number): PanelWidths {
  return width < 1280 ? { sidebar: 192, list: 248 } : { sidebar: Math.round(clamp(width * 0.16, 192, 240)), list: Math.round(clamp(width * 0.21, 240, 320)) };
}
export function resolvePanelWidths(preferences: PanelPreferences, width: number): PanelWidths {
  const defaults = defaultPanelWidths(width);
  const sidebar = clamp(preferences.sidebar ?? defaults.sidebar, PANEL_LIMITS.sidebar.min, PANEL_LIMITS.sidebar.max);
  const list = clamp(preferences.list ?? defaults.list, PANEL_LIMITS.list.min, PANEL_LIMITS.list.max);
  const budget = Math.max(DESKTOP_PANELS_BREAKPOINT, width) - MIN_EDITOR_WIDTH;
  const fittedList = Math.max(PANEL_LIMITS.list.min, Math.min(list, budget - sidebar));
  return { sidebar: Math.round(Math.min(sidebar, budget - fittedList)), list: Math.round(fittedList) };
}
export function panelMaximum(panel: Panel, widths: PanelWidths, width: number) {
  const other = panel === "sidebar" ? widths.list : widths.sidebar;
  return Math.min(PANEL_LIMITS[panel].max, Math.max(PANEL_LIMITS[panel].min, width - MIN_EDITOR_WIDTH - other));
}
export function resizePanel(panel: Panel, requested: number, actual: PanelWidths, width: number): PanelWidths {
  return { ...actual, [panel]: Math.round(clamp(requested, PANEL_LIMITS[panel].min, panelMaximum(panel, actual, width))) };
}
export function parsePanelPreferences(raw: string | null): PanelPreferences {
  try {
    const parsed = schema.parse(JSON.parse(raw ?? "null"));
    return Object.fromEntries((["sidebar", "list"] as const).map(panel => [panel, parsed[panel] === null ? null : Math.round(clamp(parsed[panel], PANEL_LIMITS[panel].min, PANEL_LIMITS[panel].max))])) as PanelPreferences;
  } catch { return { ...DEFAULT_PANEL_PREFERENCES }; }
}
export function serializePanelPreferences(preferences: PanelPreferences) {
  return JSON.stringify({ version: 1, sidebar: preferences.sidebar, list: preferences.list });
}
