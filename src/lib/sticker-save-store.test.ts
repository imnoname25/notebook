import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickNote } from "./quick-note";
import { StickerSaveStore, StickerWriter, type StickerTransport } from "./sticker-save-store";

const note: QuickNote = { id: "sticker", title: "Old", body: "- [ ] Task", color: "amber", icon: null, isPinned: false, sortOrder: 0, status: "INBOX", archivedAt: null, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", tags: [] };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });
describe("one ordered sticker writer", () => {
  it("coalesces title and body instead of letting one field cancel the other", async () => {
    const send = vi.fn<StickerTransport>(async (_id, patch, base) => ({ ...base, ...patch }));
    const writer = new StickerWriter(note, send, vi.fn());
    writer.update({ title: "New title" });writer.update({ body: "- [x] Task" });
    await writer.flush();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1]).toEqual({ title: "New title", body: "- [x] Task" });
    expect(writer.getSnapshot()).toMatchObject({ status: "saved", dirty: false, note: { title: "New title", body: "- [x] Task" } });
  });
  it("does not apply an older response over rapid toggles and newer text", async () => {
    let finish!: (value: QuickNote) => void;
    const send = vi.fn<StickerTransport>().mockImplementationOnce(() => new Promise<QuickNote>(resolve => { finish = resolve; })).mockImplementation(async (_id, patch, base) => ({ ...base, ...patch }));
    const writer = new StickerWriter(note, send, vi.fn());
    writer.update({ body: "- [x] Task" });
    const flushing = writer.flush();await Promise.resolve();await Promise.resolve();
    writer.update({ body: "- [ ] Changed text\n- [x] Second" });writer.update({ title: "Also changed" });
    finish({ ...note, body: "- [x] Task" });await flushing;
    expect(send.mock.calls[1]![2].body).toBe("- [x] Task");
    expect(writer.getSnapshot().note).toMatchObject({ title: "Also changed", body: "- [ ] Changed text\n- [x] Second" });
    expect(writer.getSnapshot().dirty).toBe(false);
  });
  it("keeps the draft after failure, ignores stale reloads and permits retry", async () => {
    const send = vi.fn<StickerTransport>().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_id, patch, base) => ({ ...base, ...patch }));
    const error = vi.fn();const writer = new StickerWriter(note, send, error);
    writer.update({ body: "retained text" });await expect(writer.flush()).rejects.toThrow("offline");
    writer.accept({ ...note, updatedAt: "2099-01-01T00:00:00Z", body: "remote" });
    expect(writer.getSnapshot()).toMatchObject({ dirty: true, status: "error", note: { body: "retained text" } });
    await writer.flush();expect(writer.getSnapshot()).toMatchObject({ dirty: false, status: "saved" });expect(error).toHaveBeenCalledOnce();
  });
  it("shares a writer across screens but never across account stores", async () => {
    const send = vi.fn<StickerTransport>(async (_id, patch, base) => ({ ...base, ...patch }));
    const one = new StickerSaveStore(send), two = new StickerSaveStore(send);
    const writer = one.writer(note);writer.update({ body: "pending across navigation" });
    expect(one.writer(note)).toBe(writer);expect(two.writer(note).getSnapshot().note.body).toBe(note.body);
    await one.flushAll();expect(one.isDirty()).toBe(false);
    writer.accept(note);expect(writer.getSnapshot().note.body).toBe("pending across navigation");
  });
  it("does not discard edits typed while a recovery copy is being saved", () => {
    const writer = new StickerWriter(note, vi.fn(), vi.fn());
    writer.update({ body: "copy snapshot" });const version = writer.version();
    writer.update({ body: "newer draft" });writer.resetAfterCopy(note, version);
    expect(writer.getSnapshot()).toMatchObject({ dirty: true, note: { body: "newer draft" } });
  });
});
