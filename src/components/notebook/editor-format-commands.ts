import { getBlockInfoWithManualOffset, type BlockInfo } from "@blocknote/core";
import { closeHistory } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import { TextSelection, type Transaction } from "prosemirror-state";
import type { NotebookBlock, NotebookEditor } from "./editor-schema";
import { isEditorLink } from "./editor-links";

type TextBlockInfo = Extract<BlockInfo, { isBlockContainer: true }>;
const formatTypes = [
  "paragraph", "heading", "quote", "codeBlock", "bulletListItem",
  "numberedListItem", "checkListItem", "toggleListItem", "callout",
] as const;
export type EditorBlockFormat = Extract<NotebookBlock, { type?: (typeof formatTypes)[number] }>;
export const textBlockFormats = new Set<string>(formatTypes);

export function selectedFormattingBlocks(editor: NotebookEditor) {
  const { selection } = editor.prosemirrorState;
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  if (!(selection instanceof TextSelection) || selection.empty || selection.$to.parentOffset !== 0) return blocks;
  const end = editor.prosemirrorState.doc.resolve(selection.to);
  for (let depth = end.depth; depth > 0; depth--) {
    const id = end.node(depth).attrs.id;
    if (typeof id === "string") return blocks.filter(block => block.id !== id);
  }
  return blocks;
}

function splitHeading(
  tr: Transaction,
  info: TextBlockInfo,
  props: Record<string, unknown> | undefined,
  anchor: number,
  head: number,
) {
  const { bnBlock, blockContent, childContainer } = info;
  const body = blockContent.node;
  const bodyStart = blockContent.beforePos + 1;
  const from = Math.max(0, Math.min(anchor, head) - bodyStart);
  const to = Math.min(body.content.size, Math.max(anchor, head) - bodyStart);
  if (anchor === head || from >= to || body.type.name !== "paragraph") return;
  let prefixBreak: number | undefined, suffixBreak: number | undefined;
  body.forEach((child, offset) => {
    if (child.type.name !== "hardBreak") return;
    if (offset <= from) prefixBreak = offset;
    else if (offset >= to - 1 && suffixBreak === undefined) suffixBreak = offset;
  });
  if (prefixBreak === undefined && suffixBreak === undefined) return;

  const start = prefixBreak === undefined ? 0 : prefixBreak + 1;
  const end = suffixBreak ?? body.content.size;
  if (start > end) return;
  const heading = tr.doc.type.schema.nodes.heading.createChecked({ ...body.attrs, ...props }, body.content.cut(start, end), body.marks);
  const parts: Node[] = [];
  if (prefixBreak !== undefined) parts.push(body.copy(body.content.cut(0, prefixBreak)));
  const headingIndex = parts.length;
  parts.push(heading);
  if (suffixBreak !== undefined) parts.push(body.copy(body.content.cut(suffixBreak + 1)));

  // The first fragment retains the existing deep-link destination. The
  // original child group stays after the original text, on the last fragment.
  const containers = parts.map((part, index) => bnBlock.node.type.createChecked(
    index === 0 ? bnBlock.node.attrs : { ...bnBlock.node.attrs, id: null },
    index === parts.length - 1 && childContainer ? [part, childContainer.node] : part,
    bnBlock.node.marks,
  ));
  const headingStart = bnBlock.beforePos + 2 + (headingIndex ? containers[0].nodeSize : 0);
  const step = tr.steps.length;
  tr.replaceWith(bnBlock.beforePos, bnBlock.afterPos, containers);
  const map = (position: number) => position >= bodyStart && position <= bodyStart + body.content.size
    ? headingStart + Math.max(0, Math.min(end - start, position - bodyStart - start))
    : tr.mapping.slice(step).map(position);
  return { anchor: map(anchor), head: map(head) };
}

export function applyEditorBlockFormat(editor: NotebookEditor, update: EditorBlockFormat, targetIds?: readonly string[]) {
  if (!editor.isEditable || editor.prosemirrorView.composing || !update.type) return;
  const ids = new Set(targetIds ?? selectedFormattingBlocks(editor).filter(block => textBlockFormats.has(block.type)).map(block => block.id));
  if (!ids.size) return;
  editor.transact(tr => {
    const { selection } = tr;
    const targets: { id: string; pos: number }[] = [];
    tr.doc.descendants((node, pos) => {
      const id = node.attrs.id;
      if (node.type.isInGroup("bnBlock") && typeof id === "string" && ids.has(id)) targets.push({ id, pos });
    });
    closeHistory(tr);
    let { anchor, head } = selection;
    for (const { id, pos } of targets.reverse()) {
      const node = tr.doc.nodeAt(pos);
      if (!node) continue;
      const info = getBlockInfoWithManualOffset(node, pos);
      if (!info.isBlockContainer) continue;
      const split = update.type === "heading" && selection instanceof TextSelection
        ? splitHeading(tr, info, update.props, anchor, head)
        : undefined;
      if (split) {
        ({ anchor, head } = split);
        continue;
      }
      const step = tr.steps.length;
      const body = info.blockContent.node;
      const content = update.type === "codeBlock"
        ? body.textBetween(0, body.content.size, "", child => child.type.name === "hardBreak" ? "\n" : String(child.attrs.text ?? ""))
        : body.type.name === "codeBlock" && body.textContent.includes("\n")
          ? body.textContent
          : undefined;
      editor.updateBlock(id, content === undefined ? update : { ...update, content });
      const map = tr.mapping.slice(step);
      anchor = map.map(anchor);
      head = map.map(head);
    }
    if (selection instanceof TextSelection && tr.doc.resolve(anchor).parent.inlineContent && tr.doc.resolve(head).parent.inlineContent) {
      tr.setSelection(TextSelection.create(tr.doc, anchor, head));
    }
  });
  editor.focus();
}

export function applyEditorLink(editor: NotebookEditor, selection: TextSelection, href: string) {
  if (!editor.isEditable || editor.prosemirrorView.composing || !isEditorLink(href)) return;
  editor.transact(tr => {
    if (selection.$from.doc !== tr.doc) return;
    const mark = tr.doc.type.schema.marks.link.create({ href });
    const { from, to } = selection;
    if (!selection.empty) {
      tr.addMark(from, to, mark);
    } else {
      const existing = editor.getLinkMarkAtPos(from);
      if (existing) tr.addMark(existing.from, existing.to, mark);
      else tr.insertText(href, from).addMark(from, from + href.length, mark);
    }
  });
  editor.focus();
}
