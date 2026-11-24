"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormattingToolbarController, LinkToolbarController, SideMenuController, SuggestionMenuController, type DefaultReactSuggestionItem } from "@blocknote/react";
import { FileText } from "lucide-react";
import { api } from "@/lib/client-api";
import { notebookBlockNoteDictionary } from "@/lib/i18n/blocknote";
import { linkTargetsSchema } from "@/lib/page-links";
import { notebookEditorSchema, notebookSyntaxHighlighting, normalizeEditorBlocks, slashMenuItems, type NotebookEditor } from "./editor-schema";
import { EditorBlockActions } from "./editor-block-actions";
import { NotebookSideMenu } from "./editor-block-menu";
import { literalTextPasteHandler, plainTextLinesExtension } from "./editor-plain-text-paste";
import { notebookClipboardExtension } from "./editor-clipboard";
import { NotebookLinkToolbar } from "./editor-link-toolbar";
import { NotebookFloatingFormattingToolbar } from "./editor-format-controls";
import { notebookLinksExtension } from "./editor-links";
import { formattingFocusExtension } from "./editor-formatting-focus";
export const sharedEditorBaseOptions = { schema: notebookEditorSchema, dictionary: notebookBlockNoteDictionary, pasteHandler: literalTextPasteHandler, disableExtensions: ["link"], extensions: [notebookSyntaxHighlighting, plainTextLinesExtension(), notebookClipboardExtension(), notebookLinksExtension(), formattingFocusExtension()], tables: { headers: true, splitCells: true } };
export function sharedEditorOptions(content: unknown[]) { return { ...sharedEditorBaseOptions, initialContent: normalizeEditorBlocks(content) }; }
/** No autosave, uploads, page revision, recovery or navigation state belongs here. */
export function SharedEditorMenus({ editor, mode = "page", pageId, onPagePicker, blockActionsHost, disabled = false }: { editor: NotebookEditor; mode?: "page" | "template"; pageId?: string; onPagePicker(): void; blockActionsHost?: HTMLDivElement | null; disabled?: boolean }) {
  const [blockDragging, setBlockDragging] = useState(false);
  const request = useRef<AbortController | null>(null);const latest = useRef<Promise<DefaultReactSuggestionItem[]> | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const mentions = useCallback((query: string): Promise<DefaultReactSuggestionItem[]> => {
    request.current?.abort();const controller = new AbortController();request.current = controller;
    const result: Promise<DefaultReactSuggestionItem[]> = (async () => {
      await new Promise(resolve => setTimeout(resolve, 180));if (controller.signal.aborted) return request.current === controller ? [] : latest.current ?? [];
      try {
        const payload = linkTargetsSchema.parse(await api<unknown>(`/api/pages/mentions?q=${encodeURIComponent(query)}`, { signal: controller.signal }));
        if (controller.signal.aborted) return request.current === controller ? [] : latest.current ?? [];
        return payload.pages.map(item => ({ title: item.title, subtext: `${item.notebookTitle} / ${item.sectionTitle}`, icon: <FileText size={16}/>, onItemClick: () => editor.insertInlineContent([{ type: "pageLink", props: { pageId: item.id, text: item.title, alias: false } }, " "]) }));
      } catch { return request.current === controller ? [] : latest.current ?? []; }
    })();latest.current = result;return result;
  }, [editor]);
  const slash = useCallback(async (query: string) => slashMenuItems(editor, onPagePicker, query, mode), [editor, mode, onPagePicker]);
  const side = useCallback(() => <NotebookSideMenu pageId={pageId} onDragChange={setBlockDragging}/>, [pageId]);
  const floating = useCallback(() => <NotebookFloatingFormattingToolbar editor={editor} onPagePicker={onPagePicker}/>, [editor, onPagePicker]);
  const shouldOpen = useCallback((transaction: Parameters<NonNullable<React.ComponentProps<typeof SuggestionMenuController>["shouldOpen"]>>[0]) => !transaction.selection.$from.parent.type.spec.code && !transaction.selection.$from.marks().some(mark => mark.type.spec.code) && !editor.prosemirrorView.composing, [editor]);
  return <>
    <EditorBlockActions disabled={disabled} host={blockActionsHost ?? null} pageId={pageId}/>
    <SuggestionMenuController triggerCharacter="/" shouldOpen={shouldOpen} getItems={slash} floatingUIOptions={{ elementProps: { className: "notebook-slash-popover" } }}/>
    <SuggestionMenuController triggerCharacter="[[" shouldOpen={shouldOpen} getItems={mentions}/>
    <SideMenuController sideMenu={side}/>
    <LinkToolbarController linkToolbar={NotebookLinkToolbar}/>
    {!blockDragging && <FormattingToolbarController formattingToolbar={floating}/>}
  </>;
}
