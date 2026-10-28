"use client";
import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Alert from "@radix-ui/react-alert-dialog";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import { X, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { isDarkTheme } from "@/lib/themes";
import { TEMPLATE_ICONS, type TemplateIcon } from "@/lib/template-icons";
import { validateTemplateContent } from "@/lib/page-templates";
import { templateEditorFingerprint } from "@/lib/template-editor-state";
import { pageIdFromPath } from "@/lib/workspace-navigation";
import { internalPageIdsInContent } from "@/lib/portable-content";
import type { PageTemplate } from "./template-dialogs";
import { sharedEditorOptions, SharedEditorMenus } from "./editor-shared";
import { useEditorControls, handleEditorControlKeyDown, handleCodeControlClick } from "./editor-controls";
import { handleSharedEditorPaste } from "./editor-paste";
import { PageLinksProvider } from "./page-link-inline";
import { PageLinkPicker } from "./page-link-picker";
import { TableActions } from "./table-actions";
export type TemplateCloseRequest = (after?: () => void) => void;
export function TemplateEditDialog({ template, onClose, onSaved, onNavigate, registerClose, onContinue }: { template: PageTemplate | null; onClose(): void; onSaved(): Promise<void>; onNavigate(id: string): void; registerClose(handler: TemplateCloseRequest | null): void; onContinue(): void }) {
  const { resolvedTheme } = useTheme();const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [name, setName] = useState(template?.name ?? "Новый шаблон"), [description, setDescription] = useState(template?.description ?? ""), [icon, setIcon] = useState<TemplateIcon>(template?.icon as TemplateIcon ?? "file-text");
  const editor = useCreateBlockNote(sharedEditorOptions(template?.content ?? [{ type: "paragraph", content: [] }]), [template?.id ?? "new"]);
  const [initial, setInitial] = useState(() => templateEditorFingerprint({ name, description, icon, content: editor.document }));
  const [ready, setReady] = useState(false);
  const [fingerprint, setFingerprint] = useState(initial);const [busy, setBusy] = useState(false), [error, setError] = useState("");const [pending, setPending] = useState<(() => void) | null>(null);
  const [picker, setPicker] = useState(false);const openPicker = useCallback(() => setPicker(true), []);
  const dirty = initial !== templateEditorFingerprint({ name, description, icon, content: JSON.parse(fingerprint).content as unknown[] });
  useEffect(() => { const frame = requestAnimationFrame(() => { const value = templateEditorFingerprint({ name: template?.name ?? "Новый шаблон", description: template?.description ?? "", icon: template?.icon ?? "file-text", content: editor.document });setInitial(value);setFingerprint(value);setReady(true); });return () => cancelAnimationFrame(frame); }, [editor, template]);
  const requestClose = useCallback((after?: () => void) => { if (busy) return;const action = after ?? onClose;if (dirty) setPending(() => action);else action(); }, [busy, dirty, onClose]);
  useEffect(() => { registerClose(requestClose);return () => registerClose(null); }, [registerClose, requestClose]);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault();event.returnValue = ""; } };window.addEventListener("beforeunload", guard);return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  useEditorControls(editor, root);
  async function save(after?: () => void, asCopy = false) {
    setBusy(true);setError("");
    try {
      validateTemplateContent(editor.document);
      const body = { name: `${name.trim()}${asCopy ? " — копия" : ""}`, description: description || null, icon, content: editor.document, ...(template && !asCopy ? { expectedUpdatedAt: template.updatedAt } : {}) };
      if (template && !asCopy) await api(`/api/templates/${template.id}`, jsonOptions("PATCH", body));else await api("/api/templates", jsonOptions("POST", body));
      await onSaved();after?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить шаблон");setPending(null); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40"/>
    <Dialog.Content aria-describedby="template-mode-description" className="notebook-template-editor fixed inset-0 z-[60] flex flex-col bg-card sm:inset-x-auto sm:left-1/2 sm:top-[4vh] sm:h-[92vh] sm:w-[min(95vw,850px)] sm:-translate-x-1/2 sm:rounded-md" onEscapeKeyDown={event => { event.preventDefault();const suggestion = editor.getExtension(SuggestionMenu);if (suggestion?.store.state?.show) suggestion.closeMenu();else if (!picker) requestClose(); }}>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"><Dialog.Title className="flex-1 font-semibold">{template ? "Изменить шаблон" : "Новый шаблон"}</Dialog.Title><button type="button" disabled={busy || !ready} onClick={() => requestClose()} className="flex size-11 items-center justify-center rounded hover:bg-accent" aria-label="Закрыть редактор шаблона"><X size={18}/></button></header>
      <p id="template-mode-description" className="px-4 pt-2 text-xs text-muted-foreground">Шаблон · сохранение вручную. Файлы и Live Widgets добавляются после создания страницы.</p>
      <div className="grid shrink-0 gap-2 border-b border-border/50 p-3 sm:grid-cols-[1fr_1fr_140px]">
        <label className="text-xs text-muted-foreground">Название шаблона<input className="input mt-1" value={name} disabled={busy || !ready} onChange={event => setName(event.target.value)}/></label>
        <label className="text-xs text-muted-foreground">Описание шаблона<input className="input mt-1" value={description} disabled={busy || !ready} onChange={event => setDescription(event.target.value)}/></label>
        <label className="text-xs text-muted-foreground">Иконка шаблона<select className="input mt-1" value={icon} disabled={busy || !ready} onChange={event => setIcon(event.target.value as TemplateIcon)}>{TEMPLATE_ICONS.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      </div>
      {error && <div className="shrink-0 px-4 py-2"><p role="alert" className="text-sm text-destructive">{error}</p>{template && <Button variant="outline" disabled={busy} onClick={() => void save(undefined, true)}>Сохранить как новый шаблон</Button>}</div>}
      <div ref={setRoot} className="notebook-editor min-h-0 flex-1 overflow-y-auto" onKeyDownCapture={handleEditorControlKeyDown} onPasteCapture={event => handleSharedEditorPaste(event, editor, true, error => setError(error instanceof Error ? error.message : "Вставка отменена"))} onDropCapture={event => { if (event.dataTransfer.files.length) { event.preventDefault();event.stopPropagation();setError("Загрузка файлов в шаблон недоступна"); } }} onClickCapture={event => { if (handleCodeControlClick(event)) return;const anchor = (event.target as HTMLElement).closest("a");if (anchor && !anchor.closest('[data-inline-content-type="pageLink"]')) { event.preventDefault();const url = new URL(anchor.href, location.origin);const pageId = url.origin === location.origin ? pageIdFromPath(url.pathname) : null;if (pageId) requestClose(() => { onClose();onNavigate(pageId); });else if (["http:", "https:"].includes(url.protocol)) window.open(url.href, "_blank", "noopener,noreferrer");else setError("Небезопасная или недоступная ссылка"); } }}>
        <PageLinksProvider ids={[...internalPageIdsInContent(editor.document)]} adjacent={false} navigate={async id => { requestClose(() => { onClose();onNavigate(id); }); }}>
          <TableActions editor={editor} disabled={busy || !ready}/><BlockNoteView editor={editor} editable={ready && !busy} theme={isDarkTheme(resolvedTheme) ? "dark" : "light"} slashMenu={false} sideMenu={false} formattingToolbar={false} filePanel={false} onChange={() => setFingerprint(templateEditorFingerprint({ name, description, icon, content: editor.document }))}>
            <SharedEditorMenus editor={editor} mode="template" onPagePicker={openPicker}/>
          </BlockNoteView>
        </PageLinksProvider>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/60 p-3"><span role="status" className="basis-full text-xs text-muted-foreground sm:mr-auto sm:basis-auto">{dirty ? "Есть несохранённые изменения" : "Нет несохранённых изменений"}</span><Button variant="ghost" disabled={busy || !ready} onClick={() => requestClose()}>Отмена</Button><Button onClick={() => void save()} disabled={busy || !ready || !name.trim()}>{busy ? <Loader2 className="animate-spin" size={15}/> : <Save size={15}/>}Сохранить шаблон</Button></footer>
      {picker && <PageLinkPicker editor={editor} onClose={() => setPicker(false)}/>}
      <Alert.Root open={Boolean(pending)}><Alert.Portal><Alert.Overlay className="fixed inset-0 z-[110] bg-black/40"/><Alert.Content className="fixed left-1/2 top-1/2 z-[111] w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-popover p-4 text-popover-foreground"><Alert.Title className="font-semibold">Несохранённые изменения шаблона</Alert.Title><Alert.Description className="mt-2 text-sm text-muted-foreground">Сохранить изменения перед закрытием?</Alert.Description><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !ready} onClick={() => { setPending(null);onContinue(); }}>Продолжить редактирование</Button><Button variant="ghost" disabled={busy || !ready} onClick={() => { const action = pending;setPending(null);action?.(); }}>Отменить изменения и закрыть</Button><Button disabled={busy || !ready || !name.trim()} onClick={() => void save(pending ?? undefined)}>Сохранить и закрыть</Button></div></Alert.Content></Alert.Portal></Alert.Root>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
