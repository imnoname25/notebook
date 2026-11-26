import { expect, it, vi } from "vitest";
import { applyPageOrder, PageOrderQueue } from "./page-order";

it("serializes a section, continues after an obsolete failure, and leaves other sections independent", async () => {
  const queue = new PageOrderQueue();
  const delayed = Promise.withResolvers<void>();
  const initial = ["a", "b", "c"], first = ["b", "a", "c"], second = ["b", "c", "a"], last = ["c", "b", "a"];
  const failed = vi.fn(async () => {});
  const successful = vi.fn(async () => {});
  const latest = vi.fn(async () => { throw new Error("latest failed"); });
  const p1 = queue.save("s", initial, first, () => delayed.promise, failed);
  const p2 = queue.save("s", first, second, successful, failed);
  const p3 = queue.save("s", second, last, latest, failed);
  await queue.save("other", initial, last, async () => {}, failed);
  expect(queue.current("s")).toBe(last);
  expect(successful).not.toHaveBeenCalled();
  const read = vi.fn(async () => second);
  const p4 = queue.read("s", read);
  expect(read).not.toHaveBeenCalled();
  delayed.reject(new Error("old failure"));
  await Promise.all([p1, p2, p3]);
  expect(failed).toHaveBeenCalledExactlyOnceWith(new Error("latest failed"), second);
  expect(await p4).toEqual(second);
  expect(queue.busy).toBe(false);
});

it("discards a list read that crossed a reorder", async () => {
  const queue = new PageOrderQueue();
  const delayed = Promise.withResolvers<string[]>();
  const initial = ["a", "b"], latest = ["b", "a"];
  const read = vi.fn<() => Promise<string[]>>().mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(latest);
  const result = queue.read("s", read);
  await queue.save("s", initial, latest, async () => {}, async () => {});
  delayed.resolve(initial);
  expect(await result).toEqual(latest);
});

it("updates only the order of pages present in the intent", () => {
  const pages = [{ id: "a", sortOrder: 0, title: "new title" }, { id: "b", sortOrder: 1 }, { id: "c", sortOrder: 2 }];
  const result = applyPageOrder(pages, ["b", "a"]);
  expect(result[0]).toEqual({ id: "a", sortOrder: 1, title: "new title" });
  expect(result[2]).toBe(pages[2]);
});
