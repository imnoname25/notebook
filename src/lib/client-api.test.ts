import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client-api";
afterEach(() => vi.unstubAllGlobals());
describe("client response bodies", () => {
  it("preserves cancellation after successful headers instead of returning an empty object", async () => {
    const controller = new AbortController();const aborted = new DOMException("Stream cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { controller.abort();throw aborted; } }));
    await expect(api("/api/pages", { signal: controller.signal })).rejects.toBe(aborted);
  });
  it("refuses successful malformed data but preserves an HTTP error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError(); } }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Revision conflict" }) }));
    await expect(api("/api/pages")).rejects.toThrow("JSON");await expect(api("/api/pages")).rejects.toThrow("Revision conflict");
  });
});
