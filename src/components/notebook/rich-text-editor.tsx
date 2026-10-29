"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "@blocknote/core/fonts/inter.css";
import { blockToNode, nodeToBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useTheme } from "next-themes";
import { isDarkTheme } from "@/lib/themes";
import Image from "next/image";
import { Check, CloudAlert, Loader2, Variable } from "lucide-react";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/messages";
import { PageKnowledge } from "./page-knowledge";
import type { EditorSaveController, PageDocument } from "./types";
import { extractPageOutline, type PageOutlineItem } from "@/lib/page-outline";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { extractHashtags, HASHTAG_PATTERN } from "@/lib/hashtags";
import { parseSmartPasteUrl } from "@/lib/smart-paste";
import {
  ACCENT_COLORS,
  PAGE_BACKGROUND_OVERLAYS,
  PAGE_BACKGROUND_POSITIONS,
  PAGE_BACKGROUND_TYPES,
  PAGE_GRADIENTS,
  PAGE_PATTERNS,
  valueFromAllowlist,
  type AccentColor,
} from "@/lib/content-appearance";
import {
  normalizeEditorBlocks,
  insertLiveWidget,
} from "./editor-schema";
import { LiveWidgetPageContext } from "./live-widget-block";
import { EditorActivityContext, EditorSuggestionOverlayBridge } from "./editor-block-menu";
import { PageVariablesDialog } from "./page-variables-dialog";
import { blockIdFromHash, pageIdFromPath } from "@/lib/workspace-navigation";
import { EditorSaveQueue } from "@/lib/editor-save-queue";
import { unsupportedEditorBlocks } from "@/lib/editor-compatibility";
import { handleSharedEditorPaste } from "./editor-paste";
import { extractPageVariables, type PageVariable } from "@/lib/page-variables";

import { documentSearchExtension } from "./document-search-extension";
import { useDocumentSearch } from "./use-document-search";
import { SearchTitle } from "./search-title";
import type { DocumentSearchRequest } from "@/lib/document-search";

import { PageLinksProvider, PAGE_METADATA_EVENT } from "./page-link-inline";
import { PageLinkPicker } from "./page-link-picker";
import { internalPageIdsInContent } from "@/lib/portable-content";
import { useEditorControls, handleCodeControlClick, handleEditorControlKeyDown } from "./editor-controls";
import { TableActions } from "./table-actions";
import { sharedEditorBaseOptions, sharedEditorOptions, SharedEditorMenus } from "./editor-shared";
import { EditorPreferencesContext } from "./editor-preferences";


import { canonicalJson, localIdentity, cloneBlockWithIds } from "@/lib/document-state";
import { acknowledgeDraft, discardDraft, documentFingerprint, listDrafts, writeDraft, type LocalDraft } from "@/lib/local-drafts";
import { prepareBlockRecovery } from "@/lib/block-recovery";
import { RecoveryNotice } from "./recovery-notice";
import { SaveConflictPreview } from "./save-conflict-preview";

type SavePayload = { title: string; content: unknown[] };


export function RichTextEditor({
  page,
  userId,
  resolvedAccent,
  onSaved,
  onController,
  onInternalNavigate,
  onAdjacentNavigate,
  onOutlineChange,
  searchMatch,
  onSearchMatchClose,
  paneActive = true,
  navigationBusy = false,
}: {
  page: PageDocument;
  userId: string;
  resolvedAccent: AccentColor;
  onSaved(page: PageDocument): void;
  onController(controller: EditorSaveController | null): void;
  onAdjacentNavigate?(pageId: string): Promise<void>;
  onInternalNavigate(pageId: string, permanent?: boolean, blockId?: string): Promise<void>;
  onOutlineChange(items: PageOutlineItem[]): void;
  searchMatch?: DocumentSearchRequest | null;
  onSearchMatchClose(): void;
  paneActive?: boolean;
  navigationBusy?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const highlightPrefix = "notebook-" + Array.from(page.id, char => char.codePointAt(0)!.toString(16)).join("-");
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveFailure, setSaveFailure] = useState("");const [compareFailure, setCompareFailure] = useState(false);
  const preferences = useContext(EditorPreferencesContext);
  const editorRoot = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hashtagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tags, setTags] = useState(() => extractHashtags(`${page.title} ${extractBlockNoteText(page.content)}`));
  const [smartPaste, setSmartPaste] = useState<{ url: string; blockId: string } | null>(null);
  const [linkPreview, setLinkPreview] = useState<{ title: string; icon: string | null; excerpt: string; sectionTitle: string; notebookTitle: string; x: number; y: number } | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [variables, setVariables] = useState<PageVariable[]>(() => extractPageVariables(page.content));
  const serverRevision = useRef(page.revision);
  const latest = useRef<SavePayload>({
    title: page.title,
    content: page.content,
  });
  const [writerId] = useState(localIdentity);
  const [localWarning, setLocalWarning] = useState("");
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [working, setWorking] = useState(false);
  const barrier = useRef(false);const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialCanonical] = useState(() => canonicalJson({ title: page.title, content: page.content }));
  const draftSequence = useRef(0);const confirmed = useRef(initialCanonical);
  const recovered = useRef<LocalDraft | null>(null);const recoveryGeneration = useRef(0);const protectedGeneration = useRef(0);const payloadGenerations = useRef(new WeakMap<SavePayload, number>());
  const localError = useCallback((error: unknown) => setLocalWarning(error instanceof Error ? error.message : "Локальный черновик недоступен"), []);
  const persistLocal = useCallback(async () => {
    const payload = latest.current;if (canonicalJson(payload) === confirmed.current) return;
    await writeDraft({ ...payload, userId, pageId: page.id, writerId, sequence: ++draftSequence.current, baseRevision: serverRevision.current });
  }, [userId, page.id, writerId]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [candidates, fingerprint] = await Promise.all([listDrafts(userId, page.id), documentFingerprint({ title: page.title, content: page.content })]);
      const pending: LocalDraft[] = [];
      for (const draft of candidates) { if (draft.writerId === writerId) continue;if (draft.fingerprint === fingerprint) await discardDraft(draft);else pending.push(draft); }
      if (!cancelled) setDrafts(pending);
    })().catch(error => { if (!cancelled) localError(error); });
    return () => { cancelled = true; };
  }, [userId, page.id, page.revision, page.title, page.content, writerId, localError]);
  useEffect(() => () => { if (localTimer.current) clearTimeout(localTimer.current);void persistLocal().catch(() => undefined); }, [persistLocal]);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  async function uploadFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("pageId", page.id);
    const result = await api<{ url: string }>("/api/uploads", {
      method: "POST",
      body: form,
    });
    return result.url;
  }

  // This instance is keyed by page ID/epoch. Normalize its initial JSON once, not on
  // every busy/focus/outline render (useCreateBlockNote otherwise ignores new options).
  const [initialEditorOptions] = useState(() => sharedEditorOptions(page.content));
  const editor = useCreateBlockNote(
    {
      ...initialEditorOptions,
      uploadFile,
      extensions: [...sharedEditorBaseOptions.extensions, documentSearchExtension],
    },
    [page.id],
  );

  const documentSearch = useDocumentSearch(editor, title, searchMatch, onSearchMatchClose, editorRoot);

  const [blockActionsHost, setBlockActionsHost] = useState<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState(false);
  const openPagePicker = useCallback(() => setPicker(true), []);
  const [initialContentFingerprint] = useState(() => JSON.stringify(editor.document));
  const lastContentFingerprint = useRef(initialContentFingerprint);

  const send = useCallback(async (payload: SavePayload, manual: boolean) => {
        const generation = payloadGenerations.current.get(payload) ?? 0;
        await persistLocal().catch(localError);
        const result = await api<{ page: PageDocument }>(
          `/api/pages/${page.id}`,
          jsonOptions("PATCH", {
            ...payload,
            expectedRevision: serverRevision.current,
            snapshotReason: manual || generation > protectedGeneration.current ? "manual" : "interval",
          }),
        ).catch(error => { setSaveFailure(error instanceof Error ? error.message : "Ошибка сохранения");throw error; });
        setSaveFailure("");serverRevision.current = result.page.revision;confirmed.current = canonicalJson(payload);protectedGeneration.current = Math.max(protectedGeneration.current, generation);
        await acknowledgeDraft(userId, page.id, writerId, payload).catch(localError);
        if (recovered.current) {
          const adopted = recovered.current;
          if (await discardDraft(adopted, false).catch(() => false)) setDrafts(items => items.filter(item => item.key !== adopted.key));
          recovered.current = null;
        }
        if (canonicalJson(latest.current) !== confirmed.current) await persistLocal().catch(localError);
        onSavedRef.current(result.page);
        window.dispatchEvent(new Event(PAGE_METADATA_EVENT));
  }, [page.id, userId, writerId, persistLocal, localError]);
  const writer = useRef<EditorSaveQueue<SavePayload> | null>(null);
  useLayoutEffect(() => {
    if (writer.current === null) writer.current = new EditorSaveQueue<SavePayload>(latest.current, send, setStatus);
  }, [send]);

  function schedule(payload: SavePayload) {
    if (barrier.current) return;
    const fingerprint = JSON.stringify(payload.content);
    if (payload.title === latest.current.title && fingerprint === lastContentFingerprint.current) return;
    lastContentFingerprint.current = fingerprint;
    latest.current = payload;payloadGenerations.current.set(payload, recoveryGeneration.current);
    writer.current!.update(payload);
    if (localTimer.current) clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => void persistLocal().catch(localError), 300);
    window.dispatchEvent(new CustomEvent("notebook:document-dirty", { detail: page.id }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void writer.current!.save(false).catch(() => undefined);
    }, preferences.autosaveDelayMs);
  }

  const flush = useCallback(
    (manual = true) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!writer.current) return Promise.reject(new Error("Редактор ещё загружается"));
      return writer.current.flush(manual);
    },
    [],
  );

  const scheduleOutline = useCallback(() => {
    if (outlineTimer.current) clearTimeout(outlineTimer.current);
    outlineTimer.current = setTimeout(() => onOutlineChange(extractPageOutline(editor.document)), 200);
  }, [editor, onOutlineChange]);

  const scheduleHashtags = useCallback(() => {
    if (hashtagTimer.current) clearTimeout(hashtagTimer.current);
    hashtagTimer.current = setTimeout(() => {
      const text = `${latest.current.title} ${extractBlockNoteText(editor.document)}`;
      setTags(extractHashtags(text));
      const root = editorRoot.current;
      const registry = (CSS as typeof CSS & { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }).highlights;
      const HighlightConstructor = (window as typeof window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
      if (!root || !registry || !HighlightConstructor) return;
      const ranges: Range[] = [];
      const variableRanges: Range[] = [];
      const unknownVariableRanges: Range[] = [];
      const variableNames = new Set(variables.map((item) => item.name.toLocaleLowerCase("ru")));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const textNode = node as Text;
        const value = textNode.data;
        for (const match of value.matchAll(new RegExp(HASHTAG_PATTERN.source, HASHTAG_PATTERN.flags))) {
          const prefix = match[1]?.length ?? 0;
          const start = (match.index ?? 0) + prefix;
          const end = start + 1 + (match[2]?.length ?? 0);
          const range = new Range();
          range.setStart(textNode, start);
          range.setEnd(textNode, end);
          ranges.push(range);
        }
        for (const match of value.matchAll(/\{\{([\p{L}_][\p{L}\p{N}_-]{0,63})\}\}/gu)) {
          const range = new Range(); range.setStart(textNode, match.index ?? 0); range.setEnd(textNode, (match.index ?? 0) + match[0].length);
          (variableNames.has(match[1]!.toLocaleLowerCase("ru")) ? variableRanges : unknownVariableRanges).push(range);
        }
        node = walker.nextNode();
      }
      registry.set(`${highlightPrefix}-hashtag`, new HighlightConstructor(...ranges));
      registry.set(`${highlightPrefix}-variable`, new HighlightConstructor(...variableRanges));
      registry.set(`${highlightPrefix}-variable-unknown`, new HighlightConstructor(...unknownVariableRanges));
    }, 180);
  }, [editor, variables, highlightPrefix]);

  useEffect(() => {
    onOutlineChange(extractPageOutline(editor.document));
    scheduleHashtags();
    return () => {
      if (outlineTimer.current) clearTimeout(outlineTimer.current);
      if (hashtagTimer.current) clearTimeout(hashtagTimer.current);
      if (linkPreviewTimer.current) clearTimeout(linkPreviewTimer.current);
      (CSS as typeof CSS & { highlights?: { delete(name: string): void } }).highlights?.delete(`${highlightPrefix}-hashtag`);
      (CSS as typeof CSS & { highlights?: { delete(name: string): void } }).highlights?.delete(`${highlightPrefix}-variable`);
      (CSS as typeof CSS & { highlights?: { delete(name: string): void } }).highlights?.delete(`${highlightPrefix}-variable-unknown`);
    };
  }, [editor, onOutlineChange, scheduleHashtags, highlightPrefix]);

  useEffect(() => {
    const saveNow = () => {
      if (!paneActive) return;
      void flush(true).catch(() => undefined);
    };
    window.addEventListener("notebook:save-now", saveNow);
    return () => window.removeEventListener("notebook:save-now", saveNow);
  }, [flush, paneActive]);

  useEffect(() => {
    if (!paneActive) return;
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: Boolean(smartPaste) }));
    const close = () => setSmartPaste(null);
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => {
      window.removeEventListener("notebook:close-editor-overlay", close);
      window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: false }));
    };
  }, [smartPaste, paneActive]);

  useEffect(() => {
    onController({
      focus: () => editor.focus(),
      pageId: page.id,
      flush,
      isDirty: () => writer.current?.isDirty() ?? false,
      scrollToBlock(blockId) {
        revealAndScrollBlock(editorRoot.current, blockId);
      },
      insertLiveWidget() { insertLiveWidget(editor); },
      getDraft: () => ({ title: latest.current.title, content: structuredClone(editor.document), baseRevision: serverRevision.current }),
      async exclusive(operation) {
        if (barrier.current) throw new Error("Операция восстановления уже выполняется");
        barrier.current = true;setWorking(true);editor.isEditable = false;
        try { await persistLocal().catch(localError);await flush(false);await operation(); }
        finally { barrier.current = false;setWorking(false);if (!editor._tiptapEditor.isDestroyed) editor.isEditable = !navigationBusy; }
      },
      async recoverBlock(request) {
        if (barrier.current) throw new Error("Дождитесь завершения восстановления");
        const unsupported = unsupportedEditorBlocks([request.historical]);if (unsupported.length) throw new Error("Тип блока не поддерживается этим редактором. Используйте восстановление всей версии; JSON сохранён.");
        const normalize = (block: Record<string, unknown>) => nodeToBlock(blockToNode(normalizeEditorBlocks([block])[0]!, editor.pmSchema, editor.schema.styleSchema), editor._tiptapEditor.state.doc) as unknown as Record<string, unknown>;
        const normalizedRequest = { ...request, ...(request.expected ? { expected: normalize(request.expected) } : {}), ...(request.mode === "fragment" ? { historical: normalize(request.historical) } : {}) };
        const plan = prepareBlockRecovery(editor.document, normalizedRequest);recoveryGeneration.current++;
        editor.transact(() => {
          const normalized = normalizeEditorBlocks([plan.block]);
          if (plan.targetId) editor.replaceBlocks([plan.targetId], normalized);
          else editor.insertBlocks(normalized, editor.document[editor.document.length - 1]!, "after");
        });
      },
    });
    return () => onController(null);
  }, [editor, flush, onController, page.id, persistLocal, localError, navigationBusy]);

  useEffect(() => {
    const scroll = (event: Event) => { if (paneActive) revealAndScrollBlock(editorRoot.current, (event as CustomEvent<string>).detail); };
    window.addEventListener("notebook:scroll-to-block", scroll);
    const blockId = blockIdFromHash(window.location.hash);
    if (blockId && paneActive && pageIdFromPath(location.pathname) === page.id) window.setTimeout(() => revealAndScrollBlock(editorRoot.current, blockId), 120);
    return () => window.removeEventListener("notebook:scroll-to-block", scroll);
  }, [editor, paneActive, page.id]);

  useEffect(
    () => () => {
      if (timer.current) void flush(false).catch(() => undefined);
    },
    [flush],
  );

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (writer.current?.isDirty()) { event.preventDefault(); event.returnValue = ""; } };
    const background = () => { if (document.visibilityState === "hidden") { void persistLocal().catch(localError);void flush(false).catch(() => undefined); } };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("visibilitychange", background);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("visibilitychange", background); };
  }, [flush, persistLocal, localError]);

  useEditorControls(editor, editorRoot);

  return (
    <div
      data-page-id={page.id}
      className="notebook-page-surface relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-background-type={valueFromAllowlist(
        page.backgroundType,
        PAGE_BACKGROUND_TYPES,
        "default",
      )}
      data-background-color={
        valueFromAllowlist(page.backgroundColor, ACCENT_COLORS, "default") ===
        "default"
          ? resolvedAccent
          : valueFromAllowlist(page.backgroundColor, ACCENT_COLORS, "default")
      }
      data-background-gradient={valueFromAllowlist(
        page.backgroundGradient,
        PAGE_GRADIENTS,
        "dusk",
      )}
      data-background-pattern={valueFromAllowlist(
        page.backgroundPattern,
        PAGE_PATTERNS,
        "plain",
      )}
      data-background-position={valueFromAllowlist(
        page.backgroundPosition,
        PAGE_BACKGROUND_POSITIONS,
        "center",
      )}
      data-background-overlay={valueFromAllowlist(
        page.backgroundOverlay,
        PAGE_BACKGROUND_OVERLAYS,
        "medium",
      )}
      data-page-accent={resolvedAccent}
      data-appearance-preset={page.appearancePreset ?? "custom"}
      style={
        page.backgroundType === "image" && page.backgroundUploadId
          ? ({
              "--notebook-page-background-image": `url(/api/uploads/${page.backgroundUploadId})`,
            } as CSSProperties)
          : undefined
      }
    >
      <RecoveryNotice drafts={drafts} page={page} discard={async draft => { if (!await discardDraft(draft)) throw new Error("Черновик изменился в другой вкладке; откройте его заново");setDrafts(items => items.filter(item => item.key !== draft.key)); }} restore={async draft => {
        if (writer.current?.isDirty() || barrier.current) throw new Error("Сначала сохраните изменения текущего редактора или сравните их отдельно");
        if (unsupportedEditorBlocks(draft.content).length) throw new Error("Черновик содержит неизвестные блоки. Он остаётся в локальном хранилище; обновите клиент перед восстановлением.");
        const used = new Set<string>();const content = draft.content.map(raw => cloneBlockWithIds(raw as Record<string, unknown>, used));
        recovered.current = draft;recoveryGeneration.current++;latest.current = { ...latest.current, title: draft.title };setTitle(draft.title);
        editor.transact(() => editor.replaceBlocks(editor.document, normalizeEditorBlocks(content)));
        schedule({ title: draft.title, content: editor.document });
      }}/>
      {localWarning && <p role="status" className="recovery-local-warning">Локальная страховка: {localWarning}. Серверный autosave работает независимо.</p>}
      {status === "error" && <div className="recovery-local-warning" role="status">{saveFailure || "Сохранение не подтверждено"}. Текущий текст остаётся в редакторе. <button type="button" onClick={() => setCompareFailure(true)}>Сравнить с сервером</button></div>}
      {status === "error" && compareFailure && <SaveConflictPreview pageId={page.id} draft={() => ({ title: latest.current.title, content: structuredClone(editor.document) })} persist={persistLocal} onClose={() => setCompareFailure(false)}/>}
      <style>{`::highlight(${highlightPrefix}-hashtag){color:var(--page-accent);background-color:color-mix(in srgb,var(--page-accent) 14%,transparent);}`}</style>
      <style>{`::highlight(${highlightPrefix}-variable){color:var(--page-accent);background-color:color-mix(in srgb,var(--page-accent) 14%,transparent);}::highlight(${highlightPrefix}-variable-unknown){color:var(--destructive);text-decoration:underline wavy color-mix(in srgb,var(--destructive) 65%,transparent);}`}</style>
      {page.coverUploadId && (
        <div className="notebook-page-cover relative mx-5 mt-4 h-[clamp(180px,20vh,240px)] shrink-0 overflow-hidden rounded-lg md:mx-8">
          <Image
            unoptimized
            fill
            sizes="(min-width: 768px) 60vw, 100vw"
            src={`/api/uploads/${page.coverUploadId}`}
            alt=""
            className="object-cover"
          />
        </div>
      )}
      <div
        data-testid="page-editor-header"
        data-page-icon={page.icon ?? ""}
        className="notebook-editor-header flex w-full shrink-0 flex-col items-start gap-1 pt-6 md:flex-row md:items-center md:gap-4 md:pt-10"
      >
        <h1 className="notebook-print-title hidden">{title}</h1>
        <SearchTitle matches={documentSearch.titleMatches} active={documentSearch.titleActive} enabled={documentSearch.enabled} theme={resolvedTheme}
          value={title}
          aria-label="Название страницы"
          title={title}
          readOnly={navigationBusy}
          disabled={navigationBusy || working}
          onChange={(event) => {
            if (barrier.current) return;
            const nextTitle = event.target.value;
            setTitle(nextTitle);
            schedule({
              title: nextTitle.trim() || t("editor.untitled"),
              content: editor.document,
            });
            scheduleHashtags();
          }}
          placeholder={t("editor.pageTitlePlaceholder")}
          className="notebook-page-title-input w-full min-w-0 bg-transparent text-[32px] font-semibold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 md:flex-1 md:text-3xl"
        />
        <time className="notebook-print-date hidden">
          Изменено {new Date(page.updatedAt).toLocaleString("ru")}
        </time>
        <span
          className="flex min-h-6 shrink-0 items-center gap-1 text-[13.5px] text-muted-foreground/90 md:text-[12.5px]"
          aria-live="polite"
        >
          {status === "saving" && (
            <>
              <Loader2 size={12} className="animate-spin" />
              {t("editor.saving")}
            </>
          )}
          {status === "saved" && (
            <>
              <Check size={12} />
              {t("editor.saved")}
            </>
          )}
          {status === "error" && (
            <>
              <CloudAlert size={12} className="text-destructive" />
              {t("editor.saveError")}
            </>
          )}
        </span>
        {status === "error" && <button type="button" className="notebook-editor-header-action notebook-no-print" onClick={() => void flush(false).catch(() => undefined)}>Повторить сохранение</button>}
        <button type="button" className="notebook-editor-header-action notebook-no-print" aria-label="Переменные страницы" title="Переменные страницы" onClick={() => setVariablesOpen(true)}><Variable size={16}/><span>Переменные</span></button>
      </div>
      {documentSearch.toolbar}
      {tags.length > 0 && (
        <div className="notebook-editor-tags flex w-full flex-wrap gap-1.5 pt-2" aria-label={t("tags.title")}>
          {tags.map((tag) => <button key={tag.normalized} type="button" className="notebook-tag-chip" onClick={() => window.dispatchEvent(new CustomEvent("notebook:search-tag", { detail: tag.normalized }))}>#{tag.name}</button>)}
        </div>
      )}
      <div
        ref={editorRoot}
        data-testid="notebook-editor-canvas"
        data-content-width={preferences.editorContentWidth}
        spellCheck={preferences.editorSpellcheck}
        className={cn(
          "notebook-editor min-h-0 w-full flex-1 overflow-y-auto pb-20 pt-5",
          preferences.editorCompactMode && "notebook-editor-compact",
          preferences.editorCodeLineNumbers && "notebook-code-lines",
        )}
        onKeyDownCapture={handleEditorControlKeyDown}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (handleCodeControlClick(event)) return;
          const anchor = target.closest("a");
          if (!anchor) return;
          if (anchor.closest('[data-inline-content-type="pageLink"]')) return;
          if (anchor.getAttribute("href")?.startsWith("notebook-page://")) {
            event.preventDefault();
            anchor.dataset.broken = "true";
            return;
          }
          const url = new URL(anchor.href, window.location.origin);
          const pageId = pageIdFromPath(url.pathname);
          if (!pageId || url.origin !== window.location.origin) return;
          event.preventDefault();
          void onInternalNavigate(pageId, event.ctrlKey || event.metaKey, blockIdFromHash(url.hash) ?? undefined).catch(() => {
            anchor.dataset.broken = "true";
          });
        }}
        onPasteCapture={(event) => {
          if (handleSharedEditorPaste(event, editor)) return;
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
          const url = parseSmartPasteUrl(event.clipboardData.getData("text/plain"));
          if (!url) return;
          const current = editor.getTextCursorPosition().block;
          if (extractBlockNoteText([current])) return;
          event.preventDefault();
          setSmartPaste({ url, blockId: current.id });
        }}
        onMouseOverCapture={(event) => {
          if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
          const anchor = (event.target as HTMLElement).closest("a");
          if (!anchor) return;
          const linkedPageId = pageIdFromPath(new URL(anchor.href, window.location.origin).pathname);
          if (!linkedPageId) return;
          if (linkPreviewTimer.current) clearTimeout(linkPreviewTimer.current);
          const rect = anchor.getBoundingClientRect();
          linkPreviewTimer.current = setTimeout(() => {
            void api<{ preview: Omit<NonNullable<typeof linkPreview>, "x" | "y"> }>(`/api/pages/${linkedPageId}/preview`).then(({ preview }) => setLinkPreview({ ...preview, x: Math.min(rect.left, window.innerWidth - 340), y: Math.min(rect.bottom + 8, window.innerHeight - 150) })).catch(() => undefined);
          }, 400);
        }}
        onMouseOutCapture={(event) => {
          if (!(event.target as HTMLElement).closest("a")) return;
          if (linkPreviewTimer.current) clearTimeout(linkPreviewTimer.current);
          setLinkPreview(null);
        }}
      >
        <PageLinksProvider ids={[...internalPageIdsInContent(editor.document)]} adjacent={Boolean(onAdjacentNavigate)} navigate={(id, adjacent, permanent) => adjacent && onAdjacentNavigate ? onAdjacentNavigate(id) : onInternalNavigate(id, permanent)}><EditorActivityContext.Provider value={paneActive}><LiveWidgetPageContext.Provider value={page.id}><div ref={setBlockActionsHost} className="notebook-block-actions-host"/><TableActions editor={editor} disabled={navigationBusy || working}/><BlockNoteView
          editor={editor}
          editable={!navigationBusy && !working}
          formattingToolbar={false}
          slashMenu={false}
          sideMenu={false}
          theme={isDarkTheme(resolvedTheme) ? "dark" : "light"}
          onChange={() => {
            scheduleOutline();
            scheduleHashtags();
            schedule({
              title: title.trim() || t("editor.untitled"),
              content: editor.document,
            });
          }}
        >
          <SharedEditorMenus disabled={navigationBusy || working} blockActionsHost={blockActionsHost} editor={editor} pageId={page.id} onPagePicker={openPagePicker}/>
          <EditorSuggestionOverlayBridge/>
        </BlockNoteView></LiveWidgetPageContext.Provider></EditorActivityContext.Provider></PageLinksProvider>
        <PageKnowledge pageId={page.id} revision={page.revision} onNavigate={onInternalNavigate}/>
      </div>
      {picker && <PageLinkPicker editor={editor} onClose={() => setPicker(false)}/>}
      {smartPaste && <div className="notebook-smart-paste notebook-no-print absolute bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border border-border bg-popover p-3 shadow-xl" role="dialog" aria-label={t("editor.pasteAs")}><p className="mb-2 truncate text-xs text-muted-foreground">{smartPaste.url}</p><div className="grid grid-cols-3 gap-2"><button className="min-h-11 rounded-lg bg-accent px-2 text-sm font-medium" onClick={() => { editor.insertInlineContent([{ type: "link", href: smartPaste.url, content: smartPaste.url }]); setSmartPaste(null); }}>{t("editor.pasteLink")}</button><button className="min-h-11 rounded-lg bg-primary px-2 text-sm font-medium text-primary-foreground" onClick={() => { const hostname = new URL(smartPaste.url).hostname; editor.updateBlock(smartPaste.blockId, { type: "bookmark", props: { url: smartPaste.url, title: hostname, description: smartPaste.url } }); setSmartPaste(null); }}>{t("editor.pasteCard")}</button><button className="min-h-11 rounded-lg bg-accent px-2 text-sm font-medium" onClick={() => { editor.insertInlineContent(smartPaste.url); setSmartPaste(null); }}>{t("editor.pasteText")}</button></div></div>}
      {linkPreview && <aside className="notebook-no-print pointer-events-none fixed z-40 w-80 rounded-xl border border-border bg-popover p-3 shadow-xl" style={{ left: Math.max(12, linkPreview.x), top: Math.max(12, linkPreview.y) }}><div className="flex gap-2"><span className="text-xl">{linkPreview.icon ?? ""}</span><span className="min-w-0"><strong className="block truncate text-sm">{linkPreview.title}</strong><span className="block truncate text-xs text-muted-foreground">{linkPreview.notebookTitle} · {linkPreview.sectionTitle}</span></span></div>{linkPreview.excerpt && <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{linkPreview.excerpt}</p>}</aside>}
      <PageVariablesDialog open={variablesOpen} initial={variables} onOpenChange={setVariablesOpen} onApply={(next) => {
        const existing = editor.document.find((block) => block.type === "pageVariables");
        if (existing) editor.updateBlock(existing, { props: { data: JSON.stringify(next) } });
        else editor.insertBlocks([{ type: "pageVariables", props: { data: JSON.stringify(next) } }], editor.document[0]!, "before");
        setVariables(next); scheduleHashtags();
      }}/>
    </div>
  );
}

function revealAndScrollBlock(root: HTMLDivElement | null, blockId: string) {
  if (!root || !blockId) return;
  window.dispatchEvent(new CustomEvent("notebook:reveal-block", { detail: { blockId, pageId: root?.closest("[data-page-id]")?.getAttribute("data-page-id") ?? null } }));
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const block = Array.from(root.querySelectorAll<HTMLElement>("[data-id]")).find((node) => node.dataset.id === blockId);
    if (!block) return;
    const groups: HTMLElement[] = [];
    let ancestor = block.closest<HTMLElement>(".bn-block-group");
    while (ancestor) { groups.unshift(ancestor); ancestor = ancestor.parentElement?.closest<HTMLElement>(".bn-block-group") ?? null; }
    for (const group of groups) {
      if (group.hidden || getComputedStyle(group).display === "none") {
        const parentBlock = group.parentElement;
        parentBlock?.querySelector<HTMLButtonElement>('.bn-toggle-button, .notebook-toggle[data-open="false"] > button')?.click();
      }
    }
    block.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    block.classList.add("notebook-block-deep-link");
    window.setTimeout(() => block.classList.remove("notebook-block-deep-link"), 1400);
  }));
}
