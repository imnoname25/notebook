import { describe, expect, it, vi } from "vitest";
import { sharedEditorOptions } from "./editor-shared";
import { notebookEditorSchema, slashMenuItems, type NotebookEditor } from "./editor-schema";
import { notebookBlockNoteDictionary } from "@/lib/i18n/blocknote";
import { templateEditorFingerprint } from "@/lib/template-editor-state";
const editor = { schema: notebookEditorSchema, dictionary: notebookBlockNoteDictionary } as unknown as NotebookEditor;
describe("shared editor boundary", () => {
  it("shares schema, dictionary, native table flags and highlighting without page lifecycle", () => {
    const options = sharedEditorOptions([{ type: "paragraph", content: [] }]);
    expect(options.schema).toBe(notebookEditorSchema);expect(options.dictionary).toBe(notebookBlockNoteDictionary);
    expect(options.tables).toEqual({ headers: true, splitCells: true });expect(options.extensions).toHaveLength(1);
    for (const key of ["pageId", "uploadFile", "revision", "autosave", "recovery"]) expect(options).not.toHaveProperty(key);
  });
  it("uses the same catalogue while hiding precisely the page/upload-dependent commands", () => {
    const page = slashMenuItems(editor, vi.fn(), ""), template = slashMenuItems(editor, vi.fn(), "", "template");
    expect(template).toHaveLength(36);
    expect(page.filter(item => !template.some(t => t.key === item.key)).map(item => item.key).sort()).toEqual(["audio", "file", "image", "video", "widget-COUNTDOWN", "widget-DATETIME", "widget-HTTP_STATUS", "widget-JSON_VALUE", "widget-TCP_CHECK", "widget-TLS_CERTIFICATE"].sort());
    for (const key of ["table", "callout-important", "callout-idea", "columns", "three-columns", "page-link", "bookmark", "code_block"]) expect(template.some(item => item.key === key)).toBe(true);
  });
});
describe("template dirty comparison", () => {
  const initial = { name: "Template", description: "", icon: "file-text", content: [{ id: "block", type: "table", content: { type: "tableContent", columnWidths: [180, 220], rows: [{ cells: [[{ type: "text", text: "Text", styles: {} }], []] }] } }] };
  it("returns clean after reverting content and ignores object property order", () => {
    const baseline = templateEditorFingerprint(initial), changed = structuredClone(initial);changed.name = "Changed";expect(templateEditorFingerprint(changed)).not.toBe(baseline);changed.name = initial.name;expect(templateEditorFingerprint(changed)).toBe(baseline);
    expect(templateEditorFingerprint({ ...initial, content: [{ ...initial.content[0]!, content: { ...initial.content[0]!.content } }] })).toBe(baseline);
  });
  it("detects metadata, table width, formatting, content and block ordering", () => {
    const baseline = templateEditorFingerprint(initial);
    for (const changed of [{ ...initial, name: "Rename" }, { ...initial, description: "Description" }, { ...initial, icon: "notebook" }, { ...initial, content: [] }, { ...initial, content: [...initial.content, { type: "paragraph" }] }]) expect(templateEditorFingerprint(changed)).not.toBe(baseline);
    const width = structuredClone(initial);width.content[0]!.content.columnWidths[0] = 300;expect(templateEditorFingerprint(width)).not.toBe(baseline);
    const styled = structuredClone(initial);styled.content[0]!.content.rows[0]!.cells[0]![0]!.styles = { bold: true };expect(templateEditorFingerprint(styled)).not.toBe(baseline);
    const blocks = { ...initial, content: [{ id: "a", type: "paragraph" }, { id: "b", type: "paragraph" }] };expect(templateEditorFingerprint(blocks)).not.toBe(templateEditorFingerprint({ ...blocks, content: [...blocks.content].reverse() }));
  });
});
