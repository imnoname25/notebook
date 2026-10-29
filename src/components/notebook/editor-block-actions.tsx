"use client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlockNoteEditor, useComponentsContext, useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import { GripVertical } from "lucide-react";
import { EditorActivityContext, NotebookBlockMenu, NotebookBlockMenuRoot } from "./editor-block-menu";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";
/** Observe selection only. No touch gesture, text-selection or IME interception. */
type Props = { host: HTMLDivElement | null; pageId?: string; disabled?: boolean };
export function EditorBlockActions(props: Props) {
  const active = useContext(EditorActivityContext);
  return active && !props.disabled ? <ActiveBlockActions {...props}/> : null;
}
function ActiveBlockActions({ host, pageId }: Props) {
  const editor = useBlockNoteEditor() as NotebookEditor;
  const Components = useComponentsContext();
  const [block, setBlock] = useState<NotebookFullBlock | null>(null);
  const [open, setOpen] = useState(false), [keyboard, setKeyboard] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refresh = useCallback(() => { if (editor.isEditable) setBlock(editor.getTextCursorPosition().block); }, [editor]);
  useEditorSelectionChange(refresh, editor);useEditorChange(refresh, editor);
  useEffect(() => {
    const element = editor.domElement;if (!element) return;
    let frame = 0;
    element.addEventListener("focusin", refresh);element.addEventListener("pointerup", refresh, { passive: true });
    const keys = (event: KeyboardEvent) => {
      if (!editor.isEditable || !editor.isFocused() || event.isComposing || editor.prosemirrorView.composing) return;
      if (event.altKey && event.shiftKey && event.code === "KeyB") {
        event.preventDefault();refresh();setKeyboard(true);frame = requestAnimationFrame(() => trigger.current?.click());
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
  if (!Components || !host || !editor.isEditable) return null;
  return createPortal(<div className="notebook-touch-block-controls" data-keyboard={keyboard}>
    <NotebookBlockMenuRoot open={open} onOpenChange={value => { setOpen(value);if (!value) setKeyboard(false); }}>
      <Components.Generic.Menu.Trigger><button ref={trigger} disabled={!block} type="button" className="notebook-block-actions-trigger" aria-label="Действия выбранного блока" aria-keyshortcuts="Alt+Shift+b" onMouseDown={event => event.preventDefault()}><GripVertical size={16}/>Блок · действия</button></Components.Generic.Menu.Trigger>
      {block && <NotebookBlockMenu pageId={pageId} target={block}/>}
    </NotebookBlockMenuRoot>
  </div>, host);
}
