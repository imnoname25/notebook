"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Download,
  Link2,
  StickyNote,
} from "lucide-react";
import { useTheme } from "next-themes";
import { nextTheme } from "@/lib/themes";
import { useRouter } from "next/navigation";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { EditorPane } from "./editor-pane";
import { useWorkspaceViewport } from "./use-workspace-viewport";
import { useDocumentAlignment } from "./document-alignment";
import type { DocumentHistory } from "./use-document-tabs";
import { useWorkspaceTabs } from "./use-workspace-tabs";
import { WorkspaceEditors } from "./workspace-editors";
import type { WorkspacePaneId } from "@/lib/split-workspace";
import { parseTabSession, tabSessionKey, type DocumentTab } from "@/lib/document-tabs";
import { DocumentTabs } from "./document-tabs";
import { DesktopPanelResizers } from "./desktop-panel-resizers";
import { NotebookSidebar } from "./notebook-sidebar";
import { PageList } from "./page-list";
import { CommandPalette } from "./search-dialog";
import type { DocumentSearchRequest } from "@/lib/document-search";
import { QuickSearch } from "./quick-search";
import { SearchView } from "./search-view";
import { useWorkspaceSearch, type WorkspaceScreen } from "./use-workspace-search";
import { searchFromUrl, type WorkspaceSearch } from "@/lib/workspace-search";
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
import { DesktopAppHeader } from "./desktop-app-header";
import { MobileAppHeader } from "./mobile-app-header";
import { WorkspaceNavigation } from "./workspace-navigation";
import { PrintDialog } from "./print-dialog";
import { NotebookOverview } from "./notebook-overview";
import { MobileOutlineSheet } from "./page-outline";
import { UndoToast } from "./undo-toast";
import { StickerSaveProvider, useStickerSaves } from "./sticker-save-provider";
import { QuickCapture, StickerBoard } from "./quick-notes";
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
import { blockIdFromHash, getPageHref, pageIdFromPath, WORKSPACE_ROOT_HREF } from "@/lib/workspace-navigation";
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
  navigationOpen: boolean;
  mobileView: MobileView;
  moveTarget: MoveTarget | null;
  printOpen: boolean;
  screen: WorkspaceScreen;
  searchOpen: boolean;
  quickSearchOpen: boolean;
  settingsOpen: boolean;
  templateManagerOpen: boolean;
  templatePickerOpen: boolean;
  quickNotesOpen: boolean;
  tagBrowserOpen: boolean;
  editorOverlayOpen: boolean;
  tabsSheetOpen: boolean;
};
const noClientSubscription = () => () => undefined;
const clientMountedSnapshot = () => true;
const serverMountedSnapshot = () => false;
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
type NotebookAppProps = {
  user: {
    id: string;
    name: string;
    email: string;
    role: "ADMIN" | "USER";
    mustChangePassword: boolean;
  };
  initialLocation?: InitialLocation;
};
export function NotebookApp(props: NotebookAppProps) { return <StickerSaveProvider key={props.user.id}><NotebookWorkspace {...props}/></StickerSaveProvider>; }
function NotebookWorkspace({ user, initialLocation }: NotebookAppProps) {
  const router = useRouter();
  const stickerSaves = useStickerSaves();
  const { theme: browserTheme, resolvedTheme: browserResolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noClientSubscription, clientMountedSnapshot, serverMountedSnapshot);
  const theme = mounted ? browserTheme : undefined;
  const resolvedTheme = mounted ? browserResolvedTheme : undefined;
  const studioTheme = resolvedTheme === "studio-graphite" || resolvedTheme === "studio-atelier";
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
  const [mobileView, setMobileView] = useState<MobileView>("navigation");
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [screen, setScreen] = useState<WorkspaceScreen>("workspace");
  const [startScreen, setStartScreen] = useState<"last" | "today" | "notebooks" | "inbox">("last");
  const [searchOpen, setSearchOpen] = useState(false);
  const [stickerToReveal, setStickerToReveal] = useState<string | null>(null);
  const stickerRevealed = useCallback(() => setStickerToReveal(null), []);
  const [searchMatch, setSearchMatch] = useState<DocumentSearchRequest | null>(null);
  const searchMatchIntent = useRef(0);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickSearchFocus, setQuickSearchFocus] = useState(0);
  const openQuickSearch = useCallback(() => { setSearchOpen(false);setMobileMenuOpen(false);setQuickSearchOpen(true);setQuickSearchFocus(value => value + 1); }, []);
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
  const [dataSettingsOpen, setDataSettingsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [outline, setOutline] = useState<PageOutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [undoAction, setUndoAction] = useState<ReversibleAction | null>(null);
  const [quickNotesOpen, setQuickNotesOpen] = useState(false);
  const [tagBrowserOpen, setTagBrowserOpen] = useState(false);
  const [tagBrowserTag, setTagBrowserTag] = useState<string | null>(null);
  const [editorOverlayOpen, setEditorOverlayOpen] = useState(false);
  const [tabsSheetOpen, setTabsSheetOpen] = useState(false);
  const [sharedCapture, setSharedCapture] = useState<{ title: string; text: string } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [authLeaving, setAuthLeaving] = useState(false);
  useWorkspaceViewport();
  const documentAlignment = useDocumentAlignment();
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
  const pendingBlock = useRef<{ pageId: string; blockId: string } | null>(null);

  mobileBackStateRef.current = {
    actionTarget,
    appearanceNotebook,
    appearancePage,
    appearanceSection,
    dataSettingsOpen,
    historyOpen,
    outlineOpen,
    mobileMenuOpen,
    navigationOpen,
    mobileView,
    moveTarget,
    printOpen,
    screen,
    searchOpen,
    quickSearchOpen,
    settingsOpen,
    templateManagerOpen,
    templatePickerOpen,
    quickNotesOpen,
    tagBrowserOpen,
    editorOverlayOpen,
    tabsSheetOpen,
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
  const report = useCallback((value: unknown) => {
    setError(value instanceof Error ? value.message : "Произошла ошибка");
  }, []);
  useEffect(() => stickerSaves.subscribeErrors(report), [report, stickerSaves]);
  useEffect(() => {
    const copied = () => { setWorkspaceRevision(value => value + 1);setNotice("Черновик сохранён отдельным стикером"); };
    window.addEventListener("notebook:sticker-copy-saved", copied);
    return () => window.removeEventListener("notebook:sticker-copy-saved", copied);
  }, []);
  const registerEditorController = useCallback(
    (controller: EditorSaveController | null) => {
      editorController.current = controller;
      if (controller && pendingBlock.current?.pageId === controller.pageId) { controller.scrollToBlock(pendingBlock.current.blockId);pendingBlock.current = null; }
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
    const listener = (event: Event) => setTabsSheetOpen(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("notebook:tabs-overlay", listener);
    return () => window.removeEventListener("notebook:tabs-overlay", listener);
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
        setStartScreen(settings.startScreen);
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
        let hasSession = false;
        try { const saved = parseTabSession(localStorage.getItem(tabSessionKey(user.id)));hasSession = saved.tabs.length > 0 || saved.activePageId !== null; } catch { /* No browser storage. */ }
        const explicitDestination = new URLSearchParams(window.location.search);
        if (!startScreenApplied.current && !initialLocation && !hasSession && !explicitDestination.has("view") && !explicitDestination.has("notebook")) {
          startScreenApplied.current = true;
          if (settings.startScreen === "today") setScreen("today");
          else if (settings.startScreen === "inbox") setScreen("stickers");
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
          startScreen: "last" | "today" | "notebooks" | "inbox";
        }>
      ).detail;
      setSectionAccentIntensity(next.sectionAccentIntensity);
      setPageListView(next.pageListView);
      setStartScreen(next.startScreen);
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
  }, [initialLocation, user.id]);
  useEffect(() => {
    const sectionId = activeSection?.id;
    if (!sectionId) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => {
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
    const url = getPageHref(pageId);
    if (window.location.pathname === url) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](
      null,
      "",
      url,
    );
  }
  function openNotebookOverview(notebookId: string, history: "push" | "replace" = "replace") {
    void tabs.leave(() => {
    setScreen("workspace");
    setActiveNotebookId(notebookId);
    setActiveSectionId(null);
    activePageRef.current = null;
    setActivePage(null);
    setOutline([]);
    window.history[history === "push" ? "pushState" : "replaceState"](null, "", `/app?notebook=${encodeURIComponent(notebookId)}`);
    setMobileView("pages");
    });
  }

  function openSection(section: Section, history: "push" | "replace" = "replace") {
    void tabs.leave(() => {
    setScreen("workspace");
    setActiveNotebookId(section.notebookId);
    setActiveSectionId(section.id);
    activePageRef.current = null;
    setActivePage(null);
    setOutline([]);
    window.history[history === "push" ? "pushState" : "replaceState"](null, "", `/app?notebook=${encodeURIComponent(section.notebookId)}&section=${encodeURIComponent(section.id)}`);
    setMobileView("pages");
    });
  }

  async function loadTabDocument(pane: WorkspacePaneId, pageId: string, history: DocumentHistory, current: () => boolean, preloaded?: PageDocument) {
      const previous = workspace.docs.current[pane];
      try {
        if (previous?.id === pageId) { if (!current()) return null;return previous; }
        const page = preloaded ?? (await api<{ page: PageDocument }>(`/api/pages/${encodeURIComponent(pageId)}`)).page;
        let availableNotebooks = notebooks;
        let notebook = availableNotebooks.find((item) =>
          item.sections.some((section) => section.id === page.sectionId),
        );
        if (!notebook) {
          availableNotebooks = (await api<{ notebooks: Notebook[] }>("/api/notebooks")).notebooks;
          setNotebooks(availableNotebooks);
          notebook = availableNotebooks.find((item) =>
            item.sections.some((section) => section.id === page.sectionId),
          );
        }
        if (!notebook) throw new Error("PAGE_LOCATION_UNAVAILABLE");
        if (!current()) return null;
        await workspace.editor(pane)?.flush(false);
        if (!current()) return null;
        workspace.accept(pane, page);
        recordOpenedPage(page.id);
        if (workspace.activeRef.current.active === pane && !workspace.transaction.current) {
          setActiveNotebookId(notebook.id);setActiveSectionId(page.sectionId);
          setScreen("workspace");setMobileView("editor");setNavigationOpen(false);
          if (history !== "none") setPageUrl(page.id, history);
        }
        setError("");
        return page;
      } catch (cause) {
        if (!current()) return null;
        report(cause);
        setNotice(activePageRef.current ? "Не удалось перейти. Текущая заметка остаётся открытой; повторите попытку после проверки соединения." : "Не удалось загрузить документ. Вкладки сохранены; повторите открытие после восстановления соединения.");
        if (history === "none" && activePageRef.current) window.history.replaceState(null, "", getPageHref(activePageRef.current.id));
        return null;
      }
  }

  const workspace = useWorkspaceTabs({ userId: user.id, load: loadTabDocument,
    present: page => {
      activePageRef.current = page;setActivePage(page);setScreen("workspace");setMobileView("editor");setNavigationOpen(false);
      if (page) { const book = notebooks.find(item => item.sections.some(section => section.id === page.sectionId));if (book) setActiveNotebookId(book.id);setActiveSectionId(page.sectionId); }
    }, onController: registerEditorController, report, notice: setNotice,
  });
  const { syncActive, active: workspacePane } = workspace;
  useLayoutEffect(() => { syncActive(activePage); }, [activePage, workspacePane, syncActive]);
  const tabs = { ...workspace.controller(workspace.active), leave: workspace.leave };
  const openTab = workspace.open;const restoreTabs = workspace.restore;const leaveTabs = workspace.leave;
  const openPageById = useCallback(async (id: string, history: DocumentHistory = "push", mode: DocumentTab["mode"] = "preview") => { const opened = await openTab(id, mode, history);const block = blockIdFromHash(location.hash);if (opened && block) editorController.current?.scrollToBlock(block);return opened; }, [openTab]);
  const search = useWorkspaceSearch({ leave: leaveTabs, setScreen });
  const { open: openSearch, back: backSearch } = search;
  const openGlobalSearch = useCallback((patch?: Partial<WorkspaceSearch>) => {
    void openSearch(patch).then(opened => { if (opened) { setFocusMode(false); setNavigationOpen(false); } });
  }, [openSearch]);
  useEffect(() => {
    const openTag = (event: Event) => {
      const tag = (event as CustomEvent<string>).detail;
      openGlobalSearch({ tag });
    };
    window.addEventListener("notebook:search-tag", openTag);
    return () => window.removeEventListener("notebook:search-tag", openTag);
  }, [openGlobalSearch]);
  const restoreSearch = search.restore;
  useEffect(() => {
    if (initialPageOpened.current) return;
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const standalone = Boolean(searchFromUrl(window.location.href) || view === "today" || view === "stickers" || params.has("notebook"));
    if (notebooks.length === 0 && (!standalone || params.has("notebook"))) return;
    initialPageOpened.current = true;
    void restoreTabs(pageIdFromPath(window.location.pathname) ?? initialLocation?.pageId ?? null, !standalone).then(() => {
      if (restoreSearch()) return;
      const view = new URLSearchParams(window.location.search).get("view");
      if (view === "today" || view === "stickers") setScreen(view);
      else if (params.has("notebook")) {
        const book = notebooks.find(item => item.id === params.get("notebook"));
        if (book) { setActiveNotebookId(book.id);setActiveSectionId(book.sections.some(section => section.id === params.get("section")) ? params.get("section") : null);setMobileView("pages"); }
      }
    });
  }, [notebooks, initialLocation, restoreTabs, restoreSearch]);

  const openPage = useCallback(
    (page: PageSummary, history: "push" | "replace" | "none" = "push") =>
      openPageById(page.id, history),
    [openPageById],
  );

  useEffect(() => {
    const pop = () => {
      setQuickSearchOpen(false);setFocusMode(false);
      const destination = searchFromUrl(window.location.href);
      if (destination) { void leaveTabs(() => { restoreSearch(); }); return; }
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      if (view === "today" || view === "stickers") { void leaveTabs(() => { setScreen(view);setMobileView("navigation"); });return; }
      const pageId = pageIdFromPath(window.location.pathname);
      if (pageId) void openPageById(pageId, "none", "permanent");
      else {
        void leaveTabs(() => {
        setScreen("workspace");
        setActiveNotebookId(params.get("notebook"));setActiveSectionId(params.get("section"));
        setMobileView(params.has("notebook") ? "pages" : "navigation");
        activePageRef.current = null;
        setActivePage(null);
        });
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [openPageById, leaveTabs, restoreSearch]);

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
        state.navigationOpen ||
        state.searchOpen ||
        state.quickSearchOpen ||
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
        state.tabsSheetOpen ||
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
        if (state.tabsSheetOpen) window.dispatchEvent(new Event("notebook:close-tabs-overlay"));
        else if (state.editorOverlayOpen) window.dispatchEvent(new Event("notebook:close-editor-overlay"));
        else if (state.quickNotesOpen) setQuickNotesOpen(false);
        else if (state.searchOpen) setSearchOpen(false);
        else if (state.quickSearchOpen) setQuickSearchOpen(false);
        else if (state.tagBrowserOpen) setTagBrowserOpen(false);
        else if (state.actionTarget) setActionTarget(null);
        else if (state.mobileMenuOpen) setMobileMenuOpen(false);
        else if (state.navigationOpen) setNavigationOpen(false);
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
      setFocusMode(false);
      if (action === "workspace") { if (state.screen === "search") backSearch(); else setScreen("workspace"); }
      if (action === "pages") {
        window.history.replaceState(null, "", "/app");
        setMobileView("pages");
      }
      if (action === "navigation") {
        setMobileView("navigation");
        if (document.documentElement.matches(".studio-graphite, .studio-atelier")) setNavigationOpen(true);
      }
      return "HANDLED";
    };
    androidWindow.__NOTEBOOK_ANDROID_BACK_VERSION__ =
      MOBILE_BACK_PROTOCOL_VERSION;
    return () => {
      delete androidWindow.__NOTEBOOK_ANDROID_BACK__;
      delete androidWindow.__NOTEBOOK_ANDROID_BACK_VERSION__;
    };
  }, [backSearch]);

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
      openSection(section);
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
      await openPageById(page.id, "push", "permanent");
    } catch (cause) {
      report(cause);
    }
  }, [activeSection, report, openPageById]);
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
      setTemplatePickerOpen(false);
      await openPageById(page.id, "push", "permanent");
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
        openQuickSearch();
        return;
      }
      if (key === "p" && event.shiftKey) { event.preventDefault();setQuickSearchOpen(false);setSearchOpen(true);return; }
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
  }, [activePage, activeSection, addPage, focusMode, openQuickSearch]);

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
      | "open-tab"
      | "open-right"
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
            await workspace.flushAll();
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
            await workspace.flushAll();
            await api(`/api/sections/${target.item.id}`, jsonOptions("DELETE"));
            await loadNotebooks();
          }
        } else await reorderSections(target.item, action === "up" ? -1 : 1);
      } else {
        if (action === "open-right") { if (!workspace.split) workspace.enable();await workspace.open(target.item.id, "permanent", "push", "right");return; }
        if (action === "open-tab") { await openPageById(target.item.id, "push", "permanent");return; }
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
          await workspace.editorFor(target.item.id)?.flush(false);
          const { page } = await api<{ page: PageDocument }>(
            `/api/pages/${target.item.id}/duplicate`,
            jsonOptions("POST"),
          );
          setPages((items) =>
            [...items, page].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            ),
          );
          await openPageById(page.id, "push", "permanent");
          return;
        }
        if (action === "rename") {
          await workspace.editorFor(target.item.id)?.flush(false);
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
            await workspace.editorFor(target.item.id)?.flush(false);
            await api(`/api/pages/${target.item.id}`, jsonOptions("DELETE"));
            setPages((items) => items.filter((p) => p.id !== target.item.id));
            await workspace.close([target.item.id], true);
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
  useEffect(() => { window.dispatchEvent(new Event("notebook:page-metadata-changed")); }, [workspaceRevision]);

  function pageSaved(page: PageDocument) {
    workspace.updatePage(page);
    tabs.title(page.id, page.title);
    setPages((items) =>
      items.map((item) => (item.id === page.id ? { ...item, ...page } : item)),
    );
    if (activePageRef.current?.id === page.id) activePageRef.current = page;
    setActivePage((current) => (current?.id === page.id ? page : current));
  }

  async function openSearchResult(result: SearchResult, query = "") {
    const intent = ++searchMatchIntent.current;
    setSearchOpen(false);
    if (result.type === "tag") {
      openGlobalSearch({ tag: result.id });
      return;
    }
    if (result.type === "quickNote") {
      openSpecial("stickers");
      return;
    }
    if (result.type === "notebook") {
      setScreen("workspace");
      openNotebookOverview(result.notebookId, "push");
      return;
    }
    if (result.type === "section") {
      setScreen("workspace");
      const notebook = notebooks.find((item) => item.id === result.notebookId);
      const section = notebook?.sections.find((item) => item.id === result.id);
      if (section) openSection(section, "push");
      return;
    }
    try {
      const opened = await openPageById(result.id);
      if (opened && intent === searchMatchIntent.current) setSearchMatch(query.trim() ? { pageId: result.id, query, snippet: result.snippet, request: intent } : null);
      return opened;
    } catch (cause) {
      report(cause);return false;
    }
  }

  async function logout() {
    setAuthLeaving(true);
    try {
      await stickerSaves.flushAll();await workspace.flushAll();
      await api("/api/auth/logout", jsonOptions("POST"));
      await flushNativeAuthCookies();
      router.replace("/login");
      router.refresh();
    } catch (cause) { setAuthLeaving(false);report(cause); }
  }
  async function logoutAll() {
    if (!window.confirm("Выйти на всех устройствах, включая это?")) return;
    setAuthLeaving(true);
    try {
      await stickerSaves.flushAll();await workspace.flushAll();
      await api("/api/auth/logout-all", jsonOptions("POST"));
      await flushNativeAuthCookies();
      router.replace("/login");
      router.refresh();
    } catch (cause) { setAuthLeaving(false);report(cause); }
  }
  async function changeAndroidServer() {
    if (!window.confirm(t("mobile.changeServerConfirm"))) return;
    setAuthLeaving(true);
    try { await stickerSaves.flushAll();await workspace.flushAll();window.location.replace("https://localhost/?changeServer=1"); }
    catch (cause) { setAuthLeaving(false);report(cause); }
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
        await workspace.editorFor(target.id)?.flush(false);
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
        workspace.updatePage(page);
        activePageRef.current = page;
        setActivePage(page);
        setMobileView("editor");
        setNavigationOpen(false);
        setPageUrl(page.id, "replace");
        await tabs.open(page.id, "permanent", "replace");
        setUndoAction(createReversibleAction(t("undo.moved"), async () => {
          await workspace.editorFor(target.id)?.flush(false);
          const { page: restored } = await api<{ page: PageDocument }>(
            `/api/pages/${target.id}/move`,
            jsonOptions("POST", { destinationSectionId: sourceSectionId }),
          );
          const sourceNotebook = notebooks.find((item) => item.sections.some((section) => section.id === sourceSectionId));
          setActiveNotebookId(sourceNotebook?.id ?? null);
          setActiveSectionId(sourceSectionId);
          workspace.updatePage(restored);
          activePageRef.current = restored;
          setActivePage(restored);
          setWorkspaceRevision((value) => value + 1);
          setPageUrl(restored.id, "replace");
          await tabs.open(restored.id, "permanent", "replace");
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
      if (activePageRef.current?.id !== current.id) { pageSaved(page);return; }
      activePageRef.current = page;
      setActivePage(page);
      pageSaved(page);
      workspace.refresh(page.id);
    } catch (cause) {
      report(cause);
      throw cause;
    }
  }

  async function copyPageLink(page: PageSummary) {
    const link = `${window.location.origin}${getPageHref(page.id)}`;
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
      aliases: ["inbox", "входящие", "стикеры"],
      run: () => openSpecial("stickers"),
    },
    {
      id: "today",
      title: t("commands.openToday"),
      aliases: ["today", "сегодня", "главная"],
      run: () => openSpecial("today"),
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
      run: () => setTheme(nextTheme(theme)),
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

  function openSpecial(destination: "today" | "stickers") {
    void tabs.leave(() => {
    setScreen(destination);
    setMobileView("navigation");
    window.history.pushState(null, "", `/app?view=${destination}`);
    });
  }

  function openHome() {
    if (startScreen === "today") {
      openSpecial("today");
      return;
    }
    if (startScreen === "inbox") {
      openSpecial("stickers");
      return;
    }
    void tabs.leave(() => {
    setScreen("workspace");
    window.history.replaceState(null, "", WORKSPACE_ROOT_HREF);
    if (startScreen === "notebooks") {
      setActiveSectionId(null);
      activePageRef.current = null;
      setActivePage(null);
      setMobileView("navigation");
      return;
    }
    setMobileView(activePageRef.current ? "editor" : activeSectionId ? "pages" : "navigation");
    });
  }

  function openNavigation() {
    if (studioTheme) {
      // Trash occupies the whole grid and does not mount a sidebar host.
      if (screen === "trash") setScreen("workspace");
      setNavigationOpen(true);
    }
    else { setScreen("workspace"); setMobileView("navigation"); }
  }

  const navigationSidebar = (
    <WorkspaceNavigation studio={studioTheme}
      open={navigationOpen} onOpenChange={setNavigationOpen}
      visible={screen === "workspace" && mobileView === "navigation"}>
      <NotebookSidebar
        notebooks={notebooks}
        activeNotebookId={activeNotebookId}
        activeSectionId={activeSection?.id ?? null}
        activeDestination={screen === "today" ? "today" : screen === "stickers" ? "stickers" : "workspace"}
        expansionStorageKey={`notebook:expanded-notebooks:${user.id}`}
        sectionAccentIntensity={sectionAccentIntensity}
        onNotebookSelect={(id) => { setNavigationOpen(false); openNotebookOverview(id); }}
        onSectionSelect={(section) => { setNavigationOpen(false); openSection(section); }}
        onAddNotebook={() => { setNavigationOpen(false); void addNotebook(); }}
        onNotebookMenu={(item) => { setNavigationOpen(false); setActionTarget({ type: "notebook", item }); }}
        onAddSection={(id, parentId) => { setNavigationOpen(false); void addSection(id, parentId); }}
        onSectionMenu={(item) => { setNavigationOpen(false); setActionTarget({ type: "section", item }); }}
        onNotebookReorder={(ids) => void saveNotebookOrder(ids)}
        onSectionReorder={(notebookId, parentId, ids) => void saveSectionOrder(notebookId, parentId, ids)}
        onTrashOpen={() => { setNavigationOpen(false); void tabs.leave(() => setScreen("trash")); }}
        onInboxOpen={() => { setNavigationOpen(false); openSpecial("stickers"); }}
        onTodayOpen={() => { setNavigationOpen(false); openSpecial("today"); }}
        onFavoritesOpen={() => { setNavigationOpen(false); openGlobalSearch({ group: "favorites" }); }}
        onRecentOpen={() => { setNavigationOpen(false); openGlobalSearch({ group: "recent" }); }}
        onTemplatesOpen={() => { setNavigationOpen(false); setTemplateManagerOpen(true); }}
        onSettingsOpen={() => { setNavigationOpen(false); setSettingsOpen(true); }}
        onTagsOpen={() => { setNavigationOpen(false); setTagBrowserTag(null); setTagBrowserOpen(true); }}
      />
    </WorkspaceNavigation>
  );

  return (
    <div
      data-density={density}
      data-focus-mode={focusMode ? "true" : "false"}
      data-mobile-view={mobileView}
      data-workspace-screen={screen}
      data-has-section={activeSection ? "true" : "false"}
      data-document-alignment={documentAlignment}
      className="notebook-app-shell flex h-dvh flex-col overflow-hidden bg-background text-foreground"
    >
      <MobileAppHeader
        userName={user.name}
        isAdmin={user.role === "ADMIN"}
        theme={theme}
        resolvedTheme={resolvedTheme}
        menuOpen={mobileMenuOpen}
        androidClient={androidClient}
        navigationOpen={studioTheme ? navigationOpen : undefined}
        onHome={openHome}
        onMenu={openNavigation}
        onSearch={openQuickSearch}
        onQuickNotes={() => setQuickNotesOpen(true)}
        onMenuOpenChange={setMobileMenuOpen}
        onSettings={() => setSettingsOpen(true)}
        onTheme={() =>
          setTheme(
            nextTheme(theme),
          )
        }
        onChangeServer={changeAndroidServer}
        onLogout={() => void logout()}
        onLogoutAll={() => void logoutAll()}
        onError={report}
      />
      <DesktopAppHeader userName={user.name} isAdmin={user.role === "ADMIN"}
        notebookTitle={activeNotebook?.title}
        theme={theme} resolvedTheme={resolvedTheme} onHome={openHome}
        search={<QuickSearch open={quickSearchOpen} focusRequest={quickSearchFocus} onOpenChange={setQuickSearchOpen} onSelect={async (result, query) => (await openSearchResult(result, query)) !== false} onAdvanced={q => openGlobalSearch({ q })}/>}
        onCapture={() => setQuickNotesOpen(true)} onSettings={() => setSettingsOpen(true)}
        onTheme={() => setTheme(nextTheme(theme))} onLogout={() => void logout()} onError={report}/>
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
      <div className="notebook-workspace-grid grid min-h-0 flex-1 md:grid-cols-[280px_320px_minmax(0,1fr)]">
        <DesktopPanelResizers userId={user.id} enabled={studioTheme && screen === "workspace" && !focusMode} onError={report}/>
        {screen === "search" ? <>{navigationSidebar}<SearchView value={search.state} onChange={search.change} focusRequest={search.focusRequest} notebooks={notebooks} onBack={search.back} onSelect={result => void openSearchResult(result, search.state.q)}/></> : screen === "trash" ? (
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
        ) : screen === "stickers" ? (
          <>
          {navigationSidebar}
          <StickerBoard
            revealId={stickerToReveal}
            onRevealed={stickerRevealed}
            userId={user.id}
            notebooks={notebooks}
            revision={workspaceRevision}
            onBack={() => setScreen("workspace")}
            onError={report}
            onTag={(tag) => {
              openGlobalSearch({ q: `#${tag}` });
            }}
            onConverted={(page) => {
              setWorkspaceRevision((value) => value + 1);
              void openPageById(page.id);
            }}
          />
          </>
        ) : screen === "today" ? (
          <>
          {navigationSidebar}
          <TodayView
            revision={workspaceRevision}
            onBack={() => setScreen("workspace")}
            onCapture={() => setQuickNotesOpen(true)}
            onInbox={id => { setStickerToReveal(id ?? null);openSpecial("stickers"); }}
            onPage={(id) => void openPageById(id)}
            onTag={(tag) => {
              openGlobalSearch({ tag });
            }}
            onError={report}
          />
          </>
        ) : (
          <>
            {navigationSidebar}
            <div
              id="workspace-page-list-panel"
              data-mobile-screen="pages"
              className={cn(
                "notebook-no-print min-h-0 min-w-0",
                mobileView !== "pages" && "hidden md:block",
              )}
            >
              {activeNotebook && !activeSection ? <div className="h-full md:hidden"><NotebookOverview notebook={activeNotebook} revision={workspaceRevision} onSection={openSection} onPage={(id) => void openPageById(id).catch(report)} onAddSection={() => void addSection(activeNotebook.id)} onError={report} onBack={openNavigation} /></div> : <PageList
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
                onBack={openNavigation}
                onAdd={addPage}
                onAddFromTemplate={() => setTemplatePickerOpen(true)}
                onSelect={(page, mode) => { void openPageById(page.id, "push", mode); }}
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

          </>
        )}
        <div data-mobile-screen="editor" className={cn("min-h-0 min-w-0", mobileView !== "editor" && "hidden md:block")} style={screen === "workspace" ? undefined : { display: "none" }}>
          {activeNotebook && !activeSection && !activePage && mobileView !== "editor" && !workspace.split && <div className="flex h-full min-h-0 flex-col"><DocumentTabs controller={tabs}/><div className="min-h-0 flex-1"><NotebookOverview notebook={activeNotebook} revision={workspaceRevision} onSection={openSection} onPage={(id) => void openPageById(id).catch(report)} onAddSection={() => void addSection(activeNotebook.id)} onError={report} onBack={openNavigation}/></div></div>}
          <WorkspaceEditors workspace={workspace} notebooks={notebooks} blocked={authLeaving} onActiveOutline={setOutline} enabled={studioTheme} suspended={screen !== "workspace" || Boolean(activeNotebook && !activeSection && !activePage && mobileView !== "editor" && !workspace.split)} renderBase={overrides => <EditorPane
                searchMatch={searchMatch?.pageId === overrides.page?.id ? searchMatch : null}
                onSearchMatchClose={() => setSearchMatch(null)}
                page={activePage}
                navigationBusy={authLeaving}
                notebook={activeNotebook}
                section={activeSection}
                loading={false}
                editorEpoch={0}
                onBack={() => {
                  setFocusMode(false);
                  window.history.replaceState(null, "", "/app");
                  setMobileView("pages");
                }}
                onSaved={pageSaved}
                onController={registerEditorController}
                onNotebookClick={() => { setFocusMode(false); if (activeNotebook) openNotebookOverview(activeNotebook.id); }}
                onSectionClick={() => { setFocusMode(false); if (activeSection) openSection(activeSection); }}
                outline={outline}
                outlineVisible={outlineVisible}
                onOutlineChange={setOutline}
                onOutlineToggle={() => {
                  const studio = resolvedTheme === "studio-graphite" || resolvedTheme === "studio-atelier";
                  if (window.matchMedia(studio ? "(max-width: 1199px)" : "(max-width: 1023px)").matches) setOutlineOpen(true);
                  else setOutlineVisible((value) => !value);
                }}
                focusMode={focusMode}
                onFocusToggle={() => setFocusMode((value) => !value)}
                onOutlineSelect={(id) => editorController.current?.scrollToBlock(id)}
                onCreatePage={() => void addPage()}
                onInternalNavigate={async (pageId, permanent, blockId) => {
                  try {
                    if (blockId) pendingBlock.current = { pageId, blockId };
                    const opened = await openPageById(pageId, "push", permanent ? "permanent" : "preview");
                    if (!opened) { pendingBlock.current = null;throw new Error("Не удалось открыть документ"); }
                    if (blockId) {
                      window.history.replaceState(null, "", getPageHref(pageId, blockId));
                      if (editorController.current?.pageId === pageId) { editorController.current.scrollToBlock(blockId);pendingBlock.current = null; }
                    }
                  } catch (cause) {
                    report(cause);
                    throw cause;
                  }
                }}
                {...overrides}
              />}/>
        </div>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} commands={paletteCommands}/>
      <QuickCapture
        key={sharedCapture ? `share:${sharedCapture.title}:${sharedCapture.text.length}` : "capture"}
        open={quickNotesOpen}
        initialTitle={sharedCapture?.title}
        initialBody={sharedCapture?.text}
        onOpenChange={(open) => { setQuickNotesOpen(open); if (!open) setSharedCapture(null); }}
        onError={report}
        onSaved={note => {
          setStickerToReveal(note.id);
          setWorkspaceRevision((value) => value + 1);
          setNotice(t("quickNotes.savedInbox"));
        }}
      />
      <TagBrowser
        key={`${tagBrowserOpen ? "open" : "closed"}:${tagBrowserTag ?? "index"}`}
        open={tagBrowserOpen}
        initialTag={tagBrowserTag}
        onSearchTag={tag => { setTagBrowserOpen(false);openGlobalSearch({ tag }); }}
        onOpenChange={setTagBrowserOpen}
        onError={report}
        onPage={(id) => {
          setTagBrowserOpen(false);
          void openPageById(id).catch(report);
        }}
        onInbox={() => {
          setTagBrowserOpen(false);
          openSpecial("stickers");
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
            {actionTarget.type === "page" && <><button className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("open-tab")}>Открыть в новой вкладке</button>
                <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("open-right")}>Открыть справа</button></>}
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
              <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => {
                const section = actionTarget.item;
                setActionTarget(null);
                void addSection(section.notebookId, section.id);
              }}>Добавить вложенный раздел</button>
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
