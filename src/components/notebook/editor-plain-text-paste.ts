import { createExtension, type BlockNoteEditorOptions } from "@blocknote/core";
import { DOMParser, DOMSerializer } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { notebookEditorSchema } from "./editor-schema";

type Options = BlockNoteEditorOptions<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;
/** Plain clipboard text is literal text; explicit Markdown/HTML keep their native handlers. */
export const literalTextPasteHandler: NonNullable<Options["pasteHandler"]> = ({ defaultPasteHandler }) => defaultPasteHandler({ plainTextAsMarkdown: false });

/** Native paste transaction/selection/IDs, preserving each empty line instead of collapsing runs. */
export const plainTextLinesExtension = createExtension(({ editor }) => ({
  key: "notebookPlainTextLines",
  prosemirrorPlugins: [new Plugin({ props: {
    clipboardTextParser(text, context, _plain, view) {
      // Keep native table cell paste and the existing TSV adapter in charge of cell structure.
      let table = false;
      for (let depth = context.depth; depth > 0; depth--) {
        if (context.node(depth).type.spec.tableRole) table = true;
      }
      const dom = document.createElement("div"), schema = view.state.schema;
      if (!table && /[\r\n]/.test(text)) {
        // Native BlockNote wrappers preserve empty paragraphs that bare <p> parsing drops.
        dom.innerHTML = editor.blocksToFullHTML(text.split(/\r\n?|\n/).map(line => ({ type: "paragraph", content: line })));
      } else {
        // Same fallback as ProseMirror; table structure and cursor marks remain native.
        const serializer = DOMSerializer.fromSchema(schema), marks = context.marks();
        for (const line of text.split(/(?:\r\n?|\n)+/)) {
          const p = dom.appendChild(document.createElement("p"));
          if (line) p.appendChild(serializer.serializeNode(schema.text(line, marks)));
        }
      }
      return DOMParser.fromSchema(schema).parseSlice(dom, { preserveWhitespace: true, context });
    },
  } })],
}));
