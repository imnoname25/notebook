import { HistoryExtension } from "@blocknote/core/extensions";
import { applyEditorBlockFormat, selectedFormattingBlocks, type EditorBlockFormat } from "./editor-format-commands";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";

export const BLOCK_FORMATS = [
  ["paragraph", "Обычный текст"], ["h1", "Заголовок 1"], ["h2", "Заголовок 2"], ["h3", "Заголовок 3"],
  ["quote", "Цитата"], ["codeBlock", "Кодовый блок"], ["bulletListItem", "Маркированный список"],
  ["numberedListItem", "Нумерованный список"], ["checkListItem", "Чек-лист"],
] as const;
export type BlockFormat = typeof BLOCK_FORMATS[number][0];
const supported = new Set<string>(BLOCK_FORMATS.map(([type]) => type));
export function blockFormat(block: Pick<NotebookFullBlock, "type" | "props">): BlockFormat | "" {
  const value = block.type === "heading" && "level" in block.props ? `h${block.props.level}` : block.type;
  return supported.has(value) ? value as BlockFormat : "";
}
export function selectedFormat(blocks: Pick<NotebookFullBlock, "type" | "props">[]): BlockFormat | "" {
  const first = blocks[0] ? blockFormat(blocks[0]) : "";
  return blocks.every(block => blockFormat(block) === first) ? first : "";
}
export function toolbarLayout(mode: "compact" | "full", width: number) {
  return width < 520 ? "narrow" : mode === "compact" || width < 840 ? "compact" : "full";
}
export function toolbarState(editor: NotebookEditor) {
  const blocks = selectedFormattingBlocks(editor);
  const history = editor.getExtension(HistoryExtension);
  return {
    format: selectedFormat(blocks),
    transformable: blocks.length > 0 && blocks.every(block => Boolean(blockFormat(block))),
    editable: editor.isEditable,
    undo: Boolean(history?.undoCommand(editor.prosemirrorState)),
    redo: Boolean(history?.redoCommand(editor.prosemirrorState)),
    tableId: blocks.length === 1 && blocks[0]?.type === "table" ? blocks[0].id : null,
  };
}
export function applyBlockFormat(editor: NotebookEditor, format: BlockFormat) {
  if (!editor.isEditable || !supported.has(format) || !toolbarState(editor).transformable) return;
  const update: EditorBlockFormat = format === "h1" || format === "h2" || format === "h3"
    ? { type: "heading", props: { level: Number(format[1]) as 1 | 2 | 3 } }
    : { type: format };
  applyEditorBlockFormat(editor, update);
}
