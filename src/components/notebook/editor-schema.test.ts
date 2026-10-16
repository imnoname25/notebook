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

// A presentation cleanup must never strip punctuation or flatten legacy nesting.
describe("legacy content preservation", () => {
  it.each(["1С БСО", "(1С БСО)", "(договор № 1)", "((nested))", "[1С] {БСО}"])("preserves %s through validation, normalization and serialization", (text) => {
    const legacy = [{ id: "legacy-parent", type: "paragraph", content: [{ type: "text", text: "Родитель", styles: {} }], children: [
      { id: "legacy-child", type: "paragraph", content: [{ type: "text", text, styles: { bold: true } }], children: [] },
      { type: "bulletListItem", content: text },
      { type: "numberedListItem", content: text },
    ] }];
    const original = structuredClone(legacy);
    const result = normalizeEditorBlocks(blockNoteContentSchema.parse(JSON.parse(JSON.stringify(legacy))));
    expect(result).toEqual(original);
    expect(legacy).toEqual(original);
    expect(JSON.parse(JSON.stringify(result))).toEqual(original);
  });
  it("does not insert punctuation into a new empty paragraph", () => {
    expect(normalizeEditorBlocks([{ type: "paragraph", content: [] }]))
      .toEqual([{ type: "paragraph", content: [] }]);
  });
});