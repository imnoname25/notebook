import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owned: vi.fn(), update: vi.fn(), read: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { quickNote: { findFirst: mocks.owned }, $transaction: (run: (tx: unknown) => unknown) => run({ quickNote: { updateMany: mocks.update, findFirst: mocks.owned, findUniqueOrThrow: mocks.read } }) } }));
vi.mock("@/lib/services/tag-service", () => ({ syncQuickNoteTags: mocks.sync, syncPageTags: vi.fn() }));
import { getQuickNote, updateQuickNote } from "./quick-note-service";

describe("conditional sticker saves", () => {
  beforeEach(() => { vi.clearAllMocks();mocks.owned.mockResolvedValue({ id: "n" });mocks.update.mockResolvedValue({ count: 1 });mocks.read.mockResolvedValue({ id: "n", title: "Note", body: "- [x] Task #tag" }); });
  it("uses one atomic ownership/text predicate and updates derived tags", async () => {
    await updateQuickNote("owner", "n", { body: "- [x] Task #tag", expectedBody: "- [ ] Task #tag", expectedTitle: "Note" });
    expect(mocks.update.mock.calls[0]![0].where).toEqual({ id: "n", userId: "owner", body: "- [ ] Task #tag", title: "Note" });
    expect(mocks.update.mock.calls[0]![0].data).toEqual({ body: "- [x] Task #tag" });
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), "owner", "n", "Note - [x] Task #tag");
  });
  it("returns conflict without replacing newer server text or syncing stale tags", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(updateQuickNote("owner", "n", { body: "stale", expectedBody: "old" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
  });
  it("keeps foreign read/write responses at 404", async () => {
    mocks.owned.mockResolvedValue(null);
    await expect(getQuickNote("other", "n")).rejects.toMatchObject({ status: 404 });
    await expect(updateQuickNote("other", "n", { body: "stale" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
