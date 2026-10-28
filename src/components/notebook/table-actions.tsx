"use client";
import { useCallback, useState } from "react";
import { useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, mergeCells, splitCell, CellSelection, selectionCell, isInTable } from "prosemirror-tables";
import type { Command } from "prosemirror-state";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";
/** Native ProseMirror table commands operate on the editor's existing selection, never hover state. */
export function TableActions({ editor, disabled = false }: { editor: NotebookEditor; disabled?: boolean }) {
  const [block, setBlock] = useState<NotebookFullBlock | null>(null);const [message, setMessage] = useState("");
  const refresh = useCallback(() => { const current = editor.getTextCursorPosition().block;setBlock(current.type === "table" ? current : null); }, [editor]);
  useEditorSelectionChange(refresh, editor);useEditorChange(refresh, editor);
  if (disabled || block?.type !== "table" || !isInTable(editor.prosemirrorState)) return null;
  const run = (command: Command) => { const result = editor.exec((state, dispatch) => command(state, dispatch, editor.prosemirrorView));setMessage(result ? "" : "Операция неприменима к текущему выделению");editor.focus(); };
  const select = (orientation: "row" | "column"): Command => (state, dispatch) => { const cell = selectionCell(state);dispatch?.(state.tr.setSelection(orientation === "row" ? CellSelection.rowSelection(cell) : CellSelection.colSelection(cell)));return true; };
  return <details className="notebook-table-actions notebook-no-print" onKeyDown={event => { event.stopPropagation();if (event.key === "Escape") { event.preventDefault();event.currentTarget.open = false;editor.focus(); } }}>
    <summary aria-label="Действия таблицы" aria-keyshortcuts="Alt+Shift+t" title="Действия таблицы (Alt+Shift+T)">Таблица · действия<span className="notebook-table-shortcut"> · Alt⇧T</span></summary>
    <div role="group" aria-label="Действия активной таблицы" onMouseDown={event => { if ((event.target as HTMLElement).closest("button")) event.preventDefault(); }}>
      <button type="button" onClick={() => run(addRowAfter)}>Добавить строку</button><button type="button" onClick={() => run(deleteRow)}>Удалить строку</button>
      <button type="button" onClick={() => run(addColumnAfter)}>Добавить столбец</button><button type="button" onClick={() => run(deleteColumn)}>Удалить столбец</button>
      <button type="button" aria-pressed={Boolean(block.content.headerRows)} onClick={() => { editor.updateBlock(block, { content: { ...block.content, headerRows: block.content.headerRows ? undefined : 1 } });editor.focus(); }}>Строка заголовков</button>
      <button type="button" aria-pressed={Boolean(block.content.headerCols)} onClick={() => { editor.updateBlock(block, { content: { ...block.content, headerCols: block.content.headerCols ? undefined : 1 } });editor.focus(); }}>Столбец заголовков</button>
      <button type="button" onClick={() => run(select("row"))}>Выделить строку</button><button type="button" onClick={() => run(select("column"))}>Выделить столбец</button>
      <button type="button" disabled={!mergeCells(editor.prosemirrorState)} onClick={() => run(mergeCells)}>Объединить ячейки</button><button type="button" disabled={!splitCell(editor.prosemirrorState)} onClick={() => run(splitCell)}>Разделить ячейку</button>
    </div>{message && <p role="status">{message}</p>}
  </details>;
}
