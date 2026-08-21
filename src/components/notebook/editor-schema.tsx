"use client";

import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu, SyntaxHighlightingExtension, type Block, type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { createReactBlockSpec, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { AlertCircle, Bookmark, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileText, Info, Lightbulb, ListTree } from "lucide-react";
import { t } from "@/lib/i18n/messages";
import { defaultLiveWidgetConfig, LIVE_WIDGET_LABELS, liveWidgetBlock } from "./live-widget-block";
import { liveWidgetTarget, type LiveWidgetType } from "@/lib/live-widgets";
import { columnPanelBlock, columnsBlock, dividerBlock, pageVariablesBlock, tabPanelBlock, tabsBlock, tocBlock } from "./structural-blocks";

export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = { text: { name: "Plain text" }, javascript: { name: "JavaScript", aliases: ["js"] }, typescript: { name: "TypeScript", aliases: ["ts"] }, json: { name: "JSON" }, html: { name: "HTML" }, css: { name: "CSS" }, bash: { name: "Shell", aliases: ["sh"] }, powershell: { name: "PowerShell", aliases: ["ps1"] }, cmd: { name: "Command Prompt", aliases: ["bat"] }, dockerfile: { name: "Dockerfile", aliases: ["docker"] }, python: { name: "Python", aliases: ["py"] }, sql: { name: "SQL" }, yaml: { name: "YAML", aliases: ["yml"] } };
export const CALLOUT_TYPES = ["info", "note", "warning", "success", "error"] as const;

const callout = createReactBlockSpec({ type: "callout", propSchema: { kind: { default: "info", values: CALLOUT_TYPES }, title: { default: "" }, backgroundColor: { default: "default" } }, content: "inline" }, {
  render: ({ block, editor, contentRef }) => { const icons = { info: <Info size={18}/>, note: <Lightbulb size={18}/>, warning: <AlertCircle size={18}/>, success: <CheckCircle2 size={18}/>, error: <AlertCircle size={18}/> }; return <div className={`notebook-callout notebook-callout-${block.props.kind}`}><span className="notebook-callout-icon" contentEditable={false}>{icons[block.props.kind]}</span><div className="min-w-0 flex-1"><input aria-label="Заголовок callout" className="notebook-callout-title" value={block.props.title} placeholder="Заголовок (необязательно)" onChange={(event) => editor.updateBlock(block, { props: { title: event.target.value } })}/><div ref={contentRef} className="notebook-callout-content"/></div><select aria-label="Тип callout" contentEditable={false} className="notebook-callout-kind" value={block.props.kind} onChange={(event) => editor.updateBlock(block, { props: { kind: event.target.value as (typeof CALLOUT_TYPES)[number] } })}>{CALLOUT_TYPES.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div>; },
  toExternalHTML: ({ block, contentRef }) => <aside data-callout={block.props.kind}><strong>{block.props.title}</strong><div ref={contentRef}/></aside>,
})();

const banner = createReactBlockSpec({ type: "banner", propSchema: { kind: { default: "info", values: CALLOUT_TYPES }, title: { default: "" }, backgroundColor: { default: "default" } }, content: "inline" }, {
  render: ({ block, editor, contentRef }) => { const icons = { info: <Info size={20}/>, note: <Lightbulb size={20}/>, warning: <AlertCircle size={20}/>, success: <CheckCircle2 size={20}/>, error: <AlertCircle size={20}/> }; return <section className={`notebook-banner notebook-banner-${block.props.kind}`}><span className="notebook-banner-icon" contentEditable={false}>{icons[block.props.kind]}</span><div className="min-w-0 flex-1"><input aria-label="Заголовок баннера" value={block.props.title} placeholder="Важная информация" onChange={(event) => editor.updateBlock(block, { props: { title: event.target.value } })}/><div ref={contentRef} className="notebook-banner-content"/></div><select aria-label="Тип баннера" contentEditable={false} value={block.props.kind} onChange={(event) => editor.updateBlock(block, { props: { kind: event.target.value as (typeof CALLOUT_TYPES)[number] } })}>{CALLOUT_TYPES.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></section>; },
  toExternalHTML: ({ block, contentRef }) => <aside data-banner={block.props.kind}><strong>{block.props.title}</strong><div ref={contentRef}/></aside>,
})();

const toggle = createReactBlockSpec({ type: "toggle", propSchema: { open: { default: true }, backgroundColor: { default: "default" } }, content: "inline" }, {
  render: ({ block, editor, contentRef }) => <div className="notebook-toggle" data-open={block.props.open ? "true" : "false"}><button type="button" contentEditable={false} aria-label={block.props.open ? "Свернуть" : "Развернуть"} aria-expanded={block.props.open} onClick={() => editor.updateBlock(block, { props: { open: !block.props.open } })}>{block.props.open ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</button><div ref={contentRef} className="min-w-0 flex-1 font-medium"/></div>,
  toExternalHTML: ({ contentRef }) => <details open><summary ref={contentRef}/></details>,
})();

const bookmark = createReactBlockSpec({ type: "bookmark", propSchema: { url: { default: "" }, title: { default: "" }, description: { default: "" }, backgroundColor: { default: "default" } }, content: "none" }, {
  render: ({ block }) => {
    let hostname = block.props.url;
    try { hostname = new URL(block.props.url).hostname; } catch { /* URL is validated before insertion. */ }
    return <a className="notebook-bookmark" href={block.props.url} target="_blank" rel="noreferrer" contentEditable={false}><span className="notebook-bookmark-icon"><Bookmark size={19}/></span><span className="min-w-0 flex-1"><strong className="block truncate">{block.props.title || hostname}</strong><span className="mt-0.5 block truncate text-sm text-muted-foreground">{block.props.description || block.props.url}</span></span><ExternalLink size={16} className="shrink-0 text-muted-foreground"/></a>;
  },
  toExternalHTML: ({ block }) => <a href={block.props.url}><strong>{block.props.title}</strong><span>{block.props.description || block.props.url}</span></a>,
})();

export const notebookEditorSchema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, divider: dividerBlock, codeBlock: createCodeBlockSpec({ defaultLanguage: "text", supportedLanguages: CODE_LANGUAGES }), callout, banner, toggle, bookmark, tabs: tabsBlock, tabPanel: tabPanelBlock, columns: columnsBlock, columnPanel: columnPanelBlock, tableOfContents: tocBlock, pageVariables: pageVariablesBlock, liveWidget: liveWidgetBlock } });
export const notebookSyntaxHighlighting = SyntaxHighlightingExtension({ createHighlighter: async () => { const { createHighlighter } = await import("shiki"); return createHighlighter({ themes: ["github-light", "github-dark"], langs: ["javascript", "typescript", "json", "html", "css", "bash", "powershell", "bat", "dockerfile", "python", "sql", "yaml"] }); } });
export type NotebookBlock = PartialBlock<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;
export type NotebookFullBlock = Block<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;
export type NotebookEditor = BlockNoteEditor<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;

export function insertLiveWidget(editor: NotebookEditor, type: LiveWidgetType = "HTTP_STATUS") {
  const config = defaultLiveWidgetConfig(type);
  insertOrUpdateBlockForSlashMenu(editor, { type: "liveWidget", props: { widgetType: type, title: "", config: JSON.stringify(config), targetLabel: liveWidgetTarget(config), refreshMode: "MANUAL", displaySize: "NORMAL" } });
}

export function normalizeEditorBlocks(value: unknown[]): NotebookBlock[] {
  const allowed = new Set(Object.keys(CODE_LANGUAGES));
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return { type: "paragraph" };
    const block = structuredClone(entry) as Record<string, unknown>;
    if (block.type === "codeBlock") { const props = block.props && typeof block.props === "object" ? { ...(block.props as Record<string, unknown>) } : {}; if (typeof props.language !== "string" || !allowed.has(props.language)) props.language = "text"; block.props = props; }
    if (Array.isArray(block.children)) block.children = normalizeEditorBlocks(block.children);
    return block as NotebookBlock;
  });
}

function defaultGroup(keyOrTitle: string) { const value = keyOrTitle.toLowerCase(); if (value.includes("text") || value.includes("paragraph")) return t("editor.group.text"); if (value.includes("heading")) return t("editor.group.headings"); if (value.includes("list") || value.includes("check")) return t("editor.group.lists"); if (["image", "video", "audio", "file"].some((name) => value.includes(name))) return t("editor.group.media"); return t("editor.group.advanced"); }
export function slashMenuItems(editor: NotebookEditor, openPagePicker: () => void, query: string) {
  const defaults = getDefaultReactSlashMenuItems(editor).map((item) => ({ ...item, group: defaultGroup("key" in item && typeof item.key === "string" ? item.key : item.title) }));
  const custom = [
    { title: t("editor.callout"), subtext: t("editor.calloutDescription"), aliases: ["callout", "note", "warning", "выделенный блок"], group: t("editor.group.advanced"), icon: <Info size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { kind: "info", title: "" }, content: "" }) },
    { title: "Баннер", subtext: "Широкая плашка для важной инструкции", aliases: ["banner", "notice", "баннер", "инструкция"], group: "Визуальные", icon: <AlertCircle size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "banner", props: { kind: "info", title: "" }, content: "" }) },
    { title: t("editor.toggle"), subtext: t("editor.toggleDescription"), aliases: ["toggle", "collapse", "details", "свернуть"], group: t("editor.group.advanced"), icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toggle", props: { open: true }, content: "Детали", children: [{ type: "paragraph" }] }) },
    { title: t("editor.bookmark"), subtext: t("editor.bookmarkDescription"), aliases: ["bookmark", "url", "link", "закладка"], group: t("editor.group.media"), icon: <Bookmark size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "bookmark", props: { url: "https://", title: "", description: "" } }) },
    { title: t("editor.pageLink"), subtext: t("editor.pageLinkDescription"), aliases: ["link page", "page", "mention", "ссылка"], group: t("editor.group.advanced"), icon: <FileText size={16}/>, onItemClick: () => { insertOrUpdateBlockForSlashMenu(editor, { type: "paragraph", content: "[[" }); openPagePicker(); } },
    { title: "Разделитель с подписью", subtext: "Линия, точки, fade или короткая подпись", aliases: ["divider", "line", "разделитель", "линия"], group: "Структура", icon: <Info size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "divider", props: { style: "label" }, content: "Раздел" }) },
    { title: "Сворачиваемая группа", subtext: "Заголовок с полноценными вложенными блоками", aliases: ["collapse", "group", "toggle section", "группа", "свернуть"], group: "Структура", icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toggleListItem", content: "Новая группа", children: [{ type: "paragraph" }] }) },
    { title: "Вкладки", subtext: "От 2 до 8 панелей с обычными блоками", aliases: ["tabs", "tab", "вкладки"], group: "Структура", icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "tabs", children: [{ type: "tabPanel", props: { label: "Windows" }, children: [{ type: "paragraph" }] }, { type: "tabPanel", props: { label: "Linux" }, children: [{ type: "paragraph" }] }] }) },
    { title: "Колонки", subtext: "Две равные колонки; на телефоне складываются вертикально", aliases: ["columns", "column", "колонки"], group: "Структура", icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "columns", props: { count: 2 }, children: [{ type: "columnPanel", props: { label: "Колонка 1" }, children: [{ type: "paragraph" }] }, { type: "columnPanel", props: { label: "Колонка 2" }, children: [{ type: "paragraph" }] }] }) },
    { title: "Три колонки", subtext: "Три равные колонки; на телефоне складываются вертикально", aliases: ["three columns", "3 columns", "три колонки"], group: "Структура", icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "columns", props: { count: 3 }, children: [{ type: "columnPanel", props: { label: "Колонка 1" }, children: [{ type: "paragraph" }] }, { type: "columnPanel", props: { label: "Колонка 2" }, children: [{ type: "paragraph" }] }, { type: "columnPanel", props: { label: "Колонка 3" }, children: [{ type: "paragraph" }] }] }) },
    { title: "Оглавление", subtext: "Автоматический список заголовков страницы", aliases: ["toc", "contents", "оглавление"], group: "Структура", icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "tableOfContents", props: { title: "Оглавление", depth: 3 } }) },
    ...(["HTTP_STATUS", "TCP_CHECK", "TLS_CERTIFICATE", "JSON_VALUE", "DATETIME", "COUNTDOWN"] as LiveWidgetType[]).map((type) => ({ title: LIVE_WIDGET_LABELS[type], subtext: "Живой информационный блок", aliases: type === "HTTP_STATUS" ? ["status", "http", "статус"] : type === "TCP_CHECK" ? ["tcp", "port", "порт"] : type === "TLS_CERTIFICATE" ? ["certificate", "tls", "сертификат"] : type === "JSON_VALUE" ? ["json", "value", "значение"] : type === "DATETIME" ? ["time", "date", "время"] : ["countdown", "timer", "таймер"], group: "Live Widgets", icon: <Info size={16}/>, onItemClick: () => insertLiveWidget(editor, type) })),
  ];
  return filterSuggestionItems([...defaults, ...custom], query);
}
