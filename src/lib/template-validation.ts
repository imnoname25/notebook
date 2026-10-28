import { blockNoteContentSchema } from "./data-format";
import { ApiError } from "./errors";
import { liveWidgetPropsSchema } from "./live-widgets";
import { pageLinkPropsSchema } from "./page-links";

const allowed = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock", "image", "table", "callout", "banner", "toggle", "bookmark", "liveWidget", "divider", "tabs", "tabPanel", "columns", "columnPanel", "tableOfContents", "pageVariables"]);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => new ApiError(400, "Шаблон содержит неподдерживаемую структуру содержимого");

/** Text is opaque text, not HTML. Only actual URL/inline fields are executable contexts. */
function url(value: unknown, media = false) {
  if (typeof value !== "string") throw invalid();
  const text = value.trim();if (!text) return;
  if (/[\u0000-\u001f\u007f]/u.test(text)) throw new ApiError(400, "Шаблон содержит небезопасную ссылку");
  let parsed: URL;
  try { parsed = new URL(text, "https://notebook.invalid"); } catch { throw new ApiError(400, "Некорректная ссылка в шаблоне"); }
  let pathname = parsed.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { throw invalid(); }
  if (/\/api\/uploads(?:\/|$)/iu.test(pathname) || parsed.protocol === "attachment:") throw new ApiError(409, "Сначала удалите private изображения: шаблоны пока не копируют файлы вложений");
  const relative = /^\/(?![\/\\])/u.test(text) || text.startsWith("#");
  if (media ? !/^https?:\/\//iu.test(text) : !relative && !/^(https?:|mailto:|tel:)/iu.test(text)) throw new ApiError(400, "Шаблон содержит небезопасную ссылку");
  if (!["https:", "http:", ...(media ? [] : ["mailto:", "tel:"])].includes(parsed.protocol)) throw new ApiError(400, "Шаблон содержит небезопасную ссылку");
}

export function validateTemplateContent(value: unknown) {
  const content = blockNoteContentSchema.parse(value);let count = 0;
  function inline(value: unknown, depth: number) {
    if (depth > 64) throw invalid();
    if (value === undefined || typeof value === "string") return;
    if (!Array.isArray(value)) throw invalid();
    for (const raw of value) {
      const node = object(raw);if (!node) throw invalid();
      if (node.type === "text") { if (typeof node.text !== "string") throw invalid(); }
      else if (node.type === "link") { url(node.href);inline(node.content, depth + 1); }
      else if (node.type === "pageLink") pageLinkPropsSchema.parse(node.props);
      else throw invalid();
    }
  }
  function blocks(value: unknown, depth: number) {
    if (depth > 64 || !Array.isArray(value)) throw invalid();
    for (const raw of value) {
      if (++count > 10_000) throw invalid();
      const block = object(raw);if (!block || typeof block.type !== "string") throw invalid();
      if (!allowed.has(block.type)) throw new ApiError(400, `Блок ${block.type} не поддерживается в шаблонах`);
      const props = object(block.props);
      if (block.type === "liveWidget") {
        const widget = liveWidgetPropsSchema.parse(props);
        if (widget.config.type === "HTTP_STATUS" || widget.config.type === "JSON_VALUE") url(widget.config.url, true);
      }
      if ((block.type === "image" || block.type === "bookmark") && props?.url !== undefined) url(props.url, true);
      if (block.type === "table" && block.content !== undefined) {
        const table = object(block.content);
        if (table?.type !== "tableContent" || !Array.isArray(table.rows)) throw invalid();
        for (const rawRow of table.rows) {
          const row = object(rawRow);if (!row || !Array.isArray(row.cells)) throw invalid();
          for (const cell of row.cells) {
            if (typeof cell === "string" || Array.isArray(cell)) inline(cell, depth + 1);
            else { const data = object(cell);if (data?.type !== "tableCell") throw invalid();inline(data.content, depth + 1); }
          }
        }
      } else inline(block.content, depth + 1);
      if (block.children !== undefined) blocks(block.children, depth + 1);
    }
  }
  blocks(content, 0);
  return content;
}
