"use client";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowLeftRight, Columns2, X } from "lucide-react";
import { otherPane, type WorkspacePaneId } from "@/lib/split-workspace";
import type { useWorkspaceTabs } from "./use-workspace-tabs";
import type { EditorPane } from "./editor-pane";
import type { EditorSaveController, Notebook } from "./types";
import type { PageOutlineItem } from "@/lib/page-outline";
import { DocumentTabs } from "./document-tabs";

type Workspace = ReturnType<typeof useWorkspaceTabs>;
type EditorProps = ComponentProps<typeof EditorPane>;
type Props = { workspace: Workspace; notebooks: Notebook[]; enabled: boolean; blocked: boolean; onActiveOutline(items: PageOutlineItem[]): void; suspended: boolean; renderBase(overrides: Partial<EditorProps>): ReactNode };
export function WorkspaceEditors(props: Props) {
  const { workspace, enabled, suspended } = props;
  const root = useRef<HTMLDivElement>(null);const [width, setWidth] = useState(0);
  const gesture = useRef<{ pointer: number; start: number; ratio: number } | null>(null);
  useEffect(() => { const node = root.current;if (!node) return;const observer = new ResizeObserver(() => setWidth(node.clientWidth));observer.observe(node);return () => observer.disconnect(); }, []);
  const roomy = width >= 760;const two = enabled && workspace.split && roomy;
  const minimum = width ? 360 / Math.max(1, width - 6) : 0.5;
  const ratio = Math.max(minimum, Math.min(1 - minimum, workspace.ratio));
  useEffect(() => {
    if (suspended) return;
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.defaultPrevented) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { if (!workspace.split) return;event.preventDefault();const pane = event.key === "ArrowLeft" ? "left" : "right";workspace.focus(pane);requestAnimationFrame(() => workspace.editor(pane)?.focus?.()); }
      else if (event.key === "Enter") {
        event.preventDefault();if (event.shiftKey) void workspace.closeSplit();else { const id = workspace.documents[workspace.active]?.id;if (id) void workspace.transfer(id, otherPane(workspace.active)); }
      }
    };window.addEventListener("keydown", keys);return () => window.removeEventListener("keydown", keys);
  }, [workspace, suspended]);
  const finish = (event: React.PointerEvent, cancel = false) => {
    const drag = gesture.current;if (!drag || drag.pointer !== event.pointerId) return;gesture.current = null;
    if (root.current) { root.current.dataset.resizing = "false";root.current.style.gridTemplateColumns = ""; }
    if (!cancel) workspace.setRatio(Math.max(minimum, Math.min(1 - minimum, drag.ratio)));
  };
  return <div ref={root} className="workspace-editors" data-two={two} data-suspended={suspended} style={{ "--workspace-split-ratio": ratio } as React.CSSProperties}>
    {(["left", "right"] as const).map(pane => {
      const page = workspace.documents[pane];
      return <WorkspacePane key={page ? `${page.id}:${workspace.epochs[page.id] ?? 0}` : `empty-${pane}`} {...props} pane={pane} visible={two || pane === workspace.active} roomy={roomy}/>;
    })}
    {two && <div role="separator" aria-label="Ширина панелей документов" aria-orientation="vertical" aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round((1 - minimum) * 100)} aria-valuenow={Math.round(ratio * 100)} tabIndex={0} className="workspace-document-divider"
      onPointerDown={event => { if (event.button) return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);gesture.current = { pointer: event.pointerId, start: event.clientX, ratio };if (root.current) root.current.dataset.resizing = "true"; }}
      onPointerMove={event => { const drag = gesture.current;if (!drag || drag.pointer !== event.pointerId || !root.current) return;drag.ratio = Math.max(minimum, Math.min(1 - minimum, (event.clientX - root.current.getBoundingClientRect().left) / width));root.current.style.gridTemplateColumns = `${drag.ratio * (width - 6)}px 6px minmax(0, 1fr)`; }}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onDoubleClick={() => workspace.setRatio(0.5)}
      onKeyDown={event => { if (event.key === "Home") { event.preventDefault();workspace.setRatio(0.5); }else if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault();workspace.setRatio(Math.max(minimum, Math.min(1 - minimum, ratio + (event.key === "ArrowLeft" ? -0.02 : 0.02)))); } }}/>}
  </div>;
}

function WorkspacePane({ workspace, notebooks, enabled, blocked, onActiveOutline, suspended, renderBase, pane, visible, roomy }: Props & { pane: WorkspacePaneId; visible: boolean; roomy: boolean }) {
  const page = workspace.documents[pane];const active = workspace.active === pane;
  const [outline, setOutline] = useState<PageOutlineItem[]>([]);
  useEffect(() => { if (active && !suspended) onActiveOutline(outline); }, [active, suspended, outline, onActiveOutline]);
  const register = workspace.register;const id = page?.id;
  const onController = useCallback((value: EditorSaveController | null) => { if (id) register(id, value); }, [register, id]);
  const book = notebooks.find(item => item.sections.some(section => section.id === page?.sectionId)) ?? null;
  const section = book?.sections.find(item => item.id === page?.sectionId) ?? null;
  const focus = () => { if (!active && !suspended) workspace.focus(pane); };
  const controller = workspace.controller(pane);
  return <section className="workspace-editor-slot" data-pane={pane} data-active={active} data-visible={visible} aria-label={pane === "left" ? "Левая панель документов" : "Правая панель документов"}
    onPointerDownCapture={focus} onFocusCapture={focus}
    onDragOver={event => { if (event.dataTransfer.types.includes("text/notebook-tab")) event.preventDefault(); }}
    onDrop={event => { const tab = event.dataTransfer.getData("text/notebook-tab");if (tab && workspace.owner(tab) !== pane) { event.preventDefault();void workspace.transfer(tab, pane); } }}>
    {renderBase({ page, notebook: book, section, paneId: pane, paneActive: active && !suspended, onController, outline, onOutlineChange: setOutline, loading: !page && controller.busy, editorEpoch: workspace.epochs[page?.id ?? ""] ?? 0, navigationBusy: blocked || workspace.busy || controller.busy,
      documentTabs: <div className="workspace-tabs-heading"><DocumentTabs controller={controller} keyboardActive={active && !suspended} paneId={pane} onMove={tab => void workspace.transfer(tab, otherPane(pane))} onReceive={tab => void workspace.transfer(tab, pane)}/><div className="workspace-split-actions">
        {workspace.split ? <><button type="button" aria-label="Переключить панель" title="Соседняя панель (Ctrl/⌘ + Alt + ←/→)" onClick={() => { const next = otherPane(pane);workspace.focus(next);requestAnimationFrame(() => workspace.editor(next)?.focus?.()); }}><ArrowLeftRight size={15}/></button><button type="button" aria-label="Закрыть Split View" title="Одна панель (Ctrl/⌘ + Alt + Shift + Enter)" onClick={() => void workspace.closeSplit()}><X size={15}/></button></> : enabled && <button type="button" aria-label="Split View" title={roomy ? "Открыть вторую панель" : "Для двух редакторов нужно больше места"} disabled={!roomy || workspace.busy} onClick={() => workspace.enable()}><Columns2 size={16}/></button>}
      </div></div>,
    })}
  </section>;
}
