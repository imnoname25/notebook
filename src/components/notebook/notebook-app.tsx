"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BookOpen,
  Download,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  StickyNote,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { EditorPane } from "./editor-pane";
import { NotebookSidebar } from "./notebook-sidebar";
import { PageList } from "./page-list";
import { SearchDialog } from "./search-dialog";
import { TrashView, type TrashItem } from "./trash-view";
import { AppearanceDialog, type NotebookAppearanceInput } from "./appearance-dialog";
import {
  PageAppearanceDialog,
  SectionAppearanceDialog,
} from "./content-appearance-dialog";
import { MoveDialog, type MoveTarget } from "./move-dialog";
import { VersionHistory } from "./version-history";
import { DataSettings } from "./data-settings";
import { SettingsDialog } from "./settings-dialog";
import { NotificationCenter } from "./notification-center";
import { MobileAppHeader } from "./mobile-app-header";
import { PrintDialog } from "./print-dialog";
import { NotebookOverview } from "./notebook-overview";
import { MobileOutlineSheet } from "./page-outline";
import { UndoToast } from "./undo-toast";
import { InboxView, QuickCapture } from "./quick-notes";
import { TagBrowser } from "./tag-browser";
import { TodayView } from "./today-view";
import {
  TemplateManager,
  TemplatePicker,
  type PageTemplate,
} from "./template-dialogs";
import type {
  EditorSaveController,
  Notebook,
  PageDocument,
  PageSummary,
  Section,
} from "./types";
import type { SearchResult } from "@/lib/services/search-service";
import {
  isNotebookColor,
  isNotebookIcon,
  NOTEBOOK_COLOR_CLASSES,
  NOTEBOOK_ICON_COMPONENTS,
} from "@/lib/notebook-appearance";
import {
  MOBILE_BACK_PROTOCOL_VERSION,
  mobileBackActionLog,
  mobileViewLogLevel,
  resolveMobileBack,
  type MobileBackResult,
  type MobileView,
} from "@/lib/mobile-navigation";
import { t } from "@/lib/i18n/messages";
import { consumeNativeShare, flushNativeAuthCookies } from "@/lib/native-android";
import type { PaletteCommand } from "@/lib/command-palette";
import type { PageOutlineItem } from "@/lib/page-outline";
import { createReversibleAction, type ReversibleAction } from "@/lib/reversible-action";
import {
  PAGE_LIST_VIEWS,
  SECTION_ACCENT_INTENSITIES,
  valueFromAllowlist,
  type PageListView,
  type SectionAccentIntensity,
} from "@/lib/content-appearance";

type ActionTarget =
  | { type: "notebook"; item: Notebook }
  | { type: "section"; item: Section }
  | { type: "page"; item: PageSummary };

type InitialLocation = {
  notebookId: string;
  sectionId: string;
  pageId: string;
};
type MobileBackRuntimeState = {
  actionTarget: ActionTarget | null;
  appearanceNotebook: Notebook | null;
  appearancePage: PageSummary | null;
  appearanceSection: Section | null;
  dataSettingsOpen: boolean;
  historyOpen: boolean;
  outlineOpen: boolean;
  mobileMenuOpen: boolean;
  mobileView: MobileView;
  moveTarget: MoveTarget | null;
  printOpen: boolean;
  screen: "workspace" | "trash" | "inbox" | "today";
  searchOpen: boolean;
  settingsOpen: boolean;
  templateManagerOpen: boolean;
  templatePickerOpen: boolean;
  quickNotesOpen: boolean;
  tagBrowserOpen: boolean;
  editorOverlayOpen: boolean;
};
const noClientSubscription = () => () => undefined;
const androidClientSnapshot = () => {
  const capacitor = (
    globalThis as typeof globalThis & {
      Capacitor?: { isNativePlatform?(): boolean };
    }
  ).Capacitor;
  return Boolean(
    capacitor?.isNativePlatform?.() ||
    new URLSearchParams(window.location.search).get("client") === "android",
  );
};
export function NotebookApp({
  user,
  initialLocation,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role: "ADMIN" | "USER";
    mustChangePassword: boolean;
  };
  initialLocation?: InitialLocation;
}) {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(
    initialLocation?.notebookId ?? null,
  );
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    initialLocation?.sectionId ?? null,
  );
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [activePage, setActivePage] = useState<PageDocument | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("navigation");
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [screen, setScreen] = useState<"workspace" | "trash" | "inbox" | "today">("workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState("");
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appearanceNotebook, setAppearanceNotebook] = useState<Notebook | null>(
    null,
  );
  const [appearanceSection, setAppearanceSection] = useState<Section | null>(
    null,
  );
  const [appearancePage, setAppearancePage] = useState<PageSummary | null>(
    null,
  );
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const [sectionAccentIntensity, setSectionAccentIntensity] =
    useState<SectionAccentIntensity>("moderate");
  const [pageListView, setPageListView] = useState<PageListView>("standard");
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [dataSettingsOpen, setDataSettingsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [outline, setOutline] = useState<PageOutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [undoAction, setUndoAction] = useState<ReversibleAction | null>(null);
  const [quickNotesOpen, setQuickNotesOpen] = useState(false);
  const [tagBrowserOpen, setTagBrowserOpen] = useState(false);
  const [tagBrowserTag, setTagBrowserTag] = useState<string | null>(null);
  const [editorOverlayOpen, setEditorOverlayOpen] = useState(false);
  const [sharedCapture, setSharedCapture] = useState<{ title: string; text: string } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const androidClient = useSyncExternalStore(
    noClientSubscription,
    androidClientSnapshot,
    () => false,
  );
  const editorController = useRef<EditorSaveController | null>(null);
  const activePageRef = useRef<PageDocument | null>(null);
  const initialPageOpened = useRef(false);
  const mobileBackStateRef = useRef<MobileBackRuntimeState | null>(null);
  const recentRecordedAt = useRef(new Map<string, number>());
  const startScreenApplied = useRef(false);

  mobileBackStateRef.current = {
    actionTarget,
    appearanceNotebook,
    appearancePage,
    appearanceSection,
    dataSettingsOpen,
    historyOpen,
    outlineOpen,
    mobileMenuOpen,
    mobileView,
    moveTarget,
    printOpen,
    screen,
    searchOpen,
    settingsOpen,
    templateManagerOpen,
    templatePickerOpen,
    quickNotesOpen,
    tagBrowserOpen,
    editorOverlayOpen,
  };

  const activeNotebook = useMemo(
    () => notebooks.find((item) => item.id === activeNotebookId) ?? null,
    [notebooks, activeNotebookId],
  );
  const activeSection = useMemo(
    () =>
      activeNotebook?.sections.find((item) => item.id === activeSectionId) ?? null,
    [activeNotebook, activeSectionId],
  );
  const ActiveNotebookIcon =
    NOTEBOOK_ICON_COMPONENTS[
      activeNotebook && isNotebookIcon(activeNotebook.icon)
        ? activeNotebook.icon
        : "notebook"
    ];
  const activeNotebookColor =
    NOTEBOOK_COLOR_CLASSES[
      activeNotebook && isNotebookColor(activeNotebook.color)
        ? activeNotebook.color
        : "slate"
    ];

  const report = useCallback((value: unknown) => {
    setError(value instanceof Error ? value.message : "Произошла ошибка");
  }, []);
  const registerEditorController = useCallback(
    (controller: EditorSaveController | null) => {
      editorController.current = controller;
    },
    [],
  );
  const recordOpenedPage = useCallback((pageId: string) => {
    const now = Date.now();
    if (now - (recentRecordedAt.current.get(pageId) ?? 0) < 30_000) return;
    recentRecordedAt.current.set(pageId, now);
    void api("/api/recent", jsonOptions("POST", { pageId })).then(() => setWorkspaceRevision((value) => value + 1)).catch(() => undefined);
  }, []);
  const loadNotebooks = useCallback(async () => {
    try {
      const result = await api<{ notebooks: Notebook[] }>("/api/notebooks");
      setNotebooks(result.notebooks);
      setActiveNotebookId((current) =>
        current && result.notebooks.some((n) => n.id === current)
          ? current
          : (result.notebooks[0]?.id ?? null),
      );
    } catch (cause) {
      report(cause);
    }
  }, [report]);

  useEffect(() => {
    const receive = () => void consumeNativeShare().then((value) => {
      if (!value) return;
      setSharedCapture(value);
      setQuickNotesOpen(true);
    });
    receive();
    window.addEventListener("notebook:native-share", receive);
    return () => window.removeEventListener("notebook:native-share", receive);
  }, []);
  useEffect(() => {
    const listener = (event: Event) => setEditorOverlayOpen(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("notebook:editor-overlay", listener);
    return () => window.removeEventListener("notebook:editor-overlay", listener);
  }, []);
  useEffect(() => {
    const openTag = (event: Event) => {
      const tag = (event as CustomEvent<string>).detail;
      setTagBrowserTag(tag);
      setTagBrowserOpen(true);
    };
    window.addEventListener("notebook:search-tag", openTag);
    return () => window.removeEventListener("notebook:search-tag", openTag);
  }, []);
  useEffect(() => {
    let cancelled = false;
    api<{ notebooks: Notebook[] }>("/api/notebooks")
      .then((result) => {
        if (cancelled) return;
        setNotebooks(result.notebooks);
        setActiveNotebookId((current) =>
          current &&
          result.notebooks.some((notebook) => notebook.id === current)
            ? current
            : (result.notebooks[0]?.id ?? null),
        );
      })
      .catch(report);
    return () => {
      cancelled = true;
    };
  }, [report]);
  useEffect(() => {
    void api<{
      settings: {
        interfaceDensity: "comfortable" | "compact";
        sectionAccentIntensity: string;
        pageListView: string;
        startScreen: "last" | "today" | "notebooks" | "inbox";
      };
    }>("/api/account/preferences")
      .then(({ settings }) => {
        setDensity(settings.interfaceDensity);
        setSectionAccentIntensity(
          valueFromAllowlist(
            settings.sectionAccentIntensity,
            SECTION_ACCENT_INTENSITIES,
            "moderate",
          ),
        );
        setPageListView(
          valueFromAllowlist(
            settings.pageListView,
            PAGE_LIST_VIEWS,
            "standard",
          ),
        );
        if (!startScreenApplied.current && !initialLocation) {
          startScreenApplied.current = true;
          if (settings.startScreen === "today") setScreen("today");
          else if (settings.startScreen === "inbox") setScreen("inbox");
          else if (settings.startScreen === "notebooks") {
            setScreen("workspace");
            setActiveSectionId(null);
            setMobileView("navigation");
          }
        }
      })
      .catch(() => undefined);
    const listener = (event: Event) =>
      setDensity((event as CustomEvent<"comfortable" | "compact">).detail);
    window.addEventListener("notebook:density", listener);
    const appearanceListener = (event: Event) => {
      const next = (
        event as CustomEvent<{
          sectionAccentIntensity: SectionAccentIntensity;
          pageListView: PageListView;
        }>
      ).detail;
      setSectionAccentIntensity(next.sectionAccentIntensity);
      setPageListView(next.pageListView);
    };
    window.addEventListener(
      "notebook:appearance-preferences",
      appearanceListener,
    );
    return () => {
      window.removeEventListener("notebook:density", listener);
      window.removeEventListener(
        "notebook:appearance-preferences",
        appearanceListener,
      );
    };
  }, [initialLocation]);
  useEffect(() => {
    if (!initialLocation || initialPageOpened.current || notebooks.length === 0)
      return;
    initialPageOpened.current = true;
    void api<{ page: PageDocument }>(`/api/pages/${initialLocation.pageId}`)
      .then(({ page }) => {
        activePageRef.current = page;
        setActivePage(page);
        setMobileView("editor");
        recordOpenedPage(page.id);
      })
      .catch(report);
  }, [initialLocation, notebooks.length, recordOpenedPage, report]);
  useEffect(() => {
    const sectionId = activeSection?.id;
    if (!sectionId) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => {
        if (activePageRef.current?.sectionId !== sectionId) {
          activePageRef.current = null;
          setActivePage(null);
        }
        setPages([]);
        setPagesLoading(true);
        return api<{ pages: PageSummary[] }>(
          `/api/pages?sectionId=${encodeURIComponent(sectionId)}`,
          { signal: controller.signal },
        );
      })
      .then((result) => setPages(result.pages))
      .catch((cause) => {
        if ((cause as Error).name !== "AbortError") report(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPagesLoading(false);
      });
    return () => controller.abort();
  }, [activeSection?.id, report, workspaceRevision]);

  function setPageUrl(pageId: string, mode: "push" | "replace" = "push") {
    const url = `/pages/${pageId}`;
    if (window.location.pathname === url) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](
      null,
      "",
      url,
    );
  }
  async function openPage(
    page: PageSummary,
    history: "push" | "replace" | "none" = "push",
  ) {
    setPageLoading(true);
    setMobileView("editor");
    try {
      const result = (
        await api<{ page: PageDocument }>(`/api/pages/${page.id}`)
      ).page;
      activePageRef.current = result;
      setActivePage(result);
      setOutline([]);
      setOutlineOpen(false);
      recordOpenedPage(result.id);
      if (history !== "none") setPageUrl(result.id, history);
    } catch (cause) {
      report(cause);
    } finally {
      setPageLoading(false);
    }
  }

  function openNotebookOverview(notebookId: string) {
    setActiveNotebookId(notebookId);
    setActiveSectionId(null);
    activePageRef.current = null;
    setActivePage(null);
    setOutline([]);
    window.history.replaceState(null, "", "/app");
    setMobileView("pages");
  }

  function openSection(section: Section) {
    setActiveNotebookId(section.notebookId);
    setActiveSectionId(section.id);
    activePageRef.current = null;
    setActivePage(null);
    setOutline([]);
    window.history.replaceState(null, "", "/app");
    setMobileView("pages");
  }

  const openPageById = useCallback(
    async (pageId: string, history: "push" | "replace" | "none" = "push") => {
      setPageLoading(true);
      try {
        const page = (await api<{ page: PageDocument }>(`/api/pages/${pageId}`))
          .page;
        const notebook = notebooks.find((item) =>
          item.sections.some((section) => section.id === page.sectionId),
        );
        if (!notebook) {
          await loadNotebooks();
          throw new Error(
            "Расположение страницы обновилось. Повторите переход",
          );
        }
        setActiveNotebookId(notebook.id);
        setActiveSectionId(page.sectionId);
        activePageRef.current = page;
        setActivePage(page);
        setOutline([]);
        setOutlineOpen(false);
        recordOpenedPage(page.id);
        setMobileView("editor");
        if (history !== "none") setPageUrl(page.id, history);
      } finally {
        setPageLoading(false);
      }
    },
    [loadNotebooks, notebooks, recordOpenedPage],
  );

  useEffect(() => {
    const pop = () => {
      const match = window.location.pathname.match(/^\/pages\/([^/]+)$/);
      if (match?.[1]) void openPageById(match[1], "none").catch(report);
      else {
        setMobileView("navigation");
        activePageRef.current = null;
        setActivePage(null);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [openPageById, report]);

  useEffect(() => {
    const androidWindow = window as Window & {
      __NOTEBOOK_ANDROID_BACK__?: () => MobileBackResult;
      __NOTEBOOK_ANDROID_BACK_VERSION__?: number;
    };
    androidWindow.__NOTEBOOK_ANDROID_BACK__ = () => {
      const state = mobileBackStateRef.current;
      if (!state) return "UNHANDLED";
      const hasOverlay =
        Boolean(state.actionTarget) ||
        state.mobileMenuOpen ||
        state.searchOpen ||
        state.outlineOpen ||
        state.historyOpen ||
        Boolean(state.appearanceNotebook) ||
        Boolean(state.appearanceSection) ||
        Boolean(state.appearancePage) ||
        Boolean(state.moveTarget) ||
        state.dataSettingsOpen ||
        state.settingsOpen ||
        state.templatePickerOpen ||
        state.templateManagerOpen ||
        state.quickNotesOpen ||
        state.tagBrowserOpen ||
        state.editorOverlayOpen ||
        state.printOpen;
      const action = resolveMobileBack({
        hasOverlay,
        screen: state.screen,
        view: state.mobileView,
      });
      console.debug("mobileBack:", {
        currentLevel: mobileViewLogLevel(state.mobileView),
        action: mobileBackActionLog(action),
      });
      if (action === "system") return "UNHANDLED";
      if (action === "close-overlay") {
        if (state.editorOverlayOpen) window.dispatchEvent(new Event("notebook:close-editor-overlay"));
        else if (state.quickNotesOpen) setQuickNotesOpen(false);
        else if (state.searchOpen) setSearchOpen(false);
        else if (state.tagBrowserOpen) setTagBrowserOpen(false);
        else if (state.actionTarget) setActionTarget(null);
        else if (state.mobileMenuOpen) setMobileMenuOpen(false);
        else if (state.outlineOpen) setOutlineOpen(false);
        else if (state.historyOpen) setHistoryOpen(false);
        else if (state.appearanceNotebook) setAppearanceNotebook(null);
        else if (state.appearanceSection) setAppearanceSection(null);
        else if (state.appearancePage) setAppearancePage(null);
        else if (state.moveTarget) setMoveTarget(null);
        else if (state.dataSettingsOpen) setDataSettingsOpen(false);
        else if (state.settingsOpen) setSettingsOpen(false);
        else if (state.templatePickerOpen) setTemplatePickerOpen(false);
        else if (state.templateManagerOpen) setTemplateManagerOpen(false);
        else if (state.printOpen) setPrintOpen(false);
        return "HANDLED";
      }
      if (action === "workspace") setScreen("workspace");
      if (action === "pages") {
        window.history.replaceState(null, "", "/app");
        setMobileView("pages");
      }
      if (action === "navigation") setMobileView("navigation");
      return "HANDLED";
    };
    androidWindow.__NOTEBOOK_ANDROID_BACK_VERSION__ =
      MOBILE_BACK_PROTOCOL_VERSION;
    return () => {
      delete androidWindow.__NOTEBOOK_ANDROID_BACK__;
      delete androidWindow.__NOTEBOOK_ANDROID_BACK_VERSION__;
    };
  }, []);

  async function addNotebook() {
    const title = window.prompt("Название блокнота");
    if (!title?.trim()) return;
    try {
      const { notebook } = await api<{ notebook: Notebook }>(
        "/api/notebooks",
        jsonOptions("POST", { title }),
      );
      setNotebooks((items) => [...items, notebook]);
      setActiveNotebookId(notebook.id);
    } catch (cause) {
      report(cause);
    }
  }
  async function addSection(notebookId: string, parentId?: string) {
    const title = window.prompt(
      parentId ? "Название вложенного раздела" : "Название раздела",
    );
    if (!title?.trim()) return;
    try {
      const { section } = await api<{ section: Section }>(
        "/api/sections",
        jsonOptions("POST", { notebookId, parentId: parentId ?? null, title }),
      );
      setNotebooks((items) =>
        items.map((n) =>
          n.id === notebookId
            ? { ...n, sections: [...n.sections, section] }
            : n,
        ),
      );
      setActiveSectionId(section.id);
      setMobileView("pages");
    } catch (cause) {
      report(cause);
    }
  }
  const addPage = useCallback(async () => {
    if (!activeSection) return;
    try {
      const { page } = await api<{ page: PageDocument }>(
        "/api/pages",
        jsonOptions("POST", {
          sectionId: activeSection.id,
          title: "Без названия",
        }),
      );
      setPages((items) => [...items, page]);
      activePageRef.current = page;
      setActivePage(page);
      setMobileView("editor");
      setPageUrl(page.id);
    } catch (cause) {
      report(cause);
    }
  }, [activeSection, report]);
  async function addPageFromTemplate(template: PageTemplate) {
    if (!activeSection) return;
    try {
      const { page } = await api<{ page: PageDocument }>(
        "/api/pages",
        jsonOptions("POST", {
          sectionId: activeSection.id,
          templateId: template.id,
        }),
      );
      setPages((items) => [...items, page]);
      activePageRef.current = page;
      setActivePage(page);
      setTemplatePickerOpen(false);
      setMobileView("editor");
      setPageUrl(page.id);
    } catch (cause) {
      report(cause);
    }
  }

  useEffect(() => {
    function hotkeys(event: KeyboardEvent) {
      if (event.key === "Escape" && focusMode) {
        event.preventDefault();
        setFocusMode(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setSearchInitialQuery("");
        setSearchOpen(true);
        return;
      }
      if (key === "n" && event.shiftKey) {
        event.preventDefault();
        setQuickNotesOpen(true);
        return;
      }
      if (key === "f" && event.shiftKey && activePage) {
        event.preventDefault();
        setFocusMode((value) => !value);
        return;
      }
      if (key === "s" && activePage) {
        event.preventDefault();
        window.dispatchEvent(new Event("notebook:save-now"));
        return;
      }
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (key === "n" && activeSection && !editing) {
        event.preventDefault();
        void addPage();
      }
    }
    window.addEventListener("keydown", hotkeys);
    return () => window.removeEventListener("keydown", hotkeys);
  }, [activePage, activeSection, addPage, focusMode]);

  async function patchAndReload(url: string, body: unknown) {
    await api(url, jsonOptions("PATCH", body));
    await loadNotebooks();
  }
  async function runAction(
    action:
      | "rename"
      | "up"
      | "down"
      | "delete"
      | "history"
      | "move"
      | "duplicate"
      | "appearance"
      | "template"
      | "print",
  ) {
    const target = actionTarget;
    setActionTarget(null);
    if (!target) return;
    try {
      if (target.type === "notebook") {
        if (action === "appearance") {
          setAppearanceNotebook(target.item);
          return;
        }
        if (action === "rename") {
          const title = window.prompt("Новое название", target.item.title);
          if (title?.trim())
            await patchAndReload(`/api/notebooks/${target.item.id}`, { title });
        } else if (action === "delete") {
          if (
            window.confirm(
              `Переместить блокнот «${target.item.title}» и его содержимое в корзину?`,
            )
          ) {
            await api(
              `/api/notebooks/${target.item.id}`,
              jsonOptions("DELETE"),
            );
            await loadNotebooks();
          }
        } else await reorderNotebooks(target.item, action === "up" ? -1 : 1);
      } else if (target.type === "section") {
        if (action === "appearance") {
          setAppearanceSection(target.item);
          return;
        }
        if (action === "move") {
          setMoveTarget({
            type: "section",
            id: target.item.id,
            currentNotebookId: target.item.notebookId,
            title: target.item.title,
          });
          return;
        }
        if (action === "rename") {
          const title = window.prompt("Новое название", target.item.title);
          if (title?.trim())
            await patchAndReload(`/api/sections/${target.item.id}`, { title });
        } else if (action === "delete") {
          if (
            window.confirm(
              `Переместить раздел «${target.item.title}» и его содержимое в корзину?`,
            )
          ) {
            await api(`/api/sections/${target.item.id}`, jsonOptions("DELETE"));
            await loadNotebooks();
          }
        } else await reorderSections(target.item, action === "up" ? -1 : 1);
      } else {
        if (action === "appearance") {
          setAppearancePage(target.item);
          return;
        }
        if (action === "template") {
          const name = window.prompt("Название шаблона", target.item.title);
          if (name?.trim()) {
            await api(
              "/api/templates",
              jsonOptions("POST", {
                name,
                icon: "file-text",
                sourcePageId: target.item.id,
              }),
            );
            setNotice("Шаблон создан");
          }
          return;
        }
        if (action === "print") {
          if (activePageRef.current?.id !== target.item.id)
            await openPage(target.item);
          setPrintOpen(true);
          return;
        }
        if (action === "move") {
          setMoveTarget({
            type: "page",
            id: target.item.id,
            currentSectionId: target.item.sectionId,
            title: target.item.title,
          });
          return;
        }
        if (action === "history") {
          if (activePageRef.current?.id !== target.item.id)
            await openPage(target.item);
          setHistoryOpen(true);
          return;
        }
        if (action === "duplicate") {
          const { page } = await api<{ page: PageDocument }>(
            `/api/pages/${target.item.id}/duplicate`,
            jsonOptions("POST"),
          );
          setPages((items) =>
            [...items, page].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            ),
          );
          activePageRef.current = page;
          setActivePage(page);
          setEditorEpoch((value) => value + 1);
          setPageUrl(page.id);
          return;
        }
        if (action === "rename") {
          const title = window.prompt("Новое название", target.item.title);
          if (title?.trim()) {
            const { page } = await api<{ page: PageDocument }>(
              `/api/pages/${target.item.id}`,
              jsonOptions("PATCH", { title }),
            );
            pageSaved(page);
          }
        } else if (action === "delete") {
          if (
            window.confirm(
              `Переместить страницу «${target.item.title}» в корзину?`,
            )
          ) {
            await api(`/api/pages/${target.item.id}`, jsonOptions("DELETE"));
            setPages((items) => items.filter((p) => p.id !== target.item.id));
            if (activePageRef.current?.id === target.item.id) {
              activePageRef.current = null;
              setActivePage(null);
              window.history.pushState(null, "", "/app");
            }
            setUndoAction(createReversibleAction(t("undo.trashed"), async () => {
              await api("/api/trash/restore", jsonOptions("POST", { type: "page", id: target.item.id }));
              setActiveNotebookId(activeNotebook?.id ?? null);
              setActiveSectionId(target.item.sectionId);
              setWorkspaceRevision((value) => value + 1);
              await openPageById(target.item.id, "replace");
            }));
          }
        } else await reorderPages(target.item, action === "up" ? -1 : 1);
      }
    } catch (cause) {
      report(cause);
    }
  }

  async function reorderNotebooks(item: Notebook, delta: number) {
    const ordered = [...notebooks].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((n) => n.id === item.id);
    const other = ordered[index + delta];
    if (!other) return;
    const ids = ordered.map((entry) => entry.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    await saveNotebookOrder(ids);
  }
  async function reorderSections(item: Section, delta: number) {
    const siblings = (activeNotebook?.sections ?? [])
      .filter((s) => s.parentId === item.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const index = siblings.findIndex((s) => s.id === item.id);
    const other = siblings[index + delta];
    if (!other) return;
    const ids = siblings.map((entry) => entry.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    await saveSectionOrder(item.notebookId, item.parentId, ids);
  }
  async function reorderPages(item: PageSummary, delta: number) {
    const ordered = [...pages].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((p) => p.id === item.id);
    const other = ordered[index + delta];
    if (!other) return;
    const ids = ordered.map((entry) => entry.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    await savePageOrder(ids);
  }
  async function saveNotebookOrder(ids: string[]) {
    const snapshot = notebooks;
    setNotebooks((items) =>
      items.map((item) => ({ ...item, sortOrder: ids.indexOf(item.id) })),
    );
    try {
      await api("/api/reorder/notebooks", jsonOptions("POST", { ids }));
    } catch (cause) {
      setNotebooks(snapshot);
      report(cause);
    }
  }
  async function saveSectionOrder(
    notebookId: string,
    parentId: string | null,
    ids: string[],
  ) {
    const snapshot = notebooks;
    setNotebooks((items) =>
      items.map((notebook) =>
        notebook.id !== notebookId
          ? notebook
          : {
              ...notebook,
              sections: notebook.sections.map((section) =>
                ids.includes(section.id)
                  ? { ...section, sortOrder: ids.indexOf(section.id) }
                  : section,
              ),
            },
      ),
    );
    try {
      await api(
        "/api/reorder/sections",
        jsonOptions("POST", { notebookId, parentId, ids }),
      );
    } catch (cause) {
      setNotebooks(snapshot);
      report(cause);
    }
  }
  async function savePageOrder(ids: string[]) {
    if (!activeSection) return;
    const snapshot = pages;
    setPages((items) =>
      items.map((item) => ({ ...item, sortOrder: ids.indexOf(item.id) })),
    );
    try {
      await api(
        "/api/reorder/pages",
        jsonOptions("POST", { sectionId: activeSection.id, ids }),
      );
    } catch (cause) {
      setPages(snapshot);
      report(cause);
    }
  }
  function pageSaved(page: PageDocument) {
    setPages((items) =>
      items.map((item) => (item.id === page.id ? { ...item, ...page } : item)),
    );
    if (activePageRef.current?.id === page.id) activePageRef.current = page;
    setActivePage((current) => (current?.id === page.id ? page : current));
  }

  async function openSearchResult(result: SearchResult) {
    setSearchOpen(false);
    if (result.type === "tag") {
      setTagBrowserTag(result.id);
      setTagBrowserOpen(true);
      return;
    }
    if (result.type === "quickNote") {
      setScreen("inbox");
      setMobileView("navigation");
      return;
    }
    setScreen("workspace");
    if (result.type === "notebook") {
      openNotebookOverview(result.notebookId);
      return;
    }
    if (result.type === "section") {
      const notebook = notebooks.find((item) => item.id === result.notebookId);
      const section = notebook?.sections.find((item) => item.id === result.id);
      if (section) openSection(section);
      return;
    }
    try {
      await openPageById(result.id);
    } catch (cause) {
      report(cause);
    }
  }

  async function logout() {
    await api("/api/auth/logout", jsonOptions("POST"));
    await flushNativeAuthCookies();
    router.replace("/login");
    router.refresh();
  }
  async function logoutAll() {
    if (!window.confirm("Выйти на всех устройствах, включая это?")) return;
    await api("/api/auth/logout-all", jsonOptions("POST"));
    await flushNativeAuthCookies();
    router.replace("/login");
    router.refresh();
  }
  function changeAndroidServer() {
    if (!window.confirm(t("mobile.changeServerConfirm"))) return;
    window.location.replace("https://localhost/?changeServer=1");
  }

  async function saveAppearance(input: NotebookAppearanceInput) {
    if (!appearanceNotebook) return;
    try {
      await api(
        `/api/notebooks/${appearanceNotebook.id}`,
        jsonOptions("PATCH", input),
      );
      await loadNotebooks();
    } catch (cause) {
      report(cause);
      throw cause;
    }
  }

  async function moveSelected(destinationId: string) {
    const target = moveTarget;
    if (!target) return;
    try {
      if (target.type === "page") {
        const sourceSectionId = target.currentSectionId;
        if (activePageRef.current?.id === target.id)
          await editorController.current?.flush(false);
        const { page } = await api<{ page: PageDocument }>(
          `/api/pages/${target.id}/move`,
          jsonOptions("POST", { destinationSectionId: destinationId }),
        );
        const notebook = notebooks.find((item) =>
          item.sections.some((section) => section.id === destinationId),
        );
        setPages((items) => items.filter((item) => item.id !== target.id));
        setActiveNotebookId(notebook?.id ?? null);
        setActiveSectionId(destinationId);
        activePageRef.current = page;
        setActivePage(page);
        setMobileView("editor");
        setPageUrl(page.id, "replace");
        setUndoAction(createReversibleAction(t("undo.moved"), async () => {
          const { page: restored } = await api<{ page: PageDocument }>(
            `/api/pages/${target.id}/move`,
            jsonOptions("POST", { destinationSectionId: sourceSectionId }),
          );
          const sourceNotebook = notebooks.find((item) => item.sections.some((section) => section.id === sourceSectionId));
          setActiveNotebookId(sourceNotebook?.id ?? null);
          setActiveSectionId(sourceSectionId);
          activePageRef.current = restored;
          setActivePage(restored);
          setWorkspaceRevision((value) => value + 1);
          setPageUrl(restored.id, "replace");
        }));
      } else {
        const sourceNotebookId = target.currentNotebookId;
        await api(
          `/api/sections/${target.id}/move`,
          jsonOptions("POST", { destinationNotebookId: destinationId }),
        );
        await loadNotebooks();
        setActiveNotebookId(destinationId);
        setActiveSectionId(target.id);
        setMobileView("pages");
        setUndoAction(createReversibleAction(t("undo.sectionMoved"), async () => {
          await api(`/api/sections/${target.id}/move`, jsonOptions("POST", { destinationNotebookId: sourceNotebookId }));
          await loadNotebooks();
          setActiveNotebookId(sourceNotebookId);
          setActiveSectionId(target.id);
          setWorkspaceRevision((value) => value + 1);
        }));
      }
      setMoveTarget(null);
      setWorkspaceRevision((value) => value + 1);
    } catch (cause) {
      report(cause);
    }
  }

  async function restoreVersion(versionId: string) {
    try {
      await editorController.current?.flush(false);
      const current = activePageRef.current;
      if (!current) return;
      const { page } = await api<{ page: PageDocument }>(
        `/api/pages/${current.id}/versions/${versionId}/restore`,
        jsonOptions("POST", { expectedRevision: current.revision }),
      );
      activePageRef.current = page;
      setActivePage(page);
      pageSaved(page);
      setEditorEpoch((value) => value + 1);
    } catch (cause) {
      report(cause);
      throw cause;
    }
  }

  async function copyPageLink(page: PageSummary) {
    const link = `${window.location.origin}/pages/${page.id}`;
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(link);
      else {
        const field = document.createElement("textarea");
        field.value = link;
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      setNotice("Ссылка на страницу скопирована");
    } catch {
      report(new Error("Не удалось скопировать ссылку"));
    }
  }

  const paletteCommands: PaletteCommand[] = [
    {
      id: "new-page",
      title: t("commands.newPage"),
      aliases: ["page", "страница", "создать"],
      disabled: !activeSection,
      run: () => void addPage(),
    },
    {
      id: "quick-note",
      title: t("commands.quickNote"),
      aliases: ["note", "capture", "заметка", "стикер"],
      run: () => setQuickNotesOpen(true),
    },
    {
      id: "new-section",
      title: t("commands.newSection"),
      aliases: ["section", "раздел"],
      disabled: !activeNotebook,
      run: () => activeNotebook && void addSection(activeNotebook.id),
    },
    {
      id: "new-notebook",
      title: t("commands.newNotebook"),
      aliases: ["notebook", "блокнот"],
      run: () => void addNotebook(),
    },
    {
      id: "inbox",
      title: t("commands.openInbox"),
      aliases: ["inbox", "входящие"],
      run: () => { setScreen("inbox"); setMobileView("navigation"); },
    },
    {
      id: "today",
      title: t("commands.openToday"),
      aliases: ["today", "сегодня", "главная"],
      run: () => { setScreen("today"); setMobileView("navigation"); },
    },
    {
      id: "tags",
      title: t("commands.openTags"),
      aliases: ["tags", "теги", "хештеги"],
      run: () => { setTagBrowserTag(null); setTagBrowserOpen(true); },
    },
    {
      id: "theme",
      title: t("commands.toggleTheme"),
      aliases: ["theme", "dark", "light", "тема", "тёмная", "светлая"],
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    },
    {
      id: "settings",
      title: t("commands.settings"),
      aliases: ["settings", "настройки"],
      run: () => setSettingsOpen(true),
    },
    {
      id: "live-widget",
      title: "Новый Live Widget",
      aliases: ["status", "widget", "виджет", "проверка"],
      disabled: !activePage,
      run: () => editorController.current?.insertLiveWidget(),
    },
    {
      id: "focus",
      title: t("commands.focus"),
      aliases: ["focus", "zen", "фокус"],
      disabled: !activePage,
      run: () => setFocusMode(true),
    },
  ];

  return (
    <div
      data-density={density}
      data-focus-mode={focusMode ? "true" : "false"}
      className="notebook-app-shell flex h-dvh flex-col overflow-hidden bg-background text-foreground"
    >
      <MobileAppHeader
        userName={user.name}
        isAdmin={user.role === "ADMIN"}
        theme={theme}
        resolvedTheme={resolvedTheme}
        menuOpen={mobileMenuOpen}
        androidClient={androidClient}
        onMenu={() => {
          setScreen("workspace");
          setMobileView("navigation");
        }}
        onSearch={() => { setSearchInitialQuery(""); setSearchOpen(true); }}
        onQuickNotes={() => setQuickNotesOpen(true)}
        onMenuOpenChange={setMobileMenuOpen}
        onSettings={() => setSettingsOpen(true)}
        onTheme={() =>
          setTheme(
            theme === "system"
              ? "light"
              : theme === "light"
                ? "dark"
                : "system",
          )
        }
        onChangeServer={changeAndroidServer}
        onLogout={() => void logout()}
        onLogoutAll={() => void logoutAll()}
        onError={report}
      />
      <header
        data-testid="desktop-app-header"
        className="notebook-no-print hidden h-14 shrink-0 items-center border-b border-border/60 px-4 md:flex"
      >
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen size={17} />
          </span>
          Notebook
        </div>
        {activeNotebook && (
          <div className="ml-4 hidden min-w-0 items-center gap-2 border-l border-border/60 pl-4 text-sm sm:flex">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md text-white",
                activeNotebookColor,
              )}
            >
              <ActiveNotebookIcon size={14} />
            </span>
            <span className="max-w-40 truncate">{activeNotebook.title}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {user.role === "ADMIN" && <NotificationCenter onError={report} />}
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t("quickNotes.title")}
            title={`${t("quickNotes.title")} (Ctrl/Cmd + Shift + N)`}
            onClick={() => setQuickNotesOpen(true)}
          >
            <StickyNote size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Поиск"
            title="Поиск (Ctrl/Cmd + K)"
            onClick={() => { setSearchInitialQuery(""); setSearchOpen(true); }}
          >
            <Search size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Настройки"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Переключить тему"
            title={`Тема: ${theme === "system" ? "системная" : theme === "dark" ? "тёмная" : "светлая"}`}
            onClick={() =>
              setTheme(
                theme === "system"
                  ? "light"
                  : theme === "light"
                    ? "dark"
                    : "system",
              )
            }
          >
            {theme === "system" ? (
              <Monitor size={17} />
            ) : resolvedTheme === "dark" ? (
              <Moon size={17} />
            ) : (
              <Sun size={17} />
            )}
          </Button>
          <span className="hidden px-2 text-xs text-muted-foreground sm:block">
            {user.name}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Выйти"
            onClick={() => void logout()}
          >
            <LogOut size={17} />
          </Button>
        </div>
      </header>
      {error && (
        <button
          className="bg-destructive px-4 py-2 text-left text-sm text-white"
          onClick={() => setError("")}
        >
          {error} · нажмите, чтобы закрыть
        </button>
      )}
      {notice && (
        <button
          className="bg-accent px-4 py-2 text-left text-sm"
          onClick={() => setNotice("")}
        >
          {notice} · нажмите, чтобы закрыть
        </button>
      )}
      <div className="grid min-h-0 flex-1 md:grid-cols-[280px_320px_minmax(0,1fr)]">
        {screen === "trash" ? (
          <TrashView
            key={workspaceRevision}
            onBack={() => setScreen("workspace")}
            onChanged={() => {
              void loadNotebooks();
              setWorkspaceRevision((value) => value + 1);
            }}
            onRestored={(item: TrashItem) => {
              if (item.type !== "page") return;
              setUndoAction(createReversibleAction(t("undo.restored"), async () => {
                await api(`/api/pages/${item.id}`, jsonOptions("DELETE"));
                setWorkspaceRevision((value) => value + 1);
              }));
            }}
            onError={report}
          />
        ) : screen === "inbox" ? (
          <InboxView
            notebooks={notebooks}
            revision={workspaceRevision}
            onBack={() => setScreen("workspace")}
            onError={report}
            onTag={(tag) => {
              setSearchInitialQuery(`#${tag}`);
              setSearchOpen(true);
            }}
            onConverted={(page) => {
              const notebook = notebooks.find((item) => item.sections.some((section) => section.id === page.sectionId));
              setScreen("workspace");
              setActiveNotebookId(notebook?.id ?? null);
              setActiveSectionId(page.sectionId);
              activePageRef.current = page;
              setActivePage(page);
              setWorkspaceRevision((value) => value + 1);
              setMobileView("editor");
              setPageUrl(page.id);
            }}
          />
        ) : screen === "today" ? (
          <TodayView
            revision={workspaceRevision}
            onBack={() => setScreen("workspace")}
            onCapture={() => setQuickNotesOpen(true)}
            onInbox={() => setScreen("inbox")}
            onPage={(id) => {
              setScreen("workspace");
              void openPageById(id).catch(report);
            }}
            onTag={(tag) => {
              setTagBrowserTag(tag);
              setTagBrowserOpen(true);
            }}
            onError={report}
          />
        ) : (
          <>
            <div
              data-mobile-screen="navigation"
              className={cn(
                "notebook-no-print min-h-0 min-w-0",
                mobileView !== "navigation" && "hidden md:block",
              )}
            >
              <NotebookSidebar
                notebooks={notebooks}
                activeNotebookId={activeNotebookId}
                activeSectionId={activeSection?.id ?? null}
                sectionAccentIntensity={sectionAccentIntensity}
                onNotebookSelect={(id) => {
                  openNotebookOverview(id);
                }}
                onSectionSelect={(section) => {
                  openSection(section);
                }}
                onAddNotebook={addNotebook}
                onNotebookMenu={(item) =>
                  setActionTarget({ type: "notebook", item })
                }
                onAddSection={addSection}
                onSectionMenu={(item) =>
                  setActionTarget({ type: "section", item })
                }
                onNotebookReorder={(ids) => void saveNotebookOrder(ids)}
                onSectionReorder={(notebookId, parentId, ids) =>
                  void saveSectionOrder(notebookId, parentId, ids)
                }
                onTrashOpen={() => setScreen("trash")}
                onInboxOpen={() => {
                  setScreen("inbox");
                  setMobileView("navigation");
                }}
                onTodayOpen={() => {
                  setScreen("today");
                  setMobileView("navigation");
                }}
                onTagsOpen={() => {
                  setTagBrowserTag(null);
                  setTagBrowserOpen(true);
                }}
              />
            </div>
            <div
              data-mobile-screen="pages"
              className={cn(
                "notebook-no-print min-h-0 min-w-0",
                mobileView !== "pages" && "hidden md:block",
              )}
            >
              {activeNotebook && !activeSection ? <div className="h-full md:hidden"><NotebookOverview notebook={activeNotebook} revision={workspaceRevision} onSection={openSection} onPage={(id) => void openPageById(id).catch(report)} onAddSection={() => void addSection(activeNotebook.id)} onError={report} onBack={() => setMobileView("navigation")} /></div> : <PageList
                section={activeSection}
                pages={pages}
                activePageId={activePage?.id ?? null}
                loading={pagesLoading}
                notebookColor={activeNotebook?.color}
                viewMode={pageListView}
                onViewModeChange={(mode) => {
                  const previous = pageListView;
                  setPageListView(mode);
                  void api(
                    "/api/account/preferences",
                    jsonOptions("PATCH", { pageListView: mode }),
                  ).catch((cause) => {
                    setPageListView(previous);
                    report(cause);
                  });
                }}
                onBack={() => setMobileView("navigation")}
                onAdd={addPage}
                onAddFromTemplate={() => setTemplatePickerOpen(true)}
                onSelect={openPage}
                onMenu={(item) => setActionTarget({ type: "page", item })}
                onReorder={(ids) => void savePageOrder(ids)}
                onFavorite={async (item) => {
                  try {
                    const { page } = await api<{ page: PageDocument }>(
                      `/api/pages/${item.id}`,
                      jsonOptions("PATCH", { isFavorite: !item.isFavorite }),
                    );
                    pageSaved(page);
                  } catch (cause) {
                    report(cause);
                  }
                }}
              />}
            </div>
            <div
              data-mobile-screen="editor"
              className={cn(
                "min-h-0 min-w-0",
                mobileView !== "editor" && "hidden md:block",
              )}
            >
              {activeNotebook && !activeSection && !activePage ? <NotebookOverview notebook={activeNotebook} revision={workspaceRevision} onSection={openSection} onPage={(id) => void openPageById(id).catch(report)} onAddSection={() => void addSection(activeNotebook.id)} onError={report} onBack={() => setMobileView("navigation")} /> : <EditorPane
                page={activePage}
                notebook={activeNotebook}
                section={activeSection}
                loading={pageLoading}
                editorEpoch={editorEpoch}
                onBack={() => {
                  window.history.replaceState(null, "", "/app");
                  setMobileView("pages");
                }}
                onSaved={pageSaved}
                onController={registerEditorController}
                onNotebookClick={() => activeNotebook && openNotebookOverview(activeNotebook.id)}
                onSectionClick={() => activeSection && openSection(activeSection)}
                outline={outline}
                outlineVisible={outlineVisible}
                onOutlineChange={setOutline}
                onOutlineToggle={() => {
                  if (window.matchMedia("(max-width: 767px)").matches) setOutlineOpen(true);
                  else setOutlineVisible((value) => !value);
                }}
                onOutlineSelect={(id) => editorController.current?.scrollToBlock(id)}
                onCreatePage={() => void addPage()}
                onInternalNavigate={async (pageId) => {
                  try {
                    await openPageById(pageId);
                  } catch (cause) {
                    report(cause);
                    throw cause;
                  }
                }}
              />}
            </div>
          </>
        )}
      </div>
      <SearchDialog
        key={`${searchOpen ? "open" : "closed"}:${searchInitialQuery}`}
        open={searchOpen}
        initialQuery={searchInitialQuery}
        onOpenChange={setSearchOpen}
        onSelect={(result) => void openSearchResult(result)}
        commands={paletteCommands}
      />
      <QuickCapture
        key={sharedCapture ? `share:${sharedCapture.title}:${sharedCapture.text.length}` : "capture"}
        open={quickNotesOpen}
        initialTitle={sharedCapture?.title}
        initialBody={sharedCapture?.text}
        onOpenChange={(open) => { setQuickNotesOpen(open); if (!open) setSharedCapture(null); }}
        onError={report}
        onSaved={() => {
          setWorkspaceRevision((value) => value + 1);
          setNotice(t("quickNotes.savedInbox"));
        }}
      />
      <TagBrowser
        key={`${tagBrowserOpen ? "open" : "closed"}:${tagBrowserTag ?? "index"}`}
        open={tagBrowserOpen}
        initialTag={tagBrowserTag}
        onOpenChange={setTagBrowserOpen}
        onError={report}
        onPage={(id) => {
          setTagBrowserOpen(false);
          void openPageById(id).catch(report);
        }}
        onInbox={() => {
          setTagBrowserOpen(false);
          setScreen("inbox");
          setMobileView("navigation");
        }}
      />
      {screen === "workspace" && mobileView !== "editor" && (
        <button
          className="notebook-no-print fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-black/20 md:hidden"
          aria-label={t("quickNotes.create")}
          onClick={() => setQuickNotesOpen(true)}
        >
          <StickyNote size={24}/>
        </button>
      )}
      {actionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"
          onMouseDown={() => setActionTarget(null)}
        >
          <div
            className="notebook-action-sheet w-full max-w-xs rounded-2xl bg-card p-2 shadow-xl ring-1 ring-border"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="truncate px-3 py-2 text-sm font-semibold">
              {actionTarget.item.title}
            </p>
            <button
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => void runAction("rename")}
            >
              Переименовать
            </button>
            {actionTarget.type === "notebook" && (
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void runAction("appearance")}
              >
                Настроить блокнот
              </button>
            )}
            {actionTarget.type === "notebook" && (
              <a
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                href={`/api/data/export/notebook/${actionTarget.item.id}`}
              >
                <span className="inline-flex items-center gap-2">
                  <Download size={14} />
                  Экспортировать блокнот
                </span>
              </a>
            )}
            {actionTarget.type === "section" && (
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void runAction("move")}
              >
                Переместить раздел
              </button>
            )}
            {actionTarget.type === "section" && (
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void runAction("appearance")}
              >
                Оформление раздела
              </button>
            )}
            {actionTarget.type === "page" && (
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void runAction("appearance")}
              >
                Оформление
              </button>
            )}
            {actionTarget.type === "page" && (
              <>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void runAction("history")}
                >
                  История версий
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void runAction("move")}
                >
                  Переместить
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void runAction("duplicate")}
                >
                  Дублировать страницу
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void runAction("template")}
                >
                  Сохранить как шаблон
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void runAction("print")}
                >
                  Экспорт → Печать / PDF
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    void copyPageLink(actionTarget.item);
                    setActionTarget(null);
                  }}
                >
                  <Link2 size={14} />
                  Копировать ссылку
                </button>
                <a
                  className="block w-full rounded-lg px-3 py-2 text-sm hover:bg-accent"
                  href={`/api/data/export/page/${actionTarget.item.id}?format=markdown`}
                >
                  Экспортировать страницу · Markdown
                </a>
                <a
                  className="block w-full rounded-lg px-3 py-2 text-sm hover:bg-accent"
                  href={`/api/data/export/page/${actionTarget.item.id}?format=html`}
                >
                  Экспортировать страницу · standalone HTML
                </a>
                <a
                  className="block w-full rounded-lg px-3 py-2 text-sm hover:bg-accent"
                  href={`/api/data/export/page/${actionTarget.item.id}?format=json`}
                >
                  Экспортировать страницу · Notebook JSON
                </a>
              </>
            )}
            <button
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => void runAction("up")}
            >
              Переместить выше
            </button>
            <button
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => void runAction("down")}
            >
              Переместить ниже
            </button>
            <button
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
              onClick={() => void runAction("delete")}
            >
              Переместить в корзину
            </button>
            <button
              className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => setActionTarget(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      {appearanceNotebook && (
        <AppearanceDialog
          key={appearanceNotebook.id}
          notebook={appearanceNotebook}
          open
          onOpenChange={(open) => {
            if (!open) setAppearanceNotebook(null);
          }}
          onSave={saveAppearance}
        />
      )}
      {appearanceSection && (
        <SectionAppearanceDialog
          section={appearanceSection}
          onClose={() => setAppearanceSection(null)}
          onSaved={(section) => {
            setNotebooks((items) =>
              items.map((notebook) =>
                notebook.id === section.notebookId
                  ? {
                      ...notebook,
                      sections: notebook.sections.map((item) =>
                        item.id === section.id ? section : item,
                      ),
                    }
                  : notebook,
              ),
            );
          }}
          onError={report}
        />
      )}
      {appearancePage && (
        <PageAppearanceDialog
          page={appearancePage}
          onClose={() => setAppearancePage(null)}
          onSaved={(page) => {
            setPages((items) =>
              items.map((item) =>
                item.id === page.id ? { ...item, ...page } : item,
              ),
            );
            if (activePageRef.current?.id === page.id) {
              activePageRef.current = { ...activePageRef.current, ...page };
              setActivePage(activePageRef.current);
            }
          }}
          onError={report}
        />
      )}
      <MoveDialog
        target={moveTarget}
        notebooks={notebooks}
        open={Boolean(moveTarget)}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null);
        }}
        onMove={moveSelected}
      />
      {historyOpen && (
        <VersionHistory
          key={activePage?.id}
          page={activePage}
          open
          onOpenChange={setHistoryOpen}
          onRestore={restoreVersion}
        />
      )}
      <DataSettings
        open={dataSettingsOpen}
        onOpenChange={setDataSettingsOpen}
        notebooks={notebooks}
        activeSectionId={activeSection?.id ?? null}
        onChanged={async () => {
          await loadNotebooks();
          setWorkspaceRevision((value) => value + 1);
        }}
        onOpenPage={(pageId) => {
          setDataSettingsOpen(false);
          void openPageById(pageId).catch(report);
        }}
        onError={report}
      />
      <SettingsDialog
        user={user}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onDataOpen={() => setDataSettingsOpen(true)}
        onTemplatesOpen={() => {
          setSettingsOpen(false);
          setTemplateManagerOpen(true);
        }}
        onError={report}
      />
      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={addPageFromTemplate}
        onError={report}
      />
      <TemplateManager
        open={templateManagerOpen}
        onOpenChange={setTemplateManagerOpen}
        onError={report}
      />
      <PrintDialog open={printOpen} onOpenChange={setPrintOpen} />
      <MobileOutlineSheet
        open={outlineOpen}
        items={outline}
        onOpenChange={setOutlineOpen}
        onSelect={(id) => {
          setOutlineOpen(false);
          editorController.current?.scrollToBlock(id);
        }}
      />
      <UndoToast action={undoAction} onClose={() => setUndoAction(null)} onError={(cause) => { setUndoAction(null); report(cause); }} />
    </div>
  );
}
