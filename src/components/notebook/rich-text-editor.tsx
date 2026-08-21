"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "@blocknote/core/fonts/inter.css";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useTheme } from "next-themes";
import Image from "next/image";
import { Check, CloudAlert, FileText, Loader2 } from "lucide-react";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { notebookBlockNoteDictionary } from "@/lib/i18n/blocknote";
import { t } from "@/lib/i18n/messages";
import type { EditorSaveController, PageDocument } from "./types";
import { extractPageOutline, type PageOutlineItem } from "@/lib/page-outline";
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
} from "./editor-schema";

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
              { type: "link", href: `/pages/${item.id}`, content: item.title },
            ]),
        }));
    },
    [editor, page.id],
  );
  const slashItems = useCallback(
    async (query: string) => slashMenuItems(editor, () => undefined, query),
    [editor],
  );

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

  useEffect(() => {
    onOutlineChange(extractPageOutline(editor.document));
    return () => { if (outlineTimer.current) clearTimeout(outlineTimer.current); };
  }, [editor, onOutlineChange]);

  useEffect(() => {
    const saveNow = () => {
      void flush(true).catch(() => undefined);
    };
    window.addEventListener("notebook:save-now", saveNow);
    return () => window.removeEventListener("notebook:save-now", saveNow);
  }, [flush]);

  useEffect(() => {
    onController({
      flush,
      scrollToBlock(blockId) {
        const block = Array.from(editorRoot.current?.querySelectorAll<HTMLElement>("[data-id]") ?? []).find((node) => node.dataset.id === blockId);
        block?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    });
    return () => onController(null);
  }, [flush, onController]);

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
      style={
        page.backgroundType === "image" && page.backgroundUploadId
          ? ({
              "--notebook-page-background-image": `url(/api/uploads/${page.backgroundUploadId})`,
            } as CSSProperties)
          : undefined
      }
    >
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
      </div>
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
      >
        <BlockNoteView
          editor={editor}
          slashMenu={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          onChange={() => {
            scheduleOutline();
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
          <SuggestionMenuController
            triggerCharacter="[["
            getItems={mentionItems}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
