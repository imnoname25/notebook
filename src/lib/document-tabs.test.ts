import { describe, expect, it } from "vitest";
import { closeDocumentTabs, EMPTY_TABS, mergeRestoredTabs, openDocumentTab, parseTabSession, pinDocumentTab, promoteDocumentTab, reorderDocumentTab, serializeTabSession, tabSessionKey } from "./document-tabs";

describe("document tabs", () => {
  it("opens and replaces a single preview without duplicates", () => {
    const first = openDocumentTab(EMPTY_TABS, "a", "preview", 1);
    expect(first.tabs[0]?.mode).toBe("preview");
    const next = openDocumentTab(first, "b", "preview", 2);
    expect(next.tabs.map(t=>t.pageId)).toEqual(["b"]);
    expect(openDocumentTab(next,"b","preview",3).tabs).toHaveLength(1);
  });
  it("promotes on edit/double click and never demotes an existing permanent tab", () => {
    const state = promoteDocumentTab(openDocumentTab(EMPTY_TABS,"a","preview"),"a");
    expect(openDocumentTab(state,"a","preview").tabs[0]?.mode).toBe("permanent");
    expect(openDocumentTab(state,"b","preview").tabs.map(t=>t.pageId)).toEqual(["a","b"]);
  });
  it("opens modifiers/context-menu documents permanently", () => {
    const state = openDocumentTab(openDocumentTab(EMPTY_TABS,"a","preview"),"b","permanent");
    expect(state.tabs.map(t=>t.mode)).toEqual(["preview","permanent"]);
    expect(openDocumentTab(state,"a","permanent").tabs).toHaveLength(2);
  });
  it("pins before ordinary tabs and protects pins from bulk close", () => {
    let state = openDocumentTab(openDocumentTab(EMPTY_TABS,"a","permanent"),"b","preview");
    state = pinDocumentTab(state,"b");
    expect(state.tabs.map(t=>t.pageId)).toEqual(["b","a"]);
    expect(state.tabs[0]?.mode).toBe("permanent");
    expect(closeDocumentTabs(state,["a","b"]).tabs.map(t=>t.pageId)).toEqual(["b"]);
    expect(closeDocumentTabs(state,["a","b"],true).tabs).toEqual([]);
  });
  it("chooses the right neighbour, then the left neighbour, then none", () => {
    const state = ["a","b","c"].reduce((s,id)=>openDocumentTab(s,id,"permanent"),EMPTY_TABS);
    const middle = openDocumentTab(state,"b","preview");
    expect(closeDocumentTabs(middle,["b"]).activePageId).toBe("c");
    expect(closeDocumentTabs(state,["c"]).activePageId).toBe("b");
    expect(closeDocumentTabs(state,["a","b","c"]).activePageId).toBeNull();
  });
  it("restores permanent order, pinned state and active ID without content or titles", () => {
    let state = ["a","b","c"].reduce((s,id)=>openDocumentTab(s,id,"permanent"),EMPTY_TABS);
    state = pinDocumentTab(state,"b");state = reorderDocumentTab(state,"c","a");
    const raw = serializeTabSession(openDocumentTab(state,"temporary","preview"));
    const restored = parseTabSession(raw);
    expect(restored.tabs.map(t=>t.pageId)).toEqual(["b","c","a"]);
    expect(restored.tabs[0]?.pinned).toBe(true);
    expect(restored.activePageId).toBe("temporary");
    expect(Object.keys(JSON.parse(raw).tabs[0])).toEqual(["pageId","mode","pinned","openedAt","lastActivatedAt"]);
  });
  it("keeps pinned and ordinary reorder groups separate", () => {
    let state = openDocumentTab(openDocumentTab(EMPTY_TABS,"a","permanent"),"b","permanent");state=pinDocumentTab(state,"a");
    expect(reorderDocumentTab(state,"b","a")).toBe(state);
  });
  it.each([null,"{}","bad",'{"version":2,"tabs":[]}'])("rejects invalid sessions %s", raw => expect(parseTabSession(raw)).toEqual(EMPTY_TABS));
  it("scopes sessions by account", () => expect(tabSessionKey("first")).not.toBe(tabSessionKey("second")));
  it("retains just the ID of the last active preview, without restoring it as permanent", () => {
    const restored = parseTabSession(serializeTabSession(openDocumentTab(EMPTY_TABS,"last-preview","preview")));
    expect(restored.tabs).toEqual([]);expect(restored.activePageId).toBe("last-preview");
  });
  it("merges background restoration without losing the user's newer selection or duplicating IDs", () => {
    const saved = openDocumentTab(openDocumentTab(EMPTY_TABS,"a","permanent"),"b","permanent");
    const current = pinDocumentTab(openDocumentTab(openDocumentTab(EMPTY_TABS,"b","permanent"),"c","preview"),"b");
    const merged = mergeRestoredTabs(saved,current);
    expect(merged.activePageId).toBe("c");expect(merged.tabs.map(t=>t.pageId)).toEqual(["b","a","c"]);expect(merged.tabs[0]?.pinned).toBe(true);
  });
});
