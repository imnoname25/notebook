import { blockToNode, createExtension } from "@blocknote/core";
import { Extension } from "@tiptap/core";
import { Slice, type Fragment, type Node } from "prosemirror-model";
import { NodeSelection, Plugin, TextSelection, type Selection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";

function inlineText(node: Node): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === "hardBreak") return "\n";
  if (node.type.name === "pageLink") return String(node.attrs.text || "Страница");
  return directText(node.content);
}

function directText(content: Fragment): string {
  let text = "";
  content.forEach(node => { text += inlineText(node); });
  return text;
}

function tableText(table: Node): string {
  const rows: string[][] = [];
  table.forEach((row, _offset, rowIndex) => {
    const values = rows[rowIndex] ??= [];
    let column = 0;
    row.forEach(cell => {
      while (values[column] !== undefined) column++;
      const value = plainText(cell.content);
      values[column] = /["\t\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
      const colspan = Number(cell.attrs.colspan ?? 1);
      const rowspan = Number(cell.attrs.rowspan ?? 1);
      for (let y = rowIndex; y < Math.min(rowIndex + rowspan, table.childCount); y++) {
        const line = rows[y] ??= [];
        for (let x = column; x < column + colspan; x++) line[x] ??= "";
      }
      column += colspan;
    });
  });
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map(row => Array.from({ length: width }, (_, x) => row[x] ?? "").join("\t")).join("\n");
}

function plainText(content: Fragment): string {
  const lines: string[] = [];
  let inline = "";
  let hasInline = false;
  content.forEach(node => {
    if (node.isInline) {
      inline += inlineText(node);
      hasInline = true;
    } else if (node.type.spec.tableRole === "table") {
      lines.push(tableText(node));
    } else if (node.isTextblock) {
      lines.push(directText(node.content));
    } else if (node.childCount) {
      lines.push(plainText(node.content));
    }
  });
  return hasInline ? inline : lines.join("\n");
}

export function blockClipboardText(editor: NotebookEditor, block: NotebookFullBlock): string {
  return plainText(blockToNode(block, editor.pmSchema, editor.schema.styleSchema).content);
}

function tableCellAt(position: Selection["$from"]) {
  for (let depth = position.depth; depth > 0; depth--) {
    const role = position.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return position.before(depth);
  }
}

function clipboardSlice(selection: Selection): Slice {
  if (selection instanceof TextSelection) {
    const { $from, $to } = selection;
    if ($from.sameParent($to)) return $from.doc.slice(selection.from, selection.to);
    const startCell = tableCellAt($from), endCell = tableCellAt($to);
    if (startCell !== endCell && (startCell !== undefined || endCell !== undefined)) {
      return $from.doc.slice(selection.from, selection.to, true);
    }
  }
  return selection.content();
}

export function selectionClipboardText(selection: Selection): string {
  const { content } = clipboardSlice(selection);
  if (selection instanceof CellSelection && content.firstChild?.type.spec.tableRole === "row") {
    return tableText(selection.$anchorCell.node(-1).type.create(null, content));
  }
  return plainText(content);
}

function copySelection(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const { selection } = view.state;
  const clipboard = event.clipboardData;
  const root = view.root;
  const textSelection = "getSelection" in root && typeof root.getSelection === "function"
    ? root.getSelection() as globalThis.Selection | null
    : view.dom.ownerDocument.getSelection();
  const target = event.target;
  if (!clipboard || selection.empty || (target instanceof Element && target.closest("input,textarea,select")) ||
    (textSelection && !textSelection.isCollapsed && textSelection.focusNode?.parentElement?.closest('[contenteditable="false"]') &&
      !(selection instanceof NodeSelection))) return false;

  let slice = clipboardSlice(selection);
  if (selection instanceof NodeSelection && selection.node.type.spec.group === "blockContent") {
    slice = NodeSelection.create(view.state.doc, selection.from - 1).content();
  }
  // ProseMirror's slice HTML keeps empty blocks without placeholder text and
  // retains the schema's table, mark and custom node metadata.
  const { dom } = view.serializeForClipboard(slice);
  const internalHTML = dom.innerHTML;
  for (const paragraph of dom.querySelectorAll("p:empty, h1:empty, h2:empty, h3:empty, h4:empty, h5:empty, h6:empty")) {
    paragraph.appendChild(dom.ownerDocument.createElement("br"));
  }
  const html = `<div style="white-space: pre-wrap">${dom.innerHTML}</div>`;
  clipboard.setData("blocknote/html", internalHTML);
  clipboard.setData("text/html", html);
  clipboard.setData("text/plain", selectionClipboardText(selection));
  event.preventDefault();
  if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
  return true;
}

export const notebookClipboardExtension = createExtension(() => ({
  key: "notebookClipboard",
  tiptapExtensions: [Extension.create({
    name: "notebookClipboardEvents",
    // Handle the event before the default BlockNote Markdown exporter.
    priority: 1000,
    addProseMirrorPlugins: () => [new Plugin({
      props: { handleDOMEvents: {
        copy: (view, event) => copySelection(view, event, false),
        cut: (view, event) => copySelection(view, event, true),
      } },
    })],
  })],
}));
