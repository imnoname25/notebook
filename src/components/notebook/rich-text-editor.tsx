"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "@blocknote/core/fonts/inter.css";
import { SideMenuController, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useTheme } from "next-themes";
import Image from "next/image";
import { Check, CloudAlert, FileText, Loader2, Variable } from "lucide-react";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { notebookBlockNoteDictionary } from "@/lib/i18n/blocknote";
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
  notebookEditorSchema,
  notebookSyntaxHighlighting,
  slashMenuItems,
  insertLiveWidget,
} from "./editor-schema";
import { LiveWidgetPageContext } from "./live-widget-block";
import { EditorSuggestionOverlayBridge, NotebookSideMenu } from "./editor-block-menu";
import { PageVariablesDialog } from "./page-variables-dialog";
import { getPageHref, pageIdFromPath } from "@/lib/workspace-navigation";
import { extractPageVariables, type PageVariable } from "@/lib/page-variables";

type SavePayload = { title: string; content: unknown[] };

type Mention = {
  id: string;
  title: string;
  sectionTitle: string;
  notebookTitle: string;
};
type EditorPreferences = {
  autosaveDelayMs: number;
  editorSpellcheck: boolean;
  editorCodeLineNumbers: boolean;
  editorCompactMode: boolean;
  editorContentWidth: "narrow" | "normal" | "wide";
};
const defaultPreferences: EditorPreferences = {
  autosaveDelayMs: 750,
  editorSpellcheck: true,
  editorCodeLineNumbers: false,
  editorCompactMode: false,
  editorContentWidth: "normal",
};
export function RichTextEditor({
  page,
  resolvedAccent,
  onSaved,
  onController,
  onInternalNavigate,
  onOutlineChange,
}: {
  page: PageDocument;
  resolvedAccent: AccentColor;
  onSaved(page: PageDocument): void;
  onController(controller: EditorSaveController | null): void;
  onInternalNavigate(pageId: string): Promise<void>;
  onOutlineChange(items: PageOutlineItem[]): void;
}) {
  const { resolvedTheme } = useTheme();
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [preferences, setPreferences] = useState(defaultPreferences);
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
  const requestSequence = useRef(0);
  const serverRevision = useRef(page.revision);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<SavePayload>({
    title: page.title,
    content: page.content,
  });
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  useEffect(() => {
    let cancelled = false;
    void api<{ settings: EditorPreferences }>("/api/account/preferences")
      .then(({ settings }) => {
        if (!cancelled) setPreferences(settings);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  const editor = useCreateBlockNote(
    {
      schema: notebookEditorSchema,
      initialContent: normalizeEditorBlocks(page.content),
      uploadFile,
      extensions: [notebookSyntaxHighlighting],
      tables: { headers: true, splitCells: true },
      dictionary: notebookBlockNoteDictionary,
    },
    [page.id],
  );

  const mentionItems = useCallback(
    async (query: string) => {
      const result = await api<{ pages: Mention[] }>(
        `/api/pages/mentions?q=${encodeURIComponent(query)}`,
      );
      return result.pages
        .filter((item) => item.id !== page.id)
        .map((item) => ({
          title: item.title,
          subtext: `${item.notebookTitle} / ${item.sectionTitle}`,
          icon: <FileText size={16} />,
          onItemClick: () =>
            editor.insertInlineContent([
              { type: "link", href: getPageHref(item.id), content: item.title },
            ]),
        }));
    },
    [editor, page.id],
  );
  const slashItems = useCallback(
    async (query: string) => slashMenuItems(editor, () => undefined, query),
    [editor],
  );
  const sideMenu = useCallback(() => <NotebookSideMenu pageId={page.id}/>, [page.id]);

  const persist = useCallback(
    (payload: SavePayload, manual = false) => {
      const sequence = ++requestSequence.current;
      setStatus("saving");
      const operation = queue.current.then(async () => {
        const result = await api<{ page: PageDocument }>(
          `/api/pages/${page.id}`,
          jsonOptions("PATCH", {
            ...payload,
            expectedRevision: serverRevision.current,
            snapshotReason: manual ? "manual" : "interval",
          }),
        );
        serverRevision.current = result.page.revision;
        onSavedRef.current(result.page);
        if (requestSequence.current === sequence) setStatus("saved");
      });
      queue.current = operation.catch(() => {
        if (requestSequence.current === sequence) setStatus("error");
      });
      return operation;
    },
    [page.id],
  );

  function schedule(payload: SavePayload) {
    latest.current = payload;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void persist(payload).catch(() => undefined);
    }, preferences.autosaveDelayMs);
  }

  const flush = useCallback(
    (manual = true) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      return persist(latest.current, manual);
    },
    [persist],
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
      registry.set("notebook-hashtag", new HighlightConstructor(...ranges));
      registry.set("notebook-variable", new HighlightConstructor(...variableRanges));
      registry.set("notebook-variable-unknown", new HighlightConstructor(...unknownVariableRanges));
    }, 180);
  }, [editor, variables]);

  useEffect(() => {
    onOutlineChange(extractPageOutline(editor.document));
    scheduleHashtags();
    return () => {
      if (outlineTimer.current) clearTimeout(outlineTimer.current);
      if (hashtagTimer.current) clearTimeout(hashtagTimer.current);
      if (linkPreviewTimer.current) clearTimeout(linkPreviewTimer.current);
      (CSS as typeof CSS & { highlights?: { delete(name: string): void } }).highlights?.delete("notebook-hashtag");
      (CSS as typeof CSS & { highlights?: { delete(name: string): void } }).highlights?.delete("notebook-variable");
      (CSS as typeof CSS & { highlights?: { delete(name: string): void } }).highlights?.delete("notebook-variable-unknown");
    };
  }, [editor, onOutlineChange, scheduleHashtags]);

  useEffect(() => {
    const saveNow = () => {
      void flush(true).catch(() => undefined);
    };
    window.addEventListener("notebook:save-now", saveNow);
    return () => window.removeEventListener("notebook:save-now", saveNow);
  }, [flush]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: Boolean(smartPaste) }));
    const close = () => setSmartPaste(null);
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => {
      window.removeEventListener("notebook:close-editor-overlay", close);
      window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: false }));
    };
  }, [smartPaste]);

  useEffect(() => {
    onController({
      flush,
      scrollToBlock(blockId) {
        revealAndScrollBlock(editorRoot.current, blockId);
      },
      insertLiveWidget() { insertLiveWidget(editor); },
    });
    return () => onController(null);
  }, [editor, flush, onController]);

  useEffect(() => {
    const scroll = (event: Event) => revealAndScrollBlock(editorRoot.current, (event as CustomEvent<string>).detail);
    window.addEventListener("notebook:scroll-to-block", scroll);
    const match = window.location.hash.match(/^#block=(.+)$/u);
    if (match?.[1]) window.setTimeout(() => revealAndScrollBlock(editorRoot.current, decodeURIComponent(match[1]!)), 120);
    return () => window.removeEventListener("notebook:scroll-to-block", scroll);
  }, [editor]);

  useEffect(
    () => () => {
      if (timer.current) void flush(false).catch(() => undefined);
    },
    [flush],
  );

  useEffect(() => {
    const root = editorRoot.current;
    if (!root) return;
    const enhance = () =>
      root
        .querySelectorAll<HTMLElement>('[data-content-type="codeBlock"]')
        .forEach((block) => {
          if (block.querySelector(".notebook-code-copy")) return;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "notebook-code-copy";
          button.contentEditable = "false";
          button.textContent = t("editor.copyCode");
          button.setAttribute("aria-label", t("editor.copyCode"));
          block.appendChild(button);
          const wrap = document.createElement("button");
          wrap.type = "button";
          wrap.className = "notebook-code-wrap";
          wrap.contentEditable = "false";
          wrap.textContent = "Перенос";
          wrap.setAttribute("aria-label", "Переносить длинные строки");
          wrap.setAttribute("aria-pressed", "false");
          block.appendChild(wrap);
        });
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor]);

  return (
    <div
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
      <style>{"::highlight(notebook-hashtag){color:var(--page-accent);background-color:color-mix(in srgb,var(--page-accent) 14%,transparent);}"}</style>
      <style>{"::highlight(notebook-variable){color:var(--page-accent);background-color:color-mix(in srgb,var(--page-accent) 14%,transparent);}::highlight(notebook-variable-unknown){color:var(--destructive);text-decoration:underline wavy color-mix(in srgb,var(--destructive) 65%,transparent);}"}</style>
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
        <input
          value={title}
          onChange={(event) => {
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
        <button type="button" className="notebook-editor-header-action notebook-no-print" aria-label="Переменные страницы" title="Переменные страницы" onClick={() => setVariablesOpen(true)}><Variable size={16}/><span>Переменные</span></button>
      </div>
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
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          const copy = target.closest(".notebook-code-copy");
          if (copy) {
            event.preventDefault();
            const text =
              copy.parentElement?.querySelector("code")?.textContent ?? "";
            void navigator.clipboard.writeText(text).then(() => {
              copy.textContent = t("editor.copied");
              window.setTimeout(() => {
                copy.textContent = t("editor.copyCode");
              }, 1200);
            });
            return;
          }
          const wrap = target.closest<HTMLButtonElement>(".notebook-code-wrap");
          if (wrap) {
            event.preventDefault();
            const codeBlock = wrap.closest<HTMLElement>('[data-content-type="codeBlock"]');
            const enabled = !codeBlock?.classList.contains("notebook-code-wrap-enabled");
            codeBlock?.classList.toggle("notebook-code-wrap-enabled", enabled);
            wrap.setAttribute("aria-pressed", String(enabled));
            return;
          }
          const anchor = target.closest("a");
          if (!anchor) return;
          if (anchor.getAttribute("href")?.startsWith("notebook-page://")) {
            event.preventDefault();
            anchor.dataset.broken = "true";
            return;
          }
          const match = new URL(
            anchor.href,
            window.location.origin,
          ).pathname.match(/^\/pages\/([^/]+)$/);
          if (!match?.[1]) return;
          event.preventDefault();
          void onInternalNavigate(match[1]).catch(() => {
            anchor.dataset.broken = "true";
          });
        }}
        onPasteCapture={(event) => {
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
        <LiveWidgetPageContext.Provider value={page.id}><BlockNoteView
          editor={editor}
          slashMenu={false}
          sideMenu={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          onChange={() => {
            scheduleOutline();
            scheduleHashtags();
            schedule({
              title: title.trim() || t("editor.untitled"),
              content: editor.document,
            });
          }}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={slashItems}
          />
          <SideMenuController sideMenu={sideMenu}/>
          <SuggestionMenuController
            triggerCharacter="[["
            getItems={mentionItems}
          />
          <EditorSuggestionOverlayBridge/>
        </BlockNoteView></LiveWidgetPageContext.Provider>
        <PageKnowledge pageId={page.id} revision={page.revision} onNavigate={onInternalNavigate}/>
      </div>
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
  window.dispatchEvent(new CustomEvent("notebook:reveal-block", { detail: blockId }));
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const block = Array.from(root.querySelectorAll<HTMLElement>("[data-id]")).find((node) => node.dataset.id === blockId);
    if (!block) return;
    let group = block.closest<HTMLElement>(".bn-block-group");
    while (group) {
      if (group.hidden || getComputedStyle(group).display === "none") {
        const parentBlock = group.parentElement;
        parentBlock?.querySelector<HTMLButtonElement>(".bn-toggle-button")?.click();
      }
      group = group.parentElement?.closest<HTMLElement>(".bn-block-group") ?? null;
    }
    block.scrollIntoView({ behavior: "smooth", block: "center" });
    block.classList.add("notebook-block-deep-link");
    window.setTimeout(() => block.classList.remove("notebook-block-deep-link"), 1400);
  }));
}
