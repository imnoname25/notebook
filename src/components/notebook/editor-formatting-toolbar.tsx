"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BasicTextStyleButton, ColorStyleButton, NestBlockButton, UnnestBlockButton, TextAlignButton, useEditorChange, useEditorState, useComponentsContext } from "@blocknote/react";
import { useShadCNComponentsContext } from "@blocknote/shadcn";
import { Undo2, Redo2, MoreHorizontal, List, Plus, Table2 } from "lucide-react";
import { useAppearance } from "./appearance-context";
import { NotebookEditorLinkAction } from "./editor-format-controls";
import { NotebookBlockMenuRoot } from "./editor-block-menu";
import { TableActionItems } from "./table-actions";
import { slashMenuItems, type NotebookEditor } from "./editor-schema";
import { applyBlockFormat, BLOCK_FORMATS, toolbarLayout, toolbarState, type BlockFormat } from "./formatting-toolbar-state";

function ActionMenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const Components = useComponentsContext()!;
  const ShadCN = useShadCNComponentsContext()!;
  const [open, setOpen] = useState(false);
  return <NotebookBlockMenuRoot open={open} onOpenChange={setOpen}>
    <Components.Generic.Menu.Trigger><button type="button" aria-label={label} title={label} onMouseDown={event => event.preventDefault()}>{icon}<span className="formatting-action-label">{label}</span></button></Components.Generic.Menu.Trigger>
    <ShadCN.DropdownMenu.DropdownMenuContent className="bn-menu-dropdown formatting-action-menu" aria-label={label}>{children}</ShadCN.DropdownMenu.DropdownMenuContent>
  </NotebookBlockMenuRoot>;
}

function OverflowControls({ editor, children }: { editor: NotebookEditor; children: ReactNode }) {
  const Components = useComponentsContext()!;
  const [open, setOpen] = useState(false);
  useEditorChange(() => setOpen(false), editor);
  return <Components.Generic.Popover.Root open={open} onOpenChange={setOpen}>
    <Components.Generic.Popover.Trigger><button type="button" aria-label="Другие инструменты" title="Другие инструменты" onMouseDown={event => event.preventDefault()}><MoreHorizontal size={18}/></button></Components.Generic.Popover.Trigger>
    <Components.Generic.Popover.Content className="bn-popover-content formatting-overflow-body" variant="form-popover"><div role="group" aria-label="Дополнительное форматирование">{children}</div></Components.Generic.Popover.Content>
  </Components.Generic.Popover.Root>;
}

export function EditorFormattingToolbar({ editor, host, disabled, onPagePicker, mode = "page" }: { editor: NotebookEditor; host: HTMLDivElement | null; disabled: boolean; onPagePicker(): void; mode?: "page" | "template" }) {
  const { preferences } = useAppearance();
  const state = useEditorState({ editor, selector: ({ editor }) => toolbarState(editor) });
  const [width, setWidth] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState("");
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  async function insertImage(file: File) {
    if (!editor.uploadFile || !editor.isEditable || uploading) return;
    const targetId = editor.getTextCursorPosition().block.id;
    setUploading(true);setUploadError("");
    try {
      const url = await editor.uploadFile(file);
      if (!alive.current || !editor.domElement?.isConnected || !editor.isEditable) return;
      const target = editor.getBlock(targetId);
      if (!target || typeof url !== "string") throw new Error("Не удалось вставить изображение в исходный блок");
      editor.insertBlocks([{ type: "image", props: { url, name: file.name } }], target, "after");
    } catch (error) { if (alive.current) setUploadError(error instanceof Error ? error.message : "Не удалось загрузить изображение"); }
    finally { if (alive.current) setUploading(false); }
  }

  const Components = useComponentsContext()!;
  const ShadCN = useShadCNComponentsContext()!;
  useLayoutEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(host);return () => observer.disconnect();
  }, [host]);
  if (!host || disabled || !state.editable) return null;
  const layout = toolbarLayout(preferences.formattingToolbarMode, width);
  const choose = (value: string) => applyBlockFormat(editor, value as BlockFormat);
  const history = <span className="formatting-history"><button type="button" aria-label="Отменить" title="Отменить" disabled={!state.undo} onMouseDown={event => event.preventDefault()} onClick={() => { editor.undo();editor.focus(); }}><Undo2 size={16}/></button><button type="button" aria-label="Повторить" title="Повторить" disabled={!state.redo} onMouseDown={event => event.preventDefault()} onClick={() => { editor.redo();editor.focus(); }}><Redo2 size={16}/></button></span>;
  const table = state.tableId ? editor.getBlock(state.tableId) : undefined;
  const tableActions = table?.type === "table" ? <ActionMenu label="Таблица" icon={<Table2 size={16}/>}><TableActionItems editor={editor} target={table}/><Components.Generic.Menu.Divider/><Components.Generic.Menu.Item onClick={() => editor.removeBlocks([table])}>Удалить таблицу</Components.Generic.Menu.Item></ActionMenu> : null;
  const extra = <>
    <BasicTextStyleButton basicTextStyle="underline"/><BasicTextStyleButton basicTextStyle="strike"/><BasicTextStyleButton basicTextStyle="code"/>
    <ColorStyleButton/><NotebookEditorLinkAction editor={editor} persistent/><NestBlockButton/><UnnestBlockButton/>
    <TextAlignButton textAlignment="left"/><TextAlignButton textAlignment="center"/><TextAlignButton textAlignment="right"/>
  </>;
  const list = <ActionMenu label="Списки" icon={<List size={16}/>}>
    {BLOCK_FORMATS.filter(([value]) => value.endsWith("ListItem")).map(([value, label]) => <ShadCN.DropdownMenu.DropdownMenuItem key={value} disabled={!state.transformable} onClick={() => choose(value)}>{label}</ShadCN.DropdownMenu.DropdownMenuItem>)}
  </ActionMenu>;
  const insert = <ActionMenu label="Вставить" icon={<Plus size={16}/>}>
    {slashMenuItems(editor, onPagePicker, "", mode).filter(item => ["table", "divider", "code_block", "quote", "page-link", "callout-info"].includes(item.key)).map(item => <Components.Generic.Menu.Item key={item.key} onClick={item.onItemClick}>{item.title}</Components.Generic.Menu.Item>)}
    {mode === "page" && editor.uploadFile && <ShadCN.DropdownMenu.DropdownMenuItem disabled={uploading} onClick={() => imageInput.current?.click()}>{uploading ? "Загрузка изображения…" : "Изображение"}</ShadCN.DropdownMenu.DropdownMenuItem>}
  </ActionMenu>;
  return createPortal(<div className="editor-formatting-toolbar notebook-no-print" data-toolbar-layout={layout} data-toolbar-mode={preferences.formattingToolbarMode}>
    <input ref={imageInput} type="file" accept="image/*" hidden aria-label="Файл изображения" onChange={event => { const file = event.target.files?.[0];event.target.value = "";if (file) void insertImage(file); }}/>
    {uploadError && <p className="formatting-upload-error" role="alert">{uploadError}</p>}
    <div className="bn-toolbar" role="toolbar" aria-label="Форматирование документа" onClickCapture={event => { if (editor.prosemirrorView.composing) { event.preventDefault();event.stopPropagation(); } }} onPointerDownCapture={event => {
      if (editor.prosemirrorView.composing) { event.preventDefault();event.stopPropagation();return; }
    }} onMouseDown={event => { if (!(event.target instanceof HTMLElement && event.target.closest("input,select,textarea"))) event.preventDefault(); }}>
      <select aria-label="Формат блока" value={state.format} disabled={!state.transformable} onChange={event => choose(event.target.value)}><option value="" disabled>Смешанный / блок</option>{BLOCK_FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <BasicTextStyleButton basicTextStyle="bold"/><BasicTextStyleButton basicTextStyle="italic"/>{list}
      {layout === "full" ? extra : <OverflowControls editor={editor}>{extra}{insert}{layout === "narrow" && <>{tableActions}{history}</>}</OverflowControls>}
      {layout === "full" && insert}
      {layout !== "narrow" && tableActions}
      {layout !== "narrow" && history}
    </div>
  </div>, editor.portalElement);
}
