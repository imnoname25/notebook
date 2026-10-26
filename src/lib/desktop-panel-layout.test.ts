import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_PREFERENCES, MIN_EDITOR_WIDTH, PANEL_LIMITS, panelLayoutKey, parsePanelPreferences, resizePanel, resolvePanelWidths, serializePanelPreferences } from "./desktop-panel-layout";

describe("desktop panel geometry", () => {
  it.each([1200, 1280, 1440, 1920, 2560])("keeps the editor usable at %s px", width => {
    const result = resolvePanelWidths({ sidebar: 420, list: 520 }, width);
    expect(width - result.sidebar - result.list).toBeGreaterThanOrEqual(MIN_EDITOR_WIDTH);
    expect(result.sidebar).toBeGreaterThanOrEqual(PANEL_LIMITS.sidebar.min);
    expect(result.list).toBeGreaterThanOrEqual(PANEL_LIMITS.list.min);
  });
  it("clamps a dragged panel without resizing its visible neighbour", () => {
    expect(resizePanel("sidebar", 900, { sidebar: 240, list: 400 }, 1280)).toEqual({ sidebar: 400, list: 400 });
    expect(resizePanel("list", -5, { sidebar: 240, list: 400 }, 1280)).toEqual({ sidebar: 240, list: 220 });
  });
  it("restores wide-screen preferences after a temporary smaller viewport", () => {
    const preferences = { sidebar: 420, list: 520 };
    expect(resolvePanelWidths(preferences, 1280)).toEqual({ sidebar: 420, list: 380 });
    expect(resolvePanelWidths(preferences, 1920)).toEqual(preferences);
    expect(preferences).toEqual({ sidebar: 420, list: 520 });
  });
  it("round-trips defaults and user-specific widths only", () => {
    expect(parsePanelPreferences(serializePanelPreferences(DEFAULT_PANEL_PREFERENCES))).toEqual(DEFAULT_PANEL_PREFERENCES);
    expect(parsePanelPreferences(serializePanelPreferences({ sidebar: 300, list: 440 }))).toEqual({ sidebar: 300, list: 440 });
    expect(panelLayoutKey("one")).not.toBe(panelLayoutKey("two"));
    expect(Object.keys(JSON.parse(serializePanelPreferences({ sidebar: 300, list: 440 })))).toEqual(["version", "sidebar", "list"]);
  });
  it("handles corrupt or out-of-range local data", () => {
    expect(parsePanelPreferences('{"version":1,"sidebar":"300px","list":250}')).toEqual(DEFAULT_PANEL_PREFERENCES);
    expect(parsePanelPreferences('{"version":1,"sidebar":-200,"list":99999}')).toEqual({ sidebar: 190, list: 520 });
    expect(parsePanelPreferences("not JSON")).toEqual(DEFAULT_PANEL_PREFERENCES);
  });
});
