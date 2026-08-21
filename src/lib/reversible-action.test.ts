import { describe, expect, it, vi } from "vitest";
import { createReversibleAction, executeUndo } from "./reversible-action";

describe("reversible actions", () => {
  it("executes the inverse action inside its window", async () => {
    const undo = vi.fn(async () => undefined);
    await executeUndo(createReversibleAction("done", undo, 100, 10), 109);
    expect(undo).toHaveBeenCalledOnce();
  });
  it("expires without executing the inverse", async () => {
    const undo = vi.fn(async () => undefined);
    await expect(executeUndo(createReversibleAction("done", undo, 100, 10), 111)).rejects.toThrow("UNDO_EXPIRED");
    expect(undo).not.toHaveBeenCalled();
  });
  it("does not model permanent deletion as reversible", () => {
    const permanentDelete = { message: "deleted", undo: undefined };
    expect(permanentDelete.undo).toBeUndefined();
  });
});
