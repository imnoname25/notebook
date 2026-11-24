import type { ClipboardEvent } from "react";
import { blockNoteContentSchema } from "@/lib/blocknote-content-schema";
import { unsupportedEditorBlocks } from "@/lib/editor-compatibility";
import { validateTemplateContent } from "@/lib/page-templates";
import { tsvToTableHtml } from "@/lib/table-paste";
import { normalizeEditorBlocks, type NotebookEditor } from "./editor-schema";
import { isPlainPaste, pasteRichEditorHtml } from "./editor-plain-text-paste";
export function handleSharedEditorPaste(event: ClipboardEvent<HTMLDivElement>, editor: NotebookEditor, template = false, onError = (error: unknown) => window.alert(error instanceof Error ? error.message : "Вставка отменена")) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return false;
  if (!editor.isEditable || isPlainPaste(editor, event.nativeEvent)) return false;
  const stop = () => { event.preventDefault();event.stopPropagation(); };
  try {
    if (template && event.clipboardData.files.length) throw new Error("Файлы в шаблонах недоступны: private attachments не копируются. Используйте внешнюю закладку.");
    const html = event.clipboardData.getData("text/html");const document = html ? new DOMParser().parseFromString(html, "text/html") : null;
    const copied = document?.querySelector('[data-notebook-block-clipboard="1"]');
    if (copied) {
      const content = blockNoteContentSchema.parse(JSON.parse(decodeURIComponent(copied.getAttribute("data-notebook-block-json") ?? "")));
      if (!content.length || unsupportedEditorBlocks(content).length) throw new Error("Буфер содержит неподдерживаемые блоки");
      if (template) validateTemplateContent(content);
      stop();editor.insertBlocks(normalizeEditorBlocks(content, true), editor.getTextCursorPosition().block, "after");return true;
    }
    const internal = event.clipboardData.getData("blocknote/html");
    if (template) {
      const sources = [document, internal ? new DOMParser().parseFromString(internal, "text/html") : null];
      for (const source of sources) {
        if (!source) continue;
        if (source.querySelector("audio,video,iframe,object,[data-content-type=audio],[data-content-type=video],[data-content-type=file]")) throw new Error("Этот тип медиа недоступен в шаблоне");
        for (const image of source.querySelectorAll("img")) validateTemplateContent([{ type: "image", props: { url: image.getAttribute("src") ?? "" } }]);
        for (const anchor of source.querySelectorAll("a[href]")) validateTemplateContent([{ type: "paragraph", content: [{ type: "link", href: anchor.getAttribute("href"), content: [] }] }]);
      }
    }
    const block = editor.getTextCursorPosition().block;
    if (!html && !internal && block.type === "table") {
      const merged = block.content.rows.some(row => row.cells.some(cell => !Array.isArray(cell) && ((cell.props.colspan ?? 1) > 1 || (cell.props.rowspan ?? 1) > 1)));
      const cell = window.getSelection()?.anchorNode?.parentElement?.closest("td, th") as HTMLTableCellElement | null;
      const offset = cell ? Array.from((cell.parentElement as HTMLTableRowElement).cells).slice(0, cell.cellIndex).reduce((sum, item) => sum + item.colSpan, 0) : 0;
      const table = merged ? null : tsvToTableHtml(event.clipboardData.getData("text/plain"), block.content.columnWidths.slice(offset));
      if (table) { stop();pasteRichEditorHtml(editor, table);return true; }
    }
  } catch (error) { stop();onError(error);return true; }
  return false;
}
