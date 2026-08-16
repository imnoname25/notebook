"use client";

import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu, SyntaxHighlightingExtension, type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { createReactBlockSpec, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, FileText, Info, Lightbulb, ListTree } from "lucide-react";
import { t } from "@/lib/i18n/messages";

export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = { text: { name: "Plain text" }, javascript: { name: "JavaScript", aliases: ["js"] }, typescript: { name: "TypeScript", aliases: ["ts"] }, json: { name: "JSON" }, html: { name: "HTML" }, css: { name: "CSS" }, bash: { name: "Shell", aliases: ["sh"] }, powershell: { name: "PowerShell", aliases: ["ps1"] }, python: { name: "Python", aliases: ["py"] }, sql: { name: "SQL" }, yaml: { name: "YAML", aliases: ["yml"] } };
export const CALLOUT_TYPES = ["info", "note", "warning", "success", "error"] as const;

const callout = createReactBlockSpec({ type: "callout", propSchema: { kind: { default: "info", values: CALLOUT_TYPES }, title: { default: "" } }, content: "inline" }, {
  render: ({ block, editor, contentRef }) => { const icons = { info: <Info size={18}/>, note: <Lightbulb size={18}/>, warning: <AlertCircle size={18}/>, success: <CheckCircle2 size={18}/>, error: <AlertCircle size={18}/> }; return <div className={`notebook-callout notebook-callout-${block.props.kind}`}><span className="notebook-callout-icon" contentEditable={false}>{icons[block.props.kind]}</span><div className="min-w-0 flex-1"><input aria-label="Заголовок callout" className="notebook-callout-title" value={block.props.title} placeholder="Заголовок (необязательно)" onChange={(event) => editor.updateBlock(block, { props: { title: event.target.value } })}/><div ref={contentRef} className="notebook-callout-content"/></div><select aria-label="Тип callout" contentEditable={false} className="notebook-callout-kind" value={block.props.kind} onChange={(event) => editor.updateBlock(block, { props: { kind: event.target.value as (typeof CALLOUT_TYPES)[number] } })}>{CALLOUT_TYPES.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div>; },
  toExternalHTML: ({ block, contentRef }) => <aside data-callout={block.props.kind}><strong>{block.props.title}</strong><div ref={contentRef}/></aside>,
})();

const toggle = createReactBlockSpec({ type: "toggle", propSchema: { open: { default: true } }, content: "inline" }, {
  render: ({ block, editor, contentRef }) => <div className="notebook-toggle" data-open={block.props.open ? "true" : "false"}><button type="button" contentEditable={false} aria-label={block.props.open ? "Свернуть" : "Развернуть"} aria-expanded={block.props.open} onClick={() => editor.updateBlock(block, { props: { open: !block.props.open } })}>{block.props.open ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</button><div ref={contentRef} className="min-w-0 flex-1 font-medium"/></div>,
  toExternalHTML: ({ contentRef }) => <details open><summary ref={contentRef}/></details>,
})();

export const notebookEditorSchema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, codeBlock: createCodeBlockSpec({ defaultLanguage: "text", supportedLanguages: CODE_LANGUAGES }), callout, toggle } });
export const notebookSyntaxHighlighting = SyntaxHighlightingExtension({ createHighlighter: async () => { const { createHighlighter } = await import("shiki"); return createHighlighter({ themes: ["github-light", "github-dark"], langs: ["javascript", "typescript", "json", "html", "css", "bash", "powershell", "python", "sql", "yaml"] }); } });
export type NotebookBlock = PartialBlock<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;
export type NotebookEditor = BlockNoteEditor<typeof notebookEditorSchema.blockSchema, typeof notebookEditorSchema.inlineContentSchema, typeof notebookEditorSchema.styleSchema>;

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
    { title: t("editor.toggle"), subtext: t("editor.toggleDescription"), aliases: ["toggle", "collapse", "details", "свернуть"], group: t("editor.group.advanced"), icon: <ListTree size={16}/>, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toggle", props: { open: true }, content: "Детали", children: [{ type: "paragraph" }] }) },
    { title: t("editor.pageLink"), subtext: t("editor.pageLinkDescription"), aliases: ["link page", "page", "mention", "ссылка"], group: t("editor.group.advanced"), icon: <FileText size={16}/>, onItemClick: () => { insertOrUpdateBlockForSlashMenu(editor, { type: "paragraph", content: "[[" }); openPagePicker(); } },
  ];
  return filterSuggestionItems([...defaults, ...custom], query);
}
