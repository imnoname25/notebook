"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Download, Link2, LogOut, Monitor, Moon, Search, Settings, ShieldCheck, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { EditorPane } from "./editor-pane";
import { NotebookSidebar } from "./notebook-sidebar";
import { PageList } from "./page-list";
import { SearchDialog } from "./search-dialog";
import { TrashView } from "./trash-view";
import { AppearanceDialog } from "./appearance-dialog";
import { MoveDialog, type MoveTarget } from "./move-dialog";
import { VersionHistory } from "./version-history";
import { DataSettings } from "./data-settings";
import { SettingsDialog } from "./settings-dialog";
import { NotificationCenter } from "./notification-center";
import { PrintDialog } from "./print-dialog";
import { TemplateManager, TemplatePicker, type PageTemplate } from "./template-dialogs";
import type { EditorSaveController, Notebook, PageDocument, PageSummary, Section } from "./types";
import type { SearchResult } from "@/lib/services/search-service";
import { isNotebookColor, isNotebookIcon, NOTEBOOK_COLOR_CLASSES, NOTEBOOK_ICON_COMPONENTS, type NotebookColor, type NotebookIconId } from "@/lib/notebook-appearance";

type ActionTarget = { type: "notebook"; item: Notebook } | { type: "section"; item: Section } | { type: "page"; item: PageSummary };

type InitialLocation = { notebookId: string; sectionId: string; pageId: string };
export function NotebookApp({ user, initialLocation }: { user: { id: string; name: string; email: string }; initialLocation?: InitialLocation }) {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(initialLocation?.notebookId ?? null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(initialLocation?.sectionId ?? null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [activePage, setActivePage] = useState<PageDocument | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [mobileView, setMobileView] = useState<"navigation" | "pages" | "editor">("navigation");
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [screen, setScreen] = useState<"workspace" | "trash">("workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appearanceNotebook, setAppearanceNotebook] = useState<Notebook | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [dataSettingsOpen, setDataSettingsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const editorController = useRef<EditorSaveController | null>(null);
  const activePageRef = useRef<PageDocument | null>(null);
  const initialPageOpened = useRef(false);

  const activeNotebook = useMemo(() => notebooks.find((item) => item.id === activeNotebookId) ?? null, [notebooks, activeNotebookId]);
  const activeSection = useMemo(() => activeNotebook?.sections.find((item) => item.id === activeSectionId) ?? activeNotebook?.sections[0] ?? null, [activeNotebook, activeSectionId]);
  const ActiveNotebookIcon = NOTEBOOK_ICON_COMPONENTS[activeNotebook && isNotebookIcon(activeNotebook.icon) ? activeNotebook.icon : "notebook"];
  const activeNotebookColor = NOTEBOOK_COLOR_CLASSES[activeNotebook && isNotebookColor(activeNotebook.color) ? activeNotebook.color : "slate"];

  const report = useCallback((value: unknown) => { setError(value instanceof Error ? value.message : "Произошла ошибка"); }, []);
  const registerEditorController = useCallback((controller: EditorSaveController | null) => { editorController.current = controller; }, []);
  const loadNotebooks = useCallback(async () => {
    try {
      const result = await api<{ notebooks: Notebook[] }>("/api/notebooks");
      setNotebooks(result.notebooks);
      setActiveNotebookId((current) => current && result.notebooks.some((n) => n.id === current) ? current : result.notebooks[0]?.id ?? null);
    } catch (cause) { report(cause); }
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    api<{ notebooks: Notebook[] }>("/api/notebooks").then((result) => {
      if (cancelled) return;
      setNotebooks(result.notebooks);
      setActiveNotebookId((current) => current && result.notebooks.some((notebook) => notebook.id === current) ? current : result.notebooks[0]?.id ?? null);
    }).catch(report);
    return () => { cancelled = true; };
  }, [report]);
  useEffect(() => {
    if (!initialLocation || initialPageOpened.current || notebooks.length === 0) return; initialPageOpened.current = true;
    void api<{ page: PageDocument }>(`/api/pages/${initialLocation.pageId}`).then(({ page }) => { activePageRef.current = page; setActivePage(page); setMobileView("editor"); }).catch(report);
  }, [initialLocation, notebooks.length, report]);
  useEffect(() => {
    const sectionId = activeSection?.id;
    if (!sectionId) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { if (activePageRef.current?.sectionId !== sectionId) { activePageRef.current = null; setActivePage(null); } setPages([]); setPagesLoading(true); return api<{ pages: PageSummary[] }>(`/api/pages?sectionId=${encodeURIComponent(sectionId)}`, { signal: controller.signal }); }).then((result) => setPages(result.pages)).catch((cause) => { if ((cause as Error).name !== "AbortError") report(cause); }).finally(() => { if (!controller.signal.aborted) setPagesLoading(false); });
    return () => controller.abort();
  }, [activeSection?.id, report, workspaceRevision]);

  function setPageUrl(pageId: string, mode: "push" | "replace" = "push") { const url = `/pages/${pageId}`; if (window.location.pathname === url) return; window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url); }
  async function openPage(page: PageSummary, history: "push" | "replace" | "none" = "push") {
    setPageLoading(true); setMobileView("editor");
    try { const result = (await api<{ page: PageDocument }>(`/api/pages/${page.id}`)).page; activePageRef.current = result; setActivePage(result); if (history !== "none") setPageUrl(result.id, history); } catch (cause) { report(cause); } finally { setPageLoading(false); }
  }

  const openPageById = useCallback(async (pageId: string, history: "push" | "replace" | "none" = "push") => {
    setPageLoading(true);
    try { const page = (await api<{ page: PageDocument }>(`/api/pages/${pageId}`)).page; const notebook = notebooks.find((item) => item.sections.some((section) => section.id === page.sectionId)); if (!notebook) { await loadNotebooks(); throw new Error("Расположение страницы обновилось. Повторите переход"); } setActiveNotebookId(notebook.id); setActiveSectionId(page.sectionId); activePageRef.current = page; setActivePage(page); setMobileView("editor"); if (history !== "none") setPageUrl(page.id, history); }
    finally { setPageLoading(false); }
  }, [loadNotebooks, notebooks]);

  useEffect(() => {
    const pop = () => { const match = window.location.pathname.match(/^\/pages\/([^/]+)$/); if (match?.[1]) void openPageById(match[1], "none").catch(report); else { setMobileView("navigation"); activePageRef.current = null; setActivePage(null); } };
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, [openPageById, report]);

  async function addNotebook() {
    const title = window.prompt("Название блокнота"); if (!title?.trim()) return;
    try { const { notebook } = await api<{ notebook: Notebook }>("/api/notebooks", jsonOptions("POST", { title })); setNotebooks((items) => [...items, notebook]); setActiveNotebookId(notebook.id); } catch (cause) { report(cause); }
  }
  async function addSection(notebookId: string, parentId?: string) {
    const title = window.prompt(parentId ? "Название вложенного раздела" : "Название раздела"); if (!title?.trim()) return;
    try { const { section } = await api<{ section: Section }>("/api/sections", jsonOptions("POST", { notebookId, parentId: parentId ?? null, title })); setNotebooks((items) => items.map((n) => n.id === notebookId ? { ...n, sections: [...n.sections, section] } : n)); setActiveSectionId(section.id); setMobileView("pages"); } catch (cause) { report(cause); }
  }
  const addPage = useCallback(async () => {
    if (!activeSection) return;
    try { const { page } = await api<{ page: PageDocument }>("/api/pages", jsonOptions("POST", { sectionId: activeSection.id, title: "Без названия" })); setPages((items) => [...items, page]); activePageRef.current = page; setActivePage(page); setMobileView("editor"); setPageUrl(page.id); } catch (cause) { report(cause); }
  }, [activeSection, report]);
  async function addPageFromTemplate(template: PageTemplate) { if (!activeSection) return; try { const { page } = await api<{ page: PageDocument }>("/api/pages", jsonOptions("POST", { sectionId: activeSection.id, templateId: template.id })); setPages((items) => [...items, page]); activePageRef.current = page; setActivePage(page); setTemplatePickerOpen(false); setMobileView("editor"); setPageUrl(page.id); } catch (cause) { report(cause); } }

  useEffect(() => {
    function hotkeys(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); setSearchOpen(true); return; }
      if (key === "s" && activePage) { event.preventDefault(); window.dispatchEvent(new Event("notebook:save-now")); return; }
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (key === "n" && activeSection && !editing) { event.preventDefault(); void addPage(); }
    }
    window.addEventListener("keydown", hotkeys);
    return () => window.removeEventListener("keydown", hotkeys);
  }, [activePage, activeSection, addPage]);

  async function patchAndReload(url: string, body: unknown) { await api(url, jsonOptions("PATCH", body)); await loadNotebooks(); }
  async function runAction(action: "rename" | "up" | "down" | "delete" | "history" | "move" | "duplicate" | "appearance" | "template" | "print") {
    const target = actionTarget; setActionTarget(null); if (!target) return;
    try {
      if (target.type === "notebook") {
        if (action === "appearance") { setAppearanceNotebook(target.item); return; }
        if (action === "rename") { const title = window.prompt("Новое название", target.item.title); if (title?.trim()) await patchAndReload(`/api/notebooks/${target.item.id}`, { title }); }
        else if (action === "delete") { if (window.confirm(`Переместить блокнот «${target.item.title}» и его содержимое в корзину?`)) { await api(`/api/notebooks/${target.item.id}`, jsonOptions("DELETE")); await loadNotebooks(); } }
        else await reorderNotebooks(target.item, action === "up" ? -1 : 1);
      } else if (target.type === "section") {
        if (action === "move") { setMoveTarget({ type: "section", id: target.item.id, currentNotebookId: target.item.notebookId, title: target.item.title }); return; }
        if (action === "rename") { const title = window.prompt("Новое название", target.item.title); if (title?.trim()) await patchAndReload(`/api/sections/${target.item.id}`, { title }); }
        else if (action === "delete") { if (window.confirm(`Переместить раздел «${target.item.title}» и его содержимое в корзину?`)) { await api(`/api/sections/${target.item.id}`, jsonOptions("DELETE")); await loadNotebooks(); } }
        else await reorderSections(target.item, action === "up" ? -1 : 1);
      } else {
        if (action === "template") { const name = window.prompt("Название шаблона", target.item.title); if (name?.trim()) { await api("/api/templates", jsonOptions("POST", { name, icon: "file-text", sourcePageId: target.item.id })); setNotice("Шаблон создан"); } return; }
        if (action === "print") { if (activePageRef.current?.id !== target.item.id) await openPage(target.item); setPrintOpen(true); return; }
        if (action === "move") { setMoveTarget({ type: "page", id: target.item.id, currentSectionId: target.item.sectionId, title: target.item.title }); return; }
        if (action === "history") {
          if (activePageRef.current?.id !== target.item.id) await openPage(target.item);
          setHistoryOpen(true); return;
        }
        if (action === "duplicate") {
          const { page } = await api<{ page: PageDocument }>(`/api/pages/${target.item.id}/duplicate`, jsonOptions("POST"));
          setPages((items) => [...items, page].sort((left, right) => left.sortOrder - right.sortOrder)); activePageRef.current = page; setActivePage(page); setEditorEpoch((value) => value + 1); setPageUrl(page.id); return;
        }
        if (action === "rename") { const title = window.prompt("Новое название", target.item.title); if (title?.trim()) { const { page } = await api<{ page: PageDocument }>(`/api/pages/${target.item.id}`, jsonOptions("PATCH", { title })); pageSaved(page); } }
        else if (action === "delete") { if (window.confirm(`Переместить страницу «${target.item.title}» в корзину?`)) { await api(`/api/pages/${target.item.id}`, jsonOptions("DELETE")); setPages((items) => items.filter((p) => p.id !== target.item.id)); if (activePageRef.current?.id === target.item.id) { activePageRef.current = null; setActivePage(null); window.history.pushState(null, "", "/app"); } } }
        else await reorderPages(target.item, action === "up" ? -1 : 1);
      }
    } catch (cause) { report(cause); }
  }

  async function reorderNotebooks(item: Notebook, delta: number) {
    const ordered = [...notebooks].sort((a, b) => a.sortOrder - b.sortOrder); const index = ordered.findIndex((n) => n.id === item.id); const other = ordered[index + delta]; if (!other) return;
    const ids = ordered.map((entry) => entry.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; await saveNotebookOrder(ids);
  }
  async function reorderSections(item: Section, delta: number) {
    const siblings = (activeNotebook?.sections ?? []).filter((s) => s.parentId === item.parentId).sort((a, b) => a.sortOrder - b.sortOrder); const index = siblings.findIndex((s) => s.id === item.id); const other = siblings[index + delta]; if (!other) return;
    const ids = siblings.map((entry) => entry.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; await saveSectionOrder(item.notebookId, item.parentId, ids);
  }
  async function reorderPages(item: PageSummary, delta: number) {
    const ordered = [...pages].sort((a, b) => a.sortOrder - b.sortOrder); const index = ordered.findIndex((p) => p.id === item.id); const other = ordered[index + delta]; if (!other) return;
    const ids = ordered.map((entry) => entry.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; await savePageOrder(ids);
  }
  async function saveNotebookOrder(ids: string[]) {
    const snapshot = notebooks;
    setNotebooks((items) => items.map((item) => ({ ...item, sortOrder: ids.indexOf(item.id) })));
    try { await api("/api/reorder/notebooks", jsonOptions("POST", { ids })); }
    catch (cause) { setNotebooks(snapshot); report(cause); }
  }
  async function saveSectionOrder(notebookId: string, parentId: string | null, ids: string[]) {
    const snapshot = notebooks;
    setNotebooks((items) => items.map((notebook) => notebook.id !== notebookId ? notebook : { ...notebook, sections: notebook.sections.map((section) => ids.includes(section.id) ? { ...section, sortOrder: ids.indexOf(section.id) } : section) }));
    try { await api("/api/reorder/sections", jsonOptions("POST", { notebookId, parentId, ids })); }
    catch (cause) { setNotebooks(snapshot); report(cause); }
  }
  async function savePageOrder(ids: string[]) {
    if (!activeSection) return;
    const snapshot = pages;
    setPages((items) => items.map((item) => ({ ...item, sortOrder: ids.indexOf(item.id) })));
    try { await api("/api/reorder/pages", jsonOptions("POST", { sectionId: activeSection.id, ids })); }
    catch (cause) { setPages(snapshot); report(cause); }
  }
  function pageSaved(page: PageDocument) { setPages((items) => items.map((item) => item.id === page.id ? { ...item, ...page } : item)); if (activePageRef.current?.id === page.id) activePageRef.current = page; setActivePage((current) => current?.id === page.id ? page : current); }

  async function openSearchResult(result: SearchResult) {
    setSearchOpen(false); setScreen("workspace"); setActiveNotebookId(result.notebookId);
    if (result.type === "notebook") { setActiveSectionId(null); setMobileView("navigation"); return; }
    setActiveSectionId(result.sectionId ?? null);
    if (result.type === "section") { setMobileView("pages"); return; }
    try { await openPageById(result.id); } catch (cause) { report(cause); }
  }

  async function logout() { await api("/api/auth/logout", jsonOptions("POST")); router.replace("/login"); router.refresh(); }
  async function logoutAll() { if (!window.confirm("Выйти на всех устройствах, включая это?")) return; await api("/api/auth/logout-all", jsonOptions("POST")); router.replace("/login"); router.refresh(); }

  async function saveAppearance(color: NotebookColor, icon: NotebookIconId) {
    if (!appearanceNotebook) return;
    try { await api(`/api/notebooks/${appearanceNotebook.id}`, jsonOptions("PATCH", { color, icon })); await loadNotebooks(); }
    catch (cause) { report(cause); throw cause; }
  }

  async function moveSelected(destinationId: string) {
    const target = moveTarget; if (!target) return;
    try {
      if (target.type === "page") {
        if (activePageRef.current?.id === target.id) await editorController.current?.flush(false);
        const { page } = await api<{ page: PageDocument }>(`/api/pages/${target.id}/move`, jsonOptions("POST", { destinationSectionId: destinationId }));
        const notebook = notebooks.find((item) => item.sections.some((section) => section.id === destinationId));
        setPages((items) => items.filter((item) => item.id !== target.id)); setActiveNotebookId(notebook?.id ?? null); setActiveSectionId(destinationId); activePageRef.current = page; setActivePage(page); setMobileView("editor"); setPageUrl(page.id, "replace");
      } else {
        await api(`/api/sections/${target.id}/move`, jsonOptions("POST", { destinationNotebookId: destinationId }));
        await loadNotebooks(); setActiveNotebookId(destinationId); setActiveSectionId(target.id); setMobileView("pages");
      }
      setMoveTarget(null); setWorkspaceRevision((value) => value + 1);
    } catch (cause) { report(cause); }
  }

  async function restoreVersion(versionId: string) {
    try {
      await editorController.current?.flush(false);
      const current = activePageRef.current;
      if (!current) return;
      const { page } = await api<{ page: PageDocument }>(`/api/pages/${current.id}/versions/${versionId}/restore`, jsonOptions("POST", { expectedRevision: current.revision }));
      activePageRef.current = page; setActivePage(page); pageSaved(page); setEditorEpoch((value) => value + 1);
    } catch (cause) { report(cause); throw cause; }
  }

  async function copyPageLink(page: PageSummary) {
    const link = `${window.location.origin}/pages/${page.id}`;
    try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link); else { const field = document.createElement("textarea"); field.value = link; document.body.appendChild(field); field.select(); document.execCommand("copy"); field.remove(); } setNotice("Ссылка на страницу скопирована"); }
    catch { report(new Error("Не удалось скопировать ссылку")); }
  }

  return <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
    <header className="notebook-no-print flex h-14 shrink-0 items-center border-b border-border/60 px-4">
      <div className="flex items-center gap-2 font-semibold"><span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><BookOpen size={17} /></span>Notebook</div>{activeNotebook && <div className="ml-4 hidden min-w-0 items-center gap-2 border-l border-border/60 pl-4 text-sm sm:flex"><span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-white", activeNotebookColor)}><ActiveNotebookIcon size={14}/></span><span className="max-w-40 truncate">{activeNotebook.title}</span></div>}
      <div className="ml-auto flex items-center gap-1"><NotificationCenter onError={report}/><Button variant="ghost" size="icon" className="size-11" aria-label="Поиск" title="Поиск (Ctrl/Cmd + K)" onClick={() => setSearchOpen(true)}><Search size={17} /></Button><Button variant="ghost" size="icon" className="size-11" aria-label="Настройки" onClick={() => setSettingsOpen(true)}><Settings size={17}/></Button><Button variant="ghost" size="icon" className="size-11" aria-label="Переключить тему" title={`Тема: ${theme === "system" ? "системная" : theme === "dark" ? "тёмная" : "светлая"}`} onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}>{theme === "system" ? <Monitor size={17} /> : resolvedTheme === "dark" ? <Moon size={17} /> : <Sun size={17} />}</Button><span className="hidden px-2 text-xs text-muted-foreground sm:block">{user.name}</span><Button variant="ghost" size="icon" className="hidden size-11 sm:inline-flex" aria-label="Выйти на всех устройствах" title="Выйти на всех устройствах" onClick={() => void logoutAll()}><ShieldCheck size={17}/></Button><Button variant="ghost" size="icon" className="size-11" aria-label="Выйти" onClick={() => void logout()}><LogOut size={17} /></Button></div>
    </header>
    {error && <button className="bg-destructive px-4 py-2 text-left text-sm text-white" onClick={() => setError("")}>{error} · нажмите, чтобы закрыть</button>}
    {notice && <button className="bg-accent px-4 py-2 text-left text-sm" onClick={() => setNotice("")}>{notice} · нажмите, чтобы закрыть</button>}
    <div className="grid min-h-0 flex-1 md:grid-cols-[280px_320px_minmax(0,1fr)]">
      {screen === "trash" ? <TrashView onBack={() => setScreen("workspace")} onChanged={() => { void loadNotebooks(); setWorkspaceRevision((value) => value + 1); }} onError={report}/> : <>
      <div className={cn("notebook-no-print min-h-0", mobileView !== "navigation" && "hidden md:block")}><NotebookSidebar notebooks={notebooks} activeNotebookId={activeNotebookId} activeSectionId={activeSection?.id ?? null} onNotebookSelect={(id) => { setActiveNotebookId(id); setActiveSectionId(null); }} onSectionSelect={(section) => { setActiveSectionId(section.id); setMobileView("pages"); }} onAddNotebook={addNotebook} onNotebookMenu={(item) => setActionTarget({ type: "notebook", item })} onAddSection={addSection} onSectionMenu={(item) => setActionTarget({ type: "section", item })} onNotebookReorder={(ids) => void saveNotebookOrder(ids)} onSectionReorder={(notebookId, parentId, ids) => void saveSectionOrder(notebookId, parentId, ids)} onTrashOpen={() => setScreen("trash")} /></div>
      <div className={cn("notebook-no-print min-h-0", mobileView !== "pages" && "hidden md:block")}><PageList section={activeSection} pages={pages} activePageId={activePage?.id ?? null} loading={pagesLoading} onBack={() => setMobileView("navigation")} onAdd={addPage} onAddFromTemplate={() => setTemplatePickerOpen(true)} onSelect={openPage} onMenu={(item) => setActionTarget({ type: "page", item })} onReorder={(ids) => void savePageOrder(ids)} onFavorite={async (item) => { try { const { page } = await api<{ page: PageDocument }>(`/api/pages/${item.id}`, jsonOptions("PATCH", { isFavorite: !item.isFavorite })); pageSaved(page); } catch (cause) { report(cause); } }} /></div>
      <div className={cn("min-h-0", mobileView !== "editor" && "hidden md:block")}><EditorPane page={activePage} notebook={activeNotebook} section={activeSection} loading={pageLoading} editorEpoch={editorEpoch} onBack={() => { window.history.pushState(null, "", "/app"); setMobileView("pages"); }} onSaved={pageSaved} onController={registerEditorController} onNotebookClick={() => setMobileView("navigation")} onSectionClick={() => setMobileView("pages")} onInternalNavigate={async (pageId) => { try { await openPageById(pageId); } catch (cause) { report(cause); throw cause; } }} /></div></>}
    </div>
    <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} onSelect={(result) => void openSearchResult(result)}/>
    {actionTarget && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onMouseDown={() => setActionTarget(null)}><div className="w-full max-w-xs rounded-2xl bg-card p-2 shadow-xl ring-1 ring-border" onMouseDown={(e) => e.stopPropagation()}><p className="truncate px-3 py-2 text-sm font-semibold">{actionTarget.item.title}</p>
      <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("rename")}>Переименовать</button>
      {actionTarget.type === "notebook" && <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("appearance")}>Настроить блокнот</button>}
      {actionTarget.type === "notebook" && <a className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" href={`/api/data/export/notebook/${actionTarget.item.id}`}><span className="inline-flex items-center gap-2"><Download size={14}/>Экспортировать блокнот</span></a>}
      {actionTarget.type === "section" && <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("move")}>Переместить раздел</button>}
      {actionTarget.type === "page" && <><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("history")}>История версий</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("move")}>Переместить</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("duplicate")}>Дублировать страницу</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("template")}>Сохранить как шаблон</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("print")}>Экспорт → Печать / PDF</button><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { void copyPageLink(actionTarget.item); setActionTarget(null); }}><Link2 size={14}/>Копировать ссылку</button><a className="block w-full rounded-lg px-3 py-2 text-sm hover:bg-accent" href={`/api/data/export/page/${actionTarget.item.id}?format=markdown`}>Экспортировать страницу · Markdown</a><a className="block w-full rounded-lg px-3 py-2 text-sm hover:bg-accent" href={`/api/data/export/page/${actionTarget.item.id}?format=html`}>Экспортировать страницу · standalone HTML</a><a className="block w-full rounded-lg px-3 py-2 text-sm hover:bg-accent" href={`/api/data/export/page/${actionTarget.item.id}?format=json`}>Экспортировать страницу · Notebook JSON</a></>}
      <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("up")}>Переместить выше</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void runAction("down")}>Переместить ниже</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-accent" onClick={() => void runAction("delete")}>Переместить в корзину</button><button className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent" onClick={() => setActionTarget(null)}>Отмена</button></div></div>}
    {appearanceNotebook && <AppearanceDialog key={appearanceNotebook.id} notebook={appearanceNotebook} open onOpenChange={(open) => { if (!open) setAppearanceNotebook(null); }} onSave={saveAppearance}/>} 
    <MoveDialog target={moveTarget} notebooks={notebooks} open={Boolean(moveTarget)} onOpenChange={(open) => { if (!open) setMoveTarget(null); }} onMove={moveSelected}/>
    {historyOpen && <VersionHistory key={activePage?.id} page={activePage} open onOpenChange={setHistoryOpen} onRestore={restoreVersion}/>} 
    <DataSettings open={dataSettingsOpen} onOpenChange={setDataSettingsOpen} notebooks={notebooks} activeSectionId={activeSection?.id ?? null} onChanged={async () => { await loadNotebooks(); setWorkspaceRevision((value) => value + 1); }} onOpenPage={(pageId) => { setDataSettingsOpen(false); void openPageById(pageId).catch(report); }} onError={report}/>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onDataOpen={() => setDataSettingsOpen(true)} onTemplatesOpen={() => { setSettingsOpen(false); setTemplateManagerOpen(true); }} onError={report}/>
    <TemplatePicker open={templatePickerOpen} onOpenChange={setTemplatePickerOpen} onSelect={addPageFromTemplate} onError={report}/><TemplateManager open={templateManagerOpen} onOpenChange={setTemplateManagerOpen} onError={report}/><PrintDialog open={printOpen} onOpenChange={setPrintOpen}/>
  </div>;
}
