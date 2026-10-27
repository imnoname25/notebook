import { describe, expect, it } from "vitest";
import { EMPTY_TABS, openDocumentTab, pinDocumentTab } from "./document-tabs";
import { DEFAULT_SPLIT, mergePaneTabs, otherPane, splitPreferenceKey, splitPreferenceSchema } from "./split-workspace";
import { DocumentTransitionQueue, EditorSaveQueue } from "./editor-save-queue";

describe("split workspace metadata", () => {
  it("waits for a cancelled document transition before changing the layout", async () => {
    const queue = new DocumentTransitionQueue();let complete!: () => void;let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = queue.run(async current => { started();await new Promise<void>(resolve => { complete = resolve; });return current(); });
    await ready;queue.cancel();let settled = false;const idle = queue.idle().then(() => { settled = true; });
    await Promise.resolve();expect(settled).toBe(false);complete();await idle;expect(await pending).toBe(false);
  });
  it("merges panes without duplicate documents and preserves the retained active tab", () => {
    const left = openDocumentTab(EMPTY_TABS, "a", "permanent", 1);
    const right = openDocumentTab(openDocumentTab(EMPTY_TABS, "a", "permanent", 2), "b", "preview", 3);
    const merged = mergePaneTabs(left, right);
    expect(merged.tabs.map(tab => tab.pageId)).toEqual(["a", "b"]);expect(merged.activePageId).toBe("a");expect(merged.tabs[1]!.mode).toBe("permanent");
  });
  it("retains pinned grouping and an active fallback when the selected pane is empty", () => {
    const source = pinDocumentTab(openDocumentTab(EMPTY_TABS, "b", "permanent", 1), "b");
    const merged = mergePaneTabs(EMPTY_TABS, source);
    expect(merged.activePageId).toBe("b");expect(merged.tabs[0]!.pinned).toBe(true);
  });
  it("validates layout metadata and isolates account keys", () => {
    expect(splitPreferenceSchema.parse(DEFAULT_SPLIT)).toEqual(DEFAULT_SPLIT);
    expect(splitPreferenceKey("one")).not.toBe(splitPreferenceKey("two"));
    expect(splitPreferenceSchema.safeParse({ split: true, active: "third", ratio: 0.5 }).success).toBe(false);
    expect(splitPreferenceSchema.safeParse({ split: true, active: "left", ratio: Infinity }).success).toBe(false);
    expect(otherPane(otherPane("left"))).toBe("left");
  });
  it("a failed writer cannot consume or block the other document's changes", async () => {
    const received: string[] = [];let online = false;
    const a = new EditorSaveQueue("original A", async value => { if (!online) throw new Error("offline A");received.push(`A:${value}`); }, () => {});
    const b = new EditorSaveQueue("original B", async value => { received.push(`B:${value}`); }, () => {});
    a.update("pending A");b.update("pending B");const results = await Promise.allSettled([a.flush(), b.flush()]);
    expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);expect(a.isDirty()).toBe(true);expect(b.isDirty()).toBe(false);
    online = true;await a.flush();expect(received).toEqual(["B:pending B", "A:pending A"]);
  });
});
