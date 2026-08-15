"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@blocknote/core/fonts/inter.css";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useTheme } from "next-themes";
import { Check, CloudAlert, FileText, Loader2 } from "lucide-react";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { EditorSaveController, PageDocument } from "./types";
import { normalizeEditorBlocks, notebookEditorSchema, notebookSyntaxHighlighting, slashMenuItems } from "./editor-schema";

type SavePayload = { title: string; content: unknown[] };

type Mention = { id: string; title: string; sectionTitle: string; notebookTitle: string };
type EditorPreferences = { autosaveDelayMs: number; editorSpellcheck: boolean; editorCodeLineNumbers: boolean; editorCompactMode: boolean; editorContentWidth: "narrow" | "normal" | "wide" };
const defaultPreferences: EditorPreferences = { autosaveDelayMs: 750, editorSpellcheck: true, editorCodeLineNumbers: false, editorCompactMode: false, editorContentWidth: "normal" };
export function RichTextEditor({ page, onSaved, onController, onInternalNavigate }: { page: PageDocument; onSaved(page: PageDocument): void; onController(controller: EditorSaveController | null): void; onInternalNavigate(pageId: string): Promise<void> }) {
  const { resolvedTheme } = useTheme();
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [preferences, setPreferences] = useState(defaultPreferences);
  const editorRoot = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequence = useRef(0);
  const serverRevision = useRef(page.revision);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<SavePayload>({ title: page.title, content: page.content });
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useEffect(() => { let cancelled = false; void api<{ settings: EditorPreferences }>("/api/settings").then(({ settings }) => { if (!cancelled) setPreferences(settings); }).catch(() => undefined); return () => { cancelled = true; }; }, []);

  async function uploadFile(file: File) {
    const form = new FormData(); form.append("file", file); form.append("pageId", page.id);
    const result = await api<{ url: string }>("/api/uploads", { method: "POST", body: form });
    return result.url;
  }

  const editor = useCreateBlockNote({
    schema: notebookEditorSchema,
    initialContent: normalizeEditorBlocks(page.content),
    uploadFile,
    extensions: [notebookSyntaxHighlighting],
    tables: { headers: true, splitCells: true },
  }, [page.id]);

  const mentionItems = useCallback(async (query: string) => {
    const result = await api<{ pages: Mention[] }>(`/api/pages/mentions?q=${encodeURIComponent(query)}`);
    return result.pages.filter((item) => item.id !== page.id).map((item) => ({ title: item.title, subtext: `${item.notebookTitle} / ${item.sectionTitle}`, icon: <FileText size={16}/>, onItemClick: () => editor.insertInlineContent([{ type: "link", href: `/pages/${item.id}`, content: item.title }]) }));
  }, [editor, page.id]);
  const slashItems = useCallback(async (query: string) => slashMenuItems(editor, () => undefined, query), [editor]);

  const persist = useCallback((payload: SavePayload, manual = false) => {
    const sequence = ++requestSequence.current;
    setStatus("saving");
    const operation = queue.current.then(async () => {
      const result = await api<{ page: PageDocument }>(`/api/pages/${page.id}`, jsonOptions("PATCH", { ...payload, expectedRevision: serverRevision.current, snapshotReason: manual ? "manual" : "interval" }));
      serverRevision.current = result.page.revision;
      onSavedRef.current(result.page);
      if (requestSequence.current === sequence) setStatus("saved");
    });
    queue.current = operation.catch(() => { if (requestSequence.current === sequence) setStatus("error"); });
    return operation;
  }, [page.id]);

  function schedule(payload: SavePayload) {
    latest.current = payload;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void persist(payload).catch(() => undefined); }, preferences.autosaveDelayMs);
  }

  const flush = useCallback((manual = true) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return persist(latest.current, manual);
  }, [persist]);

  useEffect(() => {
    const saveNow = () => { void flush(true).catch(() => undefined); };
    window.addEventListener("notebook:save-now", saveNow);
    return () => window.removeEventListener("notebook:save-now", saveNow);
  }, [flush]);

  useEffect(() => { onController({ flush }); return () => onController(null); }, [flush, onController]);

  useEffect(() => () => {
    if (timer.current) void flush(false).catch(() => undefined);
  }, [flush]);

  useEffect(() => {
    const root = editorRoot.current; if (!root) return;
    const enhance = () => root.querySelectorAll<HTMLElement>('[data-content-type="codeBlock"]').forEach((block) => { if (block.querySelector(".notebook-code-copy")) return; const button = document.createElement("button"); button.type = "button"; button.className = "notebook-code-copy"; button.contentEditable = "false"; button.textContent = "Копировать"; button.setAttribute("aria-label", "Копировать код"); block.appendChild(button); });
    enhance(); const observer = new MutationObserver(enhance); observer.observe(root, { childList: true, subtree: true }); return () => observer.disconnect();
  }, [editor]);

  const width = preferences.editorContentWidth === "narrow" ? "max-w-3xl" : preferences.editorContentWidth === "wide" ? "max-w-6xl" : "max-w-4xl";

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className={cn("mx-auto flex w-full shrink-0 items-center gap-4 px-5 pt-7 md:px-12 md:pt-10", width)}>
      <h1 className="notebook-print-title hidden">{title}</h1><input value={title} onChange={(event) => { const nextTitle = event.target.value; setTitle(nextTitle); schedule({ title: nextTitle.trim() || "Без названия", content: editor.document }); }} placeholder="Название страницы" className="notebook-page-title-input min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 md:text-3xl" />
      <time className="notebook-print-date hidden">Изменено {new Date(page.updatedAt).toLocaleString("ru")}</time>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        {status === "saving" && <><Loader2 size={13} className="animate-spin" />Сохранение...</>}
        {status === "saved" && <><Check size={13} />Сохранено</>}
        {status === "error" && <><CloudAlert size={13} />Не сохранено</>}
      </span>
    </div>
    <div ref={editorRoot} spellCheck={preferences.editorSpellcheck} className={cn("notebook-editor mx-auto min-h-0 w-full flex-1 overflow-y-auto px-1 pb-20 pt-5 md:px-8", width, preferences.editorCompactMode && "notebook-editor-compact", preferences.editorCodeLineNumbers && "notebook-code-lines")} onClickCapture={(event) => { const target = event.target as HTMLElement; const copy = target.closest(".notebook-code-copy"); if (copy) { event.preventDefault(); const text = copy.parentElement?.querySelector("code")?.textContent ?? ""; void navigator.clipboard.writeText(text).then(() => { copy.textContent = "Скопировано"; window.setTimeout(() => { copy.textContent = "Копировать"; }, 1200); }); return; } const anchor = target.closest("a"); if (!anchor) return; if (anchor.getAttribute("href")?.startsWith("notebook-page://")) { event.preventDefault(); anchor.dataset.broken = "true"; return; } const match = new URL(anchor.href, window.location.origin).pathname.match(/^\/pages\/([^/]+)$/); if (!match?.[1]) return; event.preventDefault(); void onInternalNavigate(match[1]).catch(() => { anchor.dataset.broken = "true"; }); }}>
      <BlockNoteView editor={editor} slashMenu={false} theme={resolvedTheme === "dark" ? "dark" : "light"} onChange={() => schedule({ title: title.trim() || "Без названия", content: editor.document })}><SuggestionMenuController triggerCharacter="/" getItems={slashItems}/><SuggestionMenuController triggerCharacter="[[" getItems={mentionItems}/></BlockNoteView>
    </div>
  </div>;
}
