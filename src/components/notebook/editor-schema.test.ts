import { describe, expect, it } from "vitest";
import { blockNoteContentSchema } from "@/lib/data-format";
import { normalizeEditorBlocks } from "./editor-schema";
describe("Notebook custom editor blocks", () => {
  it("serializes callout and toggle as structured BlockNote JSON", () => { const content = [{ type: "callout", props: { kind: "warning", title: "Важно" }, content: [{ type: "text", text: "Проверьте backup", styles: {} }] }, { type: "toggle", props: { open: false }, content: [{ type: "text", text: "Детали", styles: {} }], children: [{ type: "paragraph", content: [] }] }]; expect(blockNoteContentSchema.parse(content)).toEqual(content); });
  it("falls back to plaintext for an imported unknown code language", () => { const [block] = normalizeEditorBlocks([{ type: "codeBlock", props: { language: "dangerous-html" }, content: "<script>" }]); if (block?.type !== "codeBlock") throw new Error("Expected code block"); expect(block.props?.language).toBe("text"); });
  it("preserves extension-safe structural blocks and curated backgrounds", () => {
    const content = [{ type: "tabs", children: [{ type: "tabPanel", props: { label: "Linux" }, children: [{ type: "paragraph", props: { backgroundColor: "blue" }, content: [] }] }, { type: "tabPanel", props: { label: "Docker" }, children: [] }] }, { type: "columns", props: { count: 2 }, children: [{ type: "columnPanel", children: [{ type: "paragraph", content: [] }] }, { type: "columnPanel", children: [{ type: "paragraph", content: [] }] }] }, { type: "divider", props: { style: "label" }, content: [{ type: "text", text: "Deploy" }] }];
    expect(normalizeEditorBlocks(content)).toEqual(content);
    expect(blockNoteContentSchema.parse(content)).toEqual(content);
  });
});
