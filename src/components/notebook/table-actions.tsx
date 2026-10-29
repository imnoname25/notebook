"use client";
import { useCallback, useState } from "react";
import { useShadCNComponentsContext } from "@blocknote/shadcn";
import { useComponentsContext, useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import { addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, mergeCells, splitCell, CellSelection, selectionCell, isInTable, selectedRect, moveTableRow, moveTableColumn } from "prosemirror-tables";
import type { Command } from "prosemirror-state";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";

/** Preserve a cell/range in this table; a hovered different table starts at its first cell. */
export function selectTableContext(editor: NotebookEditor, block: NotebookFullBlock) {
  if (block.type !== "table" || !editor.isEditable) return;
  if (!isInTable(editor.prosemirrorState) || editor.getTextCursorPosition().block.id !== block.id) editor.setTextCursorPosition(block, "start");
}

/** One menu body for desktop block submenu, touch block menu and Alt+Shift+T. */
export function TableActionItems({ editor, target }: { editor: NotebookEditor; target: NotebookFullBlock }) {
  const Components = useComponentsContext();const ShadCN = useShadCNComponentsContext();
  const [, render] = useState(0);
  const refresh = useCallback(() => render(value => value + 1), []);
  useEditorSelectionChange(refresh, editor);useEditorChange(refresh, editor);
  const block = editor.getBlock(target.id);
  if (!Components || !ShadCN || block?.type !== "table") return null;
  const valid = editor.isEditable && isInTable(editor.prosemirrorState) && editor.getTextCursorPosition().block.id === block.id;
  const state = editor.prosemirrorState, rect = valid ? selectedRect(state) : null;
  const run = (command: Command) => { if (valid) editor.exec((state, dispatch) => command(state, dispatch, editor.prosemirrorView)); };
  const select = (orientation: "row" | "column"): Command => (state, dispatch) => { const cell = selectionCell(state);dispatch?.(state.tr.setSelection(orientation === "row" ? CellSelection.rowSelection(cell) : CellSelection.colSelection(cell)));return true; };
  const header = (key: "headerRows" | "headerCols") => {
    if (!valid) return;
    const bookmark = state.selection.getBookmark();
    editor.updateBlock(block, { content: { ...block.content, [key]: block.content[key] ? undefined : 1 } });
    editor.exec((state, dispatch) => { dispatch?.(state.tr.setSelection(bookmark.resolve(state.doc)));return true; });
  };
  const Item = ShadCN.DropdownMenu.DropdownMenuItem, Checkbox = ShadCN.DropdownMenu.DropdownMenuCheckboxItem;
  const item = (label: string, command: Command) => <Item key={label} disabled={!valid || !command(state)} onClick={() => run(command)}>{label}</Item>;
  // Keep header bands fixed; moving body rows/columns uses native span-aware commands.
  const row = rect?.top ?? 0, col = rect?.left ?? 0;
  return <>
    <Components.Generic.Menu.Label>Строки и столбцы</Components.Generic.Menu.Label>
    {item("Добавить строку", addRowAfter)}{item("Добавить строку выше", addRowBefore)}{item("Удалить строку", deleteRow)}
    {item("Добавить столбец", addColumnAfter)}{item("Добавить столбец слева", addColumnBefore)}{item("Удалить столбец", deleteColumn)}
    <Components.Generic.Menu.Divider/>
    <Checkbox disabled={!valid} checked={Boolean(block.content.headerRows)} onClick={() => header("headerRows")}>Строка заголовков</Checkbox>
    <Checkbox disabled={!valid} checked={Boolean(block.content.headerCols)} onClick={() => header("headerCols")}>Столбец заголовков</Checkbox>
    <Components.Generic.Menu.Divider/>
    {item("Выделить строку", select("row"))}{item("Выделить столбец", select("column"))}
    {item("Объединить ячейки", mergeCells)}{item("Разделить ячейку", splitCell)}
    <Components.Generic.Menu.Divider/>
    {row > (block.content.headerRows ?? 0) && item("Строку вверх", moveTableRow({ from: row, to: row - 1 }))}
    {rect && row >= (block.content.headerRows ?? 0) && row + 1 < rect.map.height && item("Строку вниз", moveTableRow({ from: row, to: row + 1 }))}
    {col > (block.content.headerCols ?? 0) && item("Столбец влево", moveTableColumn({ from: col, to: col - 1 }))}
    {rect && col >= (block.content.headerCols ?? 0) && col + 1 < rect.map.width && item("Столбец вправо", moveTableColumn({ from: col, to: col + 1 }))}
  </>;
}

export function TableBlockSubmenu({ editor, block }: { editor: NotebookEditor; block: NotebookFullBlock }) {
  const Components = useComponentsContext();const ShadCN = useShadCNComponentsContext();if (!Components || !ShadCN || block.type !== "table") return null;
  return <Components.Generic.Menu.Root sub position="right" onOpenChange={open => { if (open) selectTableContext(editor, block); }}>
    <Components.Generic.Menu.Trigger sub><Components.Generic.Menu.Item subTrigger>Таблица</Components.Generic.Menu.Item></Components.Generic.Menu.Trigger>
    <ShadCN.DropdownMenu.DropdownMenuSubContent container={editor.portalElement} className="bn-menu-dropdown notebook-table-menu" aria-label="Действия таблицы"><TableActionItems editor={editor} target={block}/></ShadCN.DropdownMenu.DropdownMenuSubContent>
  </Components.Generic.Menu.Root>;
}
