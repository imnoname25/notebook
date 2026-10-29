"use client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlockNoteEditor, useComponentsContext, useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import { useShadCNComponentsContext } from "@blocknote/shadcn";
import { GripVertical } from "lucide-react";
import { EditorActivityContext, NotebookBlockMenu, NotebookBlockMenuRoot } from "./editor-block-menu";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";
import { isInTable } from "prosemirror-tables";
import { TableActionItems } from "./table-actions";
/** Observe selection only. No touch gesture, text-selection or IME interception. */
type Props = { host: HTMLDivElement | null; pageId?: string; disabled?: boolean };
export function EditorBlockActions(props: Props) {
  const active = useContext(EditorActivityContext);
  return active && !props.disabled ? <ActiveBlockActions {...props}/> : null;
}
function ActiveBlockActions({ host, pageId }: Props) {
  const editor = useBlockNoteEditor() as NotebookEditor;
  const Components = useComponentsContext();const ShadCN = useShadCNComponentsContext();
  const [block, setBlock] = useState<NotebookFullBlock | null>(null);
  const [open, setOpen] = useState(false), [keyboard, setKeyboard] = useState(false);
  const [tableOnly, setTableOnly] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refresh = useCallback(() => { if (editor.isEditable) setBlock(editor.getTextCursorPosition().block); }, [editor]);
  useEditorSelectionChange(refresh, editor);useEditorChange(refresh, editor);
  useEffect(() => {
    const element = editor.domElement;if (!element) return;
    let frame = 0;
    element.addEventListener("focusin", refresh);element.addEventListener("pointerup", refresh, { passive: true });
    const keys = (event: KeyboardEvent) => {
      if (!editor.isEditable || !editor.isFocused() || event.isComposing || editor.prosemirrorView.composing) return;
      if (event.altKey && event.shiftKey && (event.code === "KeyB" || event.code === "KeyT" && isInTable(editor.prosemirrorState))) {
        event.preventDefault();event.stopPropagation();refresh();setTableOnly(event.code === "KeyT");setKeyboard(true);frame = requestAnimationFrame(() => trigger.current?.click());
      }
    };
    element.addEventListener("keydown", keys);
    return () => { cancelAnimationFrame(frame);element.removeEventListener("focusin", refresh);element.removeEventListener("pointerup", refresh);element.removeEventListener("keydown", keys); };
  }, [editor, refresh]);
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: true }));
    const close = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => { window.removeEventListener("notebook:close-editor-overlay", close);window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: false })); };
  }, [open]);
  if (!Components || !ShadCN || !host || !editor.isEditable) return null;
  return createPortal(<div className="notebook-touch-block-controls" data-keyboard={keyboard}>
    <NotebookBlockMenuRoot open={open} triggerRef={trigger} onOpenChange={value => { setOpen(value);if (!value) setKeyboard(false); }}>
      <Components.Generic.Menu.Trigger><button ref={trigger} disabled={!block} type="button" className="notebook-block-actions-trigger" aria-label="Действия выбранного блока" aria-keyshortcuts="Alt+Shift+b Alt+Shift+t" onPointerDown={() => setTableOnly(false)} onMouseDown={event => event.preventDefault()}><GripVertical size={16}/>Блок · действия</button></Components.Generic.Menu.Trigger>
      {block && (tableOnly && block.type === "table" ? <ShadCN.DropdownMenu.DropdownMenuContent container={editor.portalElement} className="bn-menu-dropdown notebook-table-menu" aria-label="Действия таблицы"><TableActionItems editor={editor} target={block}/></ShadCN.DropdownMenu.DropdownMenuContent> : <NotebookBlockMenu pageId={pageId} target={block}/>)}
    </NotebookBlockMenuRoot>
  </div>, host);
}
