import { describe, expect, it } from "vitest";
import { draftKey, documentFingerprint, matchesAcknowledgement, mayReplaceDraft } from "./local-drafts";
describe("crash recovery acknowledgements", () => {
  it("isolates users, pages and concurrent browser writers", () => {
    expect(new Set([draftKey("a", "page", "tab"), draftKey("b", "page", "tab"), draftKey("a", "other", "tab"), draftKey("a", "page", "other-tab")]).size).toBe(4);
  });
  it("late local writes and old server acknowledgements cannot consume a newer draft", () => {
    expect(mayReplaceDraft({ sequence: 2 }, 1)).toBe(false);expect(mayReplaceDraft({ sequence: 2 }, 3)).toBe(true);
    expect(matchesAcknowledgement({ fingerprint: "new" }, "old")).toBe(false);expect(matchesAcknowledgement({ fingerprint: "new" }, "new")).toBe(true);
  });
  it("compares exact structured content independent of JSON key order", async () => {
    expect(await documentFingerprint({ title: "Ёж", content: [{ type: "paragraph", id: "a" }] })).toBe(await documentFingerprint({ content: [{ id: "a", type: "paragraph" }], title: "Ёж" }));
    expect(await documentFingerprint({ title: "Ёж", content: [] })).not.toBe(await documentFingerprint({ title: "Еж", content: [] }));
  });
  it("does not include journal metadata in the document acknowledgement fingerprint", async () => {
    const payload = { title: "Draft", content: [] };
    const storedInput = { ...payload, userId: "owner", pageId: "page", writerId: "tab", sequence: 7, baseRevision: 2 };
    expect(await documentFingerprint(storedInput)).toBe(await documentFingerprint(payload));
  });
});
