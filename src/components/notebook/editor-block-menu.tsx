"use client";

import { useEffect, useState } from "react";
import { SideMenuExtension, SuggestionMenu as SuggestionMenuExtension } from "@blocknote/core/extensions";
import { AddBlockButton, DragHandleMenu, SideMenu, useBlockNoteEditor, useComponentsContext, useExtension, useExtensionState } from "@blocknote/react";
import { ArrowDown, ArrowUp, Check, Clipboard, Copy, GripVertical, Link2, Palette, Trash2, Wand2 } from "lucide-react";
import { BLOCK_BACKGROUND_TOKENS } from "@/lib/editor-block-appearance";
import { getPageHref } from "@/lib/workspace-navigation";
import type { NotebookBlock, NotebookEditor, NotebookFullBlock } from "./editor-schema";

const BACKGROUND_LABELS = {
  default: "По умолчанию",
  gray: "Нейтральный",
  red: "Красный",
  orange: "Оранжевый",
  yellow: "Жёлтый",
  green: "Зелёный",
  blue: "Синий",
  purple: "Фиолетовый",
} as const;
const BACKGROUND_BLOCKS = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "callout", "banner", "bookmark", "toggle", "toggleListItem"]);
const TRANSFORMABLE = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "toggleListItem"]);

export function NotebookSideMenu({ pageId }: { pageId: string }) {
  return <SideMenu><AddBlockButton/><NotebookDragHandle pageId={pageId}/></SideMenu>;
}

export function EditorSuggestionOverlayBridge() {
  const suggestionMenu = useExtension(SuggestionMenuExtension);
  const shown = useExtensionState(SuggestionMenuExtension, { selector: (state) => Boolean(state?.show) });
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: shown }));
    const close = () => { if (shown) suggestionMenu.closeMenu(); };
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => {
      window.removeEventListener("notebook:close-editor-overlay", close);
      if (shown) window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: false }));
    };
  }, [shown, suggestionMenu]);
  return null;
}

function NotebookDragHandle({ pageId }: { pageId: string }) {
  const Components = useComponentsContext();
  const sideMenu = useExtension(SideMenuExtension);
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: open }));
    const close = () => { if (open) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); };
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => window.removeEventListener("notebook:close-editor-overlay", close);
  }, [open]);
  if (!Components || !block) return null;
  return <Components.Generic.Menu.Root position="left" onOpenChange={(next) => { setOpen(next); if (next) sideMenu.freezeMenu(); else sideMenu.unfreezeMenu(); }}>
    <Components.Generic.Menu.Trigger><Components.SideMenu.Button label="Действия с блоком" className="bn-button notebook-block-handle" draggable onDragStart={(event) => sideMenu.blockDragStart(event, block)} onDragEnd={sideMenu.blockDragEnd} icon={<GripVertical size={19}/>}/></Components.Generic.Menu.Trigger>
    <NotebookBlockMenu pageId={pageId}/>
  </Components.Generic.Menu.Root>;
}

function NotebookBlockMenu({ pageId }: { pageId: string }) {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor() as NotebookEditor;
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (!Components || !block) return null;
  const typedBlock = block as NotebookFullBlock;
  const copy = async (plainOnly: boolean) => {
    const text = editor.blocksToMarkdownLossy([typedBlock]).trim();
    if (!plainOnly && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      const html = editor.blocksToHTMLLossy([typedBlock]);
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    } else await navigator.clipboard.writeText(text);
  };
  const canColor = BACKGROUND_BLOCKS.has(block.type) && "backgroundColor" in block.props;
  return <DragHandleMenu>
    <Components.Generic.Menu.Item icon={<ArrowUp size={16}/>} onClick={() => editor.moveBlocksUp(block)}>Переместить вверх</Components.Generic.Menu.Item>
    <Components.Generic.Menu.Item icon={<ArrowDown size={16}/>} onClick={() => editor.moveBlocksDown(block)}>Переместить вниз</Components.Generic.Menu.Item>
    <Components.Generic.Menu.Divider/>
    <Components.Generic.Menu.Item icon={<Copy size={16}/>} onClick={() => editor.insertBlocks([freshBlock(typedBlock)], typedBlock, "after")}>Дублировать</Components.Generic.Menu.Item>
    <Components.Generic.Menu.Item icon={<Clipboard size={16}/>} onClick={() => void copy(false)}>Копировать</Components.Generic.Menu.Item>
    <Components.Generic.Menu.Item icon={<Clipboard size={16}/>} onClick={() => void copy(true)}>Копировать как текст</Components.Generic.Menu.Item>
    <Components.Generic.Menu.Item icon={<Link2 size={16}/>} onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${getPageHref(pageId, block.id)}`)}>Копировать ссылку на блок</Components.Generic.Menu.Item>
    {TRANSFORMABLE.has(block.type) && <Components.Generic.Menu.Root sub position="right">
      <Components.Generic.Menu.Trigger sub><Components.Generic.Menu.Item subTrigger icon={<Wand2 size={16}/>}>Преобразовать</Components.Generic.Menu.Item></Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        <Components.Generic.Menu.Item onClick={() => editor.updateBlock(block, { type: "paragraph" })}>Текст</Components.Generic.Menu.Item>
        <Components.Generic.Menu.Item onClick={() => editor.updateBlock(block, { type: "heading", props: { level: 2 } })}>Заголовок</Components.Generic.Menu.Item>
        <Components.Generic.Menu.Item onClick={() => editor.updateBlock(block, { type: "bulletListItem" })}>Маркированный список</Components.Generic.Menu.Item>
        <Components.Generic.Menu.Item onClick={() => editor.updateBlock(block, { type: "numberedListItem" })}>Нумерованный список</Components.Generic.Menu.Item>
        <Components.Generic.Menu.Item onClick={() => editor.updateBlock(block, { type: "checkListItem" })}>Чеклист</Components.Generic.Menu.Item>
        <Components.Generic.Menu.Item onClick={() => editor.updateBlock(block, { type: "quote" })}>Цитата</Components.Generic.Menu.Item>
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>}
    {canColor && <Components.Generic.Menu.Root sub position="right">
      <Components.Generic.Menu.Trigger sub><Components.Generic.Menu.Item subTrigger icon={<Palette size={16}/>}>Фон блока</Components.Generic.Menu.Item></Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown notebook-block-color-menu">
        {BLOCK_BACKGROUND_TOKENS.map((value) => <Components.Generic.Menu.Item key={value} icon={block.props.backgroundColor === value ? <Check size={15}/> : <span className="notebook-color-swatch" data-color={value}/>} onClick={() => editor.updateBlock(block, { props: { backgroundColor: value } })}>{BACKGROUND_LABELS[value]}</Components.Generic.Menu.Item>)}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>}
    <Components.Generic.Menu.Divider/>
    <Components.Generic.Menu.Item className="notebook-menu-danger" icon={<Trash2 size={16}/>} onClick={() => editor.removeBlocks([block])}>Удалить</Components.Generic.Menu.Item>
  </DragHandleMenu>;
}

function freshBlock(block: NotebookFullBlock): NotebookBlock {
  const { id: _id, children, ...rest } = block;
  void _id;
  return { ...structuredClone(rest), children: children.map((child) => freshBlock(child as NotebookFullBlock)) } as NotebookBlock;
}
