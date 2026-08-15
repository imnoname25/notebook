import { describe, expect, it } from "vitest";
import { blockNoteContentSchema } from "@/lib/data-format";
import { normalizeEditorBlocks } from "./editor-schema";
describe("Notebook custom editor blocks", () => {
  it("serializes callout and toggle as structured BlockNote JSON", () => { const content = [{ type: "callout", props: { kind: "warning", title: "Важно" }, content: [{ type: "text", text: "Проверьте backup", styles: {} }] }, { type: "toggle", props: { open: false }, content: [{ type: "text", text: "Детали", styles: {} }], children: [{ type: "paragraph", content: [] }] }]; expect(blockNoteContentSchema.parse(content)).toEqual(content); });
  it("falls back to plaintext for an imported unknown code language", () => { const [block] = normalizeEditorBlocks([{ type: "codeBlock", props: { language: "dangerous-html" }, content: "<script>" }]); if (block?.type !== "codeBlock") throw new Error("Expected code block"); expect(block.props?.language).toBe("text"); });
});
