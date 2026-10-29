import { describe, expect, it, vi } from "vitest";
import { DocumentTransitionQueue, EditorSaveQueue } from "./editor-save-queue";

describe("editor writer", () => {
  it("does not save or create snapshots when switching a clean document", async () => {
    const send=vi.fn();const q=new EditorSaveQueue("original",send,vi.fn());await q.flush(false);expect(send).not.toHaveBeenCalled();
  });
  it("waits for in-flight save and drains a later edit", async () => {
    let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});const values:string[]=[];
    const q=new EditorSaveQueue("original",async value=>{values.push(value);if(value==="first")await gate;},vi.fn());
    q.update("first");const pending=q.save();await Promise.resolve();q.update("second");const flushed=q.flush(false);finish();await pending;await flushed;
    expect(values).toEqual(["first","second"]);expect(q.isDirty()).toBe(false);
  });
  it("retains dirty changes and error status until an acknowledged retry", async () => {
    const send=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);const statuses:string[]=[];
    const q=new EditorSaveQueue<string>("original",send,status=>statuses.push(status));q.update("pending");await expect(q.flush(false)).rejects.toThrow("offline");
    expect(q.isDirty()).toBe(true);expect(statuses.at(-1)).toBe("error");await q.flush(false);expect(q.isDirty()).toBe(false);expect(statuses.at(-1)).toBe("saved");
    expect(send.mock.calls.map(c=>c[0])).toEqual(["pending","pending"]);
  });
  it("allows an explicit manual snapshot but deduplicates automatic flushes", async () => {
    const send=vi.fn();const q=new EditorSaveQueue("same",send,vi.fn());await q.flush(true);await q.flush(false);expect(send).toHaveBeenCalledExactlyOnceWith("same",true);
  });
});
describe("document transition queue", () => {
  it("aborts an obsolete read so the next selection does not await its response", async () => {
    const queue = new DocumentTransitionQueue();let started!: () => void;const reading = new Promise<void>(resolve => { started = resolve; });
    const first = queue.run(async (current, signal) => { started();await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));return current(); });
    await reading;const second = queue.run(async current => current());expect(await first).toBe(false);expect(await second).toBe(true);
  });
  it("cancels reads on leave/unmount but still waits for an in-flight write", async () => {
    const queue = new DocumentTransitionQueue();let finish!: () => void;const write = new Promise<void>(resolve => { finish = resolve; });let signal!: AbortSignal;const commits: string[] = [];
    const first = queue.run(async (current, read) => { signal = read;await write;if (current()) commits.push("old"); });await Promise.resolve();queue.cancel();expect(signal.aborted).toBe(true);
    const next = queue.run(async () => { commits.push("new"); });await Promise.resolve();expect(commits).toEqual([]);finish();await Promise.all([first, next]);expect(commits).toEqual(["new"]);
  });
  it("discards stale loads and commits the latest rapid intention", async () => {
    const q=new DocumentTransitionQueue();let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});const commits:string[]=[];
    const first=q.run(async current=>{await gate;if(current())commits.push("a");});await Promise.resolve();
    const second=q.run(async current=>{if(current())commits.push("b");});const third=q.run(async current=>{if(current())commits.push("c");});
    finish();await Promise.all([first,second,third]);expect(commits).toEqual(["c"]);
  });
  it("survives rejection without silently completing a failed transition", async () => {
    const q=new DocumentTransitionQueue();await expect(q.run(async()=>{throw new Error("save failed");})).rejects.toThrow("save failed");expect(await q.run(async()=>true)).toBe(true);
  });
});
