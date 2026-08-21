"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { extractPageOutline, type PageOutlineItem } from "@/lib/page-outline";
import type { NotebookEditor, NotebookFullBlock } from "./editor-schema";

export const DIVIDER_STYLES = ["line", "dots", "fade", "label"] as const;

export const dividerBlock = createReactBlockSpec({
  type: "divider",
  propSchema: { style: { default: "line", values: DIVIDER_STYLES } },
  content: "inline",
}, {
  render: ({ block, editor, contentRef }) => <div className="notebook-divider" data-divider-style={block.props.style} contentEditable={false}>
    <span aria-hidden="true"/><div ref={contentRef} contentEditable={block.props.style === "label"} data-placeholder="Подпись"/><span aria-hidden="true"/>
    <select aria-label="Стиль разделителя" value={block.props.style} onChange={(event) => editor.updateBlock(block, { props: { style: event.target.value as (typeof DIVIDER_STYLES)[number] } })}>
      <option value="line">Линия</option><option value="dots">Точки</option><option value="fade">Затухание</option><option value="label">С подписью</option>
    </select>
  </div>,
  toExternalHTML: ({ block, contentRef }) => block.props.style === "label" ? <div className="notebook-divider-export"><hr/><strong ref={contentRef}/><hr/></div> : <hr/>,
})();

type TabsEvent = { panelIds: string[]; activeId: string };

export const tabPanelBlock = createReactBlockSpec({ type: "tabPanel", propSchema: { label: { default: "Вкладка" } }, content: "none" }, {
  render: ({ block }) => <TabPanelView block={block}/>,
  toExternalHTML: ({ block }) => <section className="notebook-tab-export"><h2>{block.props.label}</h2></section>,
})();

export const tabsBlock = createReactBlockSpec({ type: "tabs", propSchema: { label: { default: "Вкладки" } }, content: "none" }, {
  render: ({ block, editor }) => <TabsView block={block as unknown as NotebookFullBlock} editor={editor as unknown as NotebookEditor}/>,
  toExternalHTML: ({ block }) => <section className="notebook-tabs-export" aria-label={block.props.label}/>,
})();

export const tocBlock = createReactBlockSpec({ type: "tableOfContents", propSchema: { title: { default: "Оглавление" }, depth: { default: 3, values: [1, 2, 3] as const } }, content: "none" }, {
  render: ({ block, editor }) => <TocView block={block} editor={editor as unknown as NotebookEditor}/>,
  toExternalHTML: ({ block }) => <nav className="notebook-toc-export"><strong>{block.props.title}</strong></nav>,
})();

export const columnPanelBlock = createReactBlockSpec({ type: "columnPanel", propSchema: { label: { default: "Колонка" } }, content: "none" }, {
  render: ({ block }) => <div className="notebook-column-panel-marker" aria-label={block.props.label}/>,
  toExternalHTML: ({ block }) => <section className="notebook-column-export" aria-label={block.props.label}/>,
})();

export const columnsBlock = createReactBlockSpec({ type: "columns", propSchema: { count: { default: 2, values: [2, 3] as const } }, content: "none" }, {
  render: ({ block }) => <div className="notebook-columns-marker" data-columns={block.props.count} aria-label={`${block.props.count} колонки`}/>,
  toExternalHTML: ({ block }) => <section className="notebook-columns-export" data-columns={block.props.count}/>,
})();

export const pageVariablesBlock = createReactBlockSpec({ type: "pageVariables", propSchema: { data: { default: "[]" } }, content: "none" }, {
  render: () => <span className="notebook-page-variables-marker" aria-hidden="true"/>,
  toExternalHTML: () => <span/>,
})();

function TabPanelView({ block }: { block: { id: string; props: { label: string } } }) {
  const marker = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<TabsEvent>).detail;
      if (!detail?.panelIds.includes(block.id)) return;
      const outer = marker.current?.closest<HTMLElement>(".bn-block-outer");
      if (outer) outer.hidden = detail.activeId !== block.id;
    };
    window.addEventListener("notebook:tabs-active", show);
    return () => window.removeEventListener("notebook:tabs-active", show);
  }, [block.id]);
  return <div ref={marker} className="notebook-tab-panel-marker" aria-label={block.props.label}/>;
}

function TabsView({ block, editor }: { block: NotebookFullBlock; editor: NotebookEditor }) {
  const panels = useMemo(() => block.children.filter((child) => child.type === "tabPanel"), [block.children]);
  const [activeId, setActiveId] = useState(() => panels[0]?.id ?? "");
  const active = panels.find((panel) => panel.id === activeId) ?? panels[0];
  useEffect(() => {
    if (!active) return;
    window.dispatchEvent(new CustomEvent<TabsEvent>("notebook:tabs-active", { detail: { panelIds: panels.map((panel) => panel.id), activeId: active.id } }));
  }, [active, panels]);
  useEffect(() => {
    const reveal = (event: Event) => {
      const targetId = (event as CustomEvent<string>).detail;
      const panel = panels.find((candidate) => candidate.id === targetId || containsBlock(candidate.children, targetId));
      if (panel) setActiveId(panel.id);
    };
    window.addEventListener("notebook:reveal-block", reveal);
    return () => window.removeEventListener("notebook:reveal-block", reveal);
  }, [panels]);
  const activeIndex = active ? panels.findIndex((panel) => panel.id === active.id) : -1;
  const add = () => {
    if (panels.length >= 8) return;
    editor.updateBlock(block, { children: [...block.children, { type: "tabPanel", props: { label: `Вкладка ${panels.length + 1}` }, children: [{ type: "paragraph" }] }] });
  };
  const label = "label" in block.props ? String(block.props.label) : "Вкладки";
  return <div className="notebook-tabs" contentEditable={false}>
    <div className="notebook-tab-strip" role="tablist" aria-label={label}>
      {panels.map((panel) => <button key={panel.id} type="button" role="tab" aria-selected={panel.id === active?.id} onClick={() => setActiveId(panel.id)}>{String(panel.props.label || "Вкладка")}</button>)}
      <button type="button" className="notebook-tab-add" aria-label="Добавить вкладку" onClick={add} disabled={panels.length >= 8}><Plus size={16}/></button>
    </div>
    {active && <div className="notebook-tab-editor">
      <input aria-label="Название вкладки" value={String(active.props.label || "")} maxLength={60} onChange={(event) => editor.updateBlock(active, { props: { label: event.target.value } })}/>
      <button type="button" aria-label="Переместить вкладку влево" disabled={activeIndex <= 0} onClick={() => editor.moveBlocksUp(active)}><ChevronLeft size={16}/></button>
      <button type="button" aria-label="Переместить вкладку вправо" disabled={activeIndex < 0 || activeIndex >= panels.length - 1} onClick={() => editor.moveBlocksDown(active)}><ChevronRight size={16}/></button>
      <button type="button" aria-label="Удалить вкладку" disabled={panels.length <= 2} onClick={() => { const next = panels[activeIndex - 1] ?? panels[activeIndex + 1]; if (next) setActiveId(next.id); editor.removeBlocks([active]); }}><Trash2 size={16}/></button>
    </div>}
  </div>;
}

function TocView({ block, editor }: { block: { id: string; props: { title: string; depth: 1 | 2 | 3 } }; editor: NotebookEditor }) {
  const [items, setItems] = useState<PageOutlineItem[]>(() => tocItems(editor.document, block.id, block.props.depth));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = editor.onChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setItems(tocItems(editor.document, block.id, block.props.depth)), 200);
    });
    return () => { if (timer) clearTimeout(timer); unsubscribe(); };
  }, [block.id, block.props.depth, editor]);
  return <nav className="notebook-toc" contentEditable={false} aria-label={block.props.title}>
    <strong>{block.props.title}</strong>
    {items.length ? items.map((item) => <button key={item.id} type="button" data-level={item.level} onClick={() => window.dispatchEvent(new CustomEvent("notebook:scroll-to-block", { detail: item.id }))}>{item.title}</button>) : <span>Заголовков пока нет</span>}
  </nav>;
}

function tocItems(document: unknown, ownId: string, depth: number) {
  return extractPageOutline(document).filter((item) => item.id !== ownId && item.level <= depth);
}

function containsBlock(children: unknown[], id: string): boolean {
  return children.some((child) => child && typeof child === "object" && ("id" in child && child.id === id || "children" in child && Array.isArray(child.children) && containsBlock(child.children, id)));
}
