import { describe, expect, it, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { appearancePatchSchema, normalizeAppearance } from "@/lib/appearance-preferences";
import { applyBlockFormat, selectedFormat, toolbarLayout, toolbarState } from "./formatting-toolbar-state";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";

const schema = new Schema({
  nodes: {
    doc: { content: "blockContainer+" },
    blockContainer: { group: "bnBlock", attrs: { id: { default: null } }, content: "paragraph" },
    paragraph: { group: "blockContent", content: "text*" },
    text: {},
  },
});

function fixture(type = "paragraph", editable = true) {
  const block = { id: "first", type, props: {}, children: [], content: [] } as unknown as NotebookFullBlock;
  const doc = schema.node("doc", null, schema.node("blockContainer", { id: block.id }, schema.node("paragraph")));
  const pmState = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
  const editor = {
    isEditable: editable, getSelection: () => undefined, getTextCursorPosition: () => ({ block }),
    getExtension: () => ({ undoCommand: vi.fn(() => true), redoCommand: vi.fn(() => false) }),
    prosemirrorState: pmState, prosemirrorView: { composing: false },
    updateBlock: vi.fn(), focus: vi.fn(), transact: (callback: (tr: Transaction) => void) => callback(pmState.tr),
  } as unknown as NotebookEditor;
  return { block, editor };
}
describe("persistent formatting state", () => {
  it("reports mixed and unsupported blocks neutrally", () => {
    const paragraph = fixture().block, table = fixture("table").block;
    expect(selectedFormat([paragraph])).toBe("paragraph");
    expect(selectedFormat([paragraph, table])).toBe("");
    expect(selectedFormat([{ ...paragraph, type: "heading", props: { level: 2 } } as NotebookFullBlock])).toBe("h2");
  });
  it("binds transformations exclusively to the supplied editor", () => {
    const first = fixture(), second = fixture();
    applyBlockFormat(first.editor, "h3");
    expect(first.editor.updateBlock).toHaveBeenCalledWith(first.block.id, { type: "heading", props: { level: 3 } });
    expect(second.editor.updateBlock).not.toHaveBeenCalled();
  });
  it.each([["table", true], ["columns", true], ["paragraph", false]] as const)("protects %s editable=%s", (type, editable) => {
    const { editor } = fixture(type, editable);applyBlockFormat(editor, "paragraph");
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });
  it("queries native history without dispatching a command", () => {
    const { editor } = fixture();expect(toolbarState(editor)).toMatchObject({ undo: true, redo: false, editable: true });
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });
  it.each([["full", 1100, "full"], ["full", 700, "compact"], ["compact", 1100, "compact"], ["full", 360, "narrow"]] as const)("adapts %s at %s", (mode, width, expected) => {
    expect(toolbarLayout(mode, width)).toBe(expected);
  });
  it("supports legacy accounts, isolated partial PATCH and invalid mode rejection", () => {
    expect(normalizeAppearance({ theme: "paper-coffee" }).formattingToolbarMode).toBe("full");
    expect(appearancePatchSchema.parse({ formattingToolbarMode: "compact" })).toEqual({ formattingToolbarMode: "compact" });
    expect(() => appearancePatchSchema.parse({ formattingToolbarMode: "unknown" })).toThrow();
  });
});
