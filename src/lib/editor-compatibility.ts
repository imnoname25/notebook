/** Mirrored by a schema contract test; independent of browser-only BlockNote modules. */
export const EDITOR_BLOCK_TYPES = ["audio", "bulletListItem", "checkListItem", "codeBlock", "divider", "file", "heading", "image", "numberedListItem", "paragraph", "quote", "table", "toggleListItem", "video", "callout", "banner", "toggle", "bookmark", "tabs", "tabPanel", "columns", "columnPanel", "tableOfContents", "pageVariables", "liveWidget"] as const;

export function unsupportedEditorBlocks(content: unknown): string[] {
  const supported = new Set<string>(EDITOR_BLOCK_TYPES);
  const unknown = new Set<string>();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") { unknown.add("invalid block"); continue; }
      const block = item as Record<string, unknown>;
      if (typeof block.type !== "string" || !supported.has(block.type)) unknown.add(typeof block.type === "string" ? block.type : "invalid block");
      visit(block.children);
    }
  };
  visit(content);
  return [...unknown];
}
