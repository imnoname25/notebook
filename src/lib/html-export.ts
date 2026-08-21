function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function escapeHtml(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

function inline(value: unknown): string {
  if (typeof value === "string") return escapeHtml(value);
  if (!Array.isArray(value)) return "";
  return value.map((raw) => { const node = object(raw); if (!node) return ""; if (node.type === "link") { const label = inline(node.content); const href = String(node.href ?? ""); if (href.startsWith("/pages/") || href.startsWith("notebook-page://")) return label; if (!/^(?:https?:|mailto:)/iu.test(href)) return label; return `<a href="${escapeHtml(href)}" rel="noreferrer">${label}</a>`; } let text = escapeHtml(node.text ?? ""); const styles = object(node.styles); if (styles?.code) text = `<code>${text}</code>`; if (styles?.bold) text = `<strong>${text}</strong>`; if (styles?.italic) text = `<em>${text}</em>`; if (styles?.underline) text = `<u>${text}</u>`; if (styles?.strike) text = `<s>${text}</s>`; return text; }).join("");
}

function table(value: unknown) { const rows = Array.isArray(object(value)?.rows) ? object(value)!.rows as unknown[] : []; return `<table><tbody>${rows.map((raw) => { const cells = Array.isArray(object(raw)?.cells) ? object(raw)!.cells as unknown[] : []; return `<tr>${cells.map((cell) => `<td>${inline(object(cell)?.content ?? cell)}</td>`).join("")}</tr>`; }).join("")}</tbody></table>`; }

export function blockNoteToSafeHtml(blocks: unknown[], imagePath: (url: string) => string | null): string {
  return blocks.map((raw) => {
    const block = object(raw); if (!block) return ""; const type = String(block.type ?? "paragraph"); const props = object(block.props); const content = inline(block.content); const children = Array.isArray(block.children) ? blockNoteToSafeHtml(block.children, imagePath) : "";
    if (type === "heading") { const level = Math.max(1, Math.min(3, Number(props?.level ?? 1))); return `<h${level}>${content}</h${level}>`; }
    if (type === "bulletListItem") return `<ul><li>${content}${children}</li></ul>`;
    if (type === "numberedListItem") return `<ol><li>${content}${children}</li></ol>`;
    if (type === "checkListItem") return `<p class="check">${props?.checked ? "☑" : "☐"} ${content}</p>`;
    if (type === "quote") return `<blockquote>${content}</blockquote>`;
    if (type === "codeBlock") return `<pre><code data-language="${escapeHtml(props?.language ?? "text")}">${content}</code></pre>`;
    if (type === "image") { const source = imagePath(String(props?.url ?? "")); return source ? `<figure><img src="${escapeHtml(source)}" alt="${escapeHtml(props?.caption ?? "")}">${props?.caption ? `<figcaption>${escapeHtml(props.caption)}</figcaption>` : ""}</figure>` : ""; }
    if (type === "table") return table(block.content);
    if (type === "callout") return `<aside class="callout"><strong>${escapeHtml(props?.title || props?.kind || "Заметка")}</strong>${content ? `<p>${content}</p>` : ""}</aside>`;
    if (type === "banner") return `<aside class="banner"><strong>${escapeHtml(props?.title || props?.kind || "Важная информация")}</strong>${content ? `<p>${content}</p>` : ""}</aside>`;
    if (type === "toggle" || type === "toggleListItem") return `<details open><summary>${content || "Детали"}</summary>${children}</details>`;
    if (type === "bookmark") { const url = String(props?.url ?? ""); if (!/^https?:\/\//iu.test(url)) return ""; return `<p class="bookmark"><a href="${escapeHtml(url)}" rel="noreferrer"><strong>${escapeHtml(props?.title || url)}</strong><br><span>${escapeHtml(props?.description || url)}</span></a></p>`; }
    if (type === "liveWidget") return `<aside class="callout"><strong>${escapeHtml(props?.title || "Live Widget")}</strong><p>${escapeHtml(props?.targetLabel || "")}</p></aside>`;
    if (type === "divider") return content ? `<div class="divider-label"><hr><strong>${content}</strong><hr></div>` : "<hr>";
    if (type === "tabs") return `<section class="tabs">${children}</section>`;
    if (type === "tabPanel") return `<section class="tab-panel"><h2>${escapeHtml(props?.label || "Вкладка")}</h2>${children}</section>`;
    if (type === "columns") return `<section class="columns" data-columns="${Number(props?.count) === 3 ? 3 : 2}">${children}</section>`;
    if (type === "columnPanel") return `<section class="column">${children}</section>`;
    if (type === "tableOfContents") return `<nav class="toc"><strong>${escapeHtml(props?.title || "Оглавление")}</strong></nav>`;
    if (type === "pageVariables") return "";
    return `<p>${content || "&nbsp;"}</p>${children}`;
  }).join("\n");
}

export function standalonePageHtml(title: string, updatedAt: Date, content: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{max-width:850px;margin:48px auto;padding:0 24px;color:#202124;font:16px/1.65 system-ui,sans-serif}h1{font-size:2.25rem;line-height:1.2}h2,h3{margin-top:1.7em}a{color:#2457a7}img{max-width:100%;height:auto}pre{overflow:auto;padding:16px;border-radius:8px;background:#f3f4f6;white-space:pre-wrap}code{font-family:ui-monospace,monospace}blockquote,.callout,.banner{margin:1em 0;padding:12px 16px;border-left:3px solid #64748b;background:#f6f7f9}.banner{padding:18px 20px;border-radius:8px}table{width:100%;border-collapse:collapse}td{padding:8px;border:1px solid #d7dbe0;vertical-align:top}details{margin:1em 0}.tabs{border:1px solid #d7dbe0;border-radius:8px;padding:12px}.tab-panel+ .tab-panel{border-top:1px solid #d7dbe0}.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.columns[data-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}.column{min-width:0;border:1px solid #d7dbe0;border-radius:8px;padding:10px}.divider-label{display:flex;align-items:center;gap:12px}.divider-label hr{flex:1}.meta{color:#6b7280;font-size:.85rem}@media(max-width:640px){.columns,.columns[data-columns="3"]{grid-template-columns:1fr}}@media print{body{margin:0;max-width:none}.callout,.banner,pre{break-inside:avoid}a{color:inherit}}</style></head><body><article><h1>${escapeHtml(title)}</h1><p class="meta">Изменено ${escapeHtml(updatedAt.toLocaleString("ru"))}</p>${content}</article></body></html>`;
}
