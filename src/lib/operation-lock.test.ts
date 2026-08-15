import { describe, expect, it } from "vitest";
import { withDataOperation } from "./operation-lock";

describe("process-local data operation lock", () => {
  it("rejects a concurrent destructive operation and releases afterwards", async () => {
    let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; }); const first = withDataOperation("first", () => waiting);
    await expect(withDataOperation("second", async () => undefined)).rejects.toMatchObject({ status: 409 }); release(); await first; await expect(withDataOperation("third", async () => "ok")).resolves.toBe("ok");
  });
});
