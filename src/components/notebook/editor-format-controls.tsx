"use client";

import {
  blockTypeSelectItems, FormattingToolbar, getFormattingToolbarItems, useComponentsContext, useEditorState,
} from "@blocknote/react";
import { FileText, Link2 } from "lucide-react";
import { TextSelection } from "prosemirror-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyEditorBlockFormat, applyEditorLink, selectedFormattingBlocks, textBlockFormats, type EditorBlockFormat } from "./editor-format-commands";
import { isEditorLink } from "./editor-links";
import type { NotebookEditor } from "./editor-schema";

export function NotebookEditorLinkAction({ editor, persistent = false }: { editor: NotebookEditor; persistent?: boolean }) {
  const Components = useComponentsContext()!;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const snapshot = useRef<TextSelection | null>(null);
  const changeOpen = useCallback((next: boolean) => {
    if (next) {
      const { selection } = editor.prosemirrorState;
      if (!(selection instanceof TextSelection) || !editor.isEditable || editor.prosemirrorView.composing) return;
      snapshot.current = selection;
      setUrl(editor.getSelectedLinkUrl() ?? "");
      setError("");
    }
    setOpen(next);
  }, [editor]);

  useEffect(() => {
    if (persistent) return;
    const dom = editor.domElement;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        changeOpen(true);
      }
    };
    dom?.addEventListener("keydown", keydown);
    return () => dom?.removeEventListener("keydown", keydown);
  }, [changeOpen, editor, persistent]);

  const label = persistent ? "Вставить ссылку" : editor.dictionary.formatting_toolbar.link.tooltip;
  return <Components.Generic.Popover.Root open={open} onOpenChange={changeOpen}>
    <Components.Generic.Popover.Trigger>
      {persistent
        ? <button type="button" aria-label={label} title={label} onMouseDown={event => event.preventDefault()}><Link2 size={16}/></button>
        : <Components.FormattingToolbar.Button label={label} mainTooltip={label} icon={<Link2 size={16}/>} data-test="createLink"/>}
    </Components.Generic.Popover.Trigger>
    <Components.Generic.Popover.Content variant="form-popover" className="bn-popover-content formatting-link-form">
      <form aria-label="Адрес ссылки" onSubmit={event => {
        event.preventDefault();
        const href = url.trim();
        if (!isEditorLink(href) || !/^(https?:\/\/|mailto:|tel:|\/[^/]|#)/i.test(href)) {
          setError("Укажите HTTP/HTTPS, mailto, tel или относительный адрес");
          return;
        }
        const selection = snapshot.current;
        if (!selection || selection.$from.doc !== editor.prosemirrorState.doc) {
          setError("Выделение изменилось. Выберите текст снова.");
          return;
        }
        applyEditorLink(editor, selection, href);
        setOpen(false);
      }}><label>Адрес<input autoFocus value={url} onChange={event => setUrl(event.target.value)} type="text" inputMode="url"/></label>
        <button type="submit">Применить ссылку</button>{error && <p role="alert">{error}</p>}
      </form>
    </Components.Generic.Popover.Content>
  </Components.Generic.Popover.Root>;
}

export function NotebookFloatingFormattingToolbar({ editor, onPagePicker }: { editor: NotebookEditor; onPagePicker(): void }) {
  const Components = useComponentsContext()!;
  const block = useEditorState({ editor, selector: ({ editor }) => selectedFormattingBlocks(editor)[0] });
  const items = blockTypeSelectItems(editor.dictionary).filter(item => textBlockFormats.has(item.type)).map(item => {
    const Icon = item.icon;
    return {
      text: item.name,
      icon: <Icon size={16}/>,
      isSelected: item.type === block?.type && Object.entries(item.props ?? {}).every(([key, value]) => Reflect.get(block.props, key) === value),
      onClick: () => {
        applyEditorBlockFormat(editor, { type: item.type, props: item.props } as EditorBlockFormat);
        // The select closes after its action and can briefly restore trigger focus.
        requestAnimationFrame(() => { if (editor.domElement?.isConnected) editor.focus(); });
      },
    };
  });
  const controls = getFormattingToolbarItems().map(item => {
    if (item.key === "blockTypeSelect") return items.some(option => option.isSelected)
      ? <Components.FormattingToolbar.Select key={item.key} className="bn-select" items={items}/>
      : null;
    if (item.key === "createLinkButton") return editor.isEditable ? <NotebookEditorLinkAction key={item.key} editor={editor}/> : null;
    return item;
  });
  return <FormattingToolbar>
    {controls}
    <button type="button" aria-label="Ссылка на страницу" className="bn-button" onMouseDown={event => event.preventDefault()} onClick={onPagePicker}><FileText size={16}/></button>
  </FormattingToolbar>;
}
