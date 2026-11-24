import { createExtension, type BlockNoteEditorOptions } from "@blocknote/core";
import { Extension } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { NotebookEditor, notebookEditorSchema } from "./editor-schema";

type Options = BlockNoteEditorOptions<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;
const plainIntent = new WeakMap<EditorView, boolean>();
const classified = new WeakMap<ClipboardEvent, boolean>();

export function isPlainPaste(editor: NotebookEditor, event: ClipboardEvent): boolean {
  const previous = classified.get(event);
  if (previous !== undefined) return previous;
  const view = editor.prosemirrorView;
  const plain = plainIntent.get(view) ?? false;
  plainIntent.delete(view);
  classified.set(event, plain);
  return plain;
}

export function pasteRichEditorHtml(editor: NotebookEditor, html: string): void {
  if (!html) return;
  const source = new globalThis.DOMParser().parseFromString(html, "text/html");
  const content = source.body.textContent ?? "";
  let parsed = html;
  let marker = "";
  if (content.includes("\uFFFC")) {
    marker = "NotebookClipboardLiteralObjectCharacter";
    while (content.includes(marker) || source.body.innerHTML.includes(marker)) marker += "_";
    const walker = source.createTreeWalker(source.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue?.includes("\uFFFC")) node.nodeValue = node.nodeValue.replaceAll("\uFFFC", marker);
    }
    parsed = source.body.innerHTML;
  }
  const blocks = editor.tryParseHTMLToBlocks(parsed);
  if (!blocks.length) return;
  const fullHtml = editor.blocksToFullHTML(blocks);
  editor.pasteHTML(marker ? fullHtml.replaceAll(marker, "\uFFFC") : fullHtml, true);
}

export const literalTextPasteHandler: NonNullable<Options["pasteHandler"]> = ({ defaultPasteHandler, editor, event }) => {
  const data = event.clipboardData;
  if (!data) return false;
  const text = data.getData("text/plain");
  const code = editor.prosemirrorState.selection.$from.parent.type.spec.code;
  if (isPlainPaste(editor, event) || code) {
    if (text) editor.pasteText(text);
    return true;
  }
  const native = data.getData("blocknote/html");
  const html = data.getData("text/html");
  if (data.types.includes("vscode-editor-data")) {
    return defaultPasteHandler({ plainTextAsMarkdown: false, prioritizeMarkdownOverHTML: false });
  }
  if (native) editor.pasteHTML(native, true);
  else if (html) pasteRichEditorHtml(editor, html);
  else if (text) editor.pasteText(text);
  else if (data.files.length) return defaultPasteHandler({ plainTextAsMarkdown: false, prioritizeMarkdownOverHTML: false });
  return true;
};

/** Native paste transaction/selection/IDs, preserving each empty line instead of collapsing runs. */
export const plainTextLinesExtension = createExtension(({ editor }) => ({
  key: "notebookPlainTextLines",
  tiptapExtensions: [Extension.create({
    name: "notebookPasteInsertion",
    // Table and file plugins still get first refusal. The ordinary insertion
    // uses the parsed slice without reinterpreting its text in TipTap paste rules.
    priority: -1000,
    addProseMirrorPlugins: () => [new Plugin({
      props: {
        handlePaste(view, _event, slice) {
          if (!slice.content.size) return false;
          view.dispatch(view.state.tr.replaceSelection(slice).setMeta("paste", true).setMeta("preventAutolink", true).scrollIntoView());
          return true;
        },
      },
    })],
  })],
  prosemirrorPlugins: [new Plugin({ props: {
    handleDOMEvents: {
      keydown(view, event) {
        if (event.key.toLowerCase() === "v" || (!event.ctrlKey && !event.metaKey)) {
          plainIntent.set(view, event.key.toLowerCase() === "v" && (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey);
        }
        return false;
      },
      keyup(view, event) {
        if (event.key.toLowerCase() === "v") plainIntent.delete(view);
        return false;
      },
      blur(view) {
        plainIntent.delete(view);
        return false;
      },
    },
    clipboardTextParser(text, context, _plain, view) {
      // Keep native table cell paste and the existing TSV adapter in charge of cell structure.
      let table = false;
      for (let depth = context.depth; depth > 0; depth--) {
        if (context.node(depth).type.spec.tableRole) table = true;
      }
      const dom = view.dom.ownerDocument.createElement("div"), schema = view.state.schema;
      const lines = text.split(/\r\n?|\n/);
      if (!table && /[\r\n]/.test(text)) {
        // Native BlockNote wrappers preserve empty paragraphs that bare <p> parsing drops.
        dom.innerHTML = editor.blocksToFullHTML(lines.map(line => ({ type: "paragraph", content: line })));
      } else {
        const serializer = DOMSerializer.fromSchema(schema), doc = dom.ownerDocument;
        const p = dom.appendChild(doc.createElement("p"));
        for (const [index, line] of lines.entries()) {
          if (index) p.appendChild(doc.createElement("br"));
          if (line) p.appendChild(serializer.serializeNode(schema.text(line)));
        }
      }
      return DOMParser.fromSchema(schema).parseSlice(dom, { preserveWhitespace: true, context });
    },
  } })],
}));
