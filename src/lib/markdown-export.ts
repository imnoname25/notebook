function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function inline(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const node = record(item); if (!node) return "";
    if (node.type === "link") { const href = String(node.href ?? ""); const label = inline(node.content); return href.startsWith("/pages/") || href.startsWith("notebook-page://") ? label : `[${label}](${href})`; }
    let text = typeof node.text === "string" ? node.text : inline(node.content);
    const styles = record(node.styles);
    if (styles?.code) text = `\`${text}\``; if (styles?.bold) text = `**${text}**`; if (styles?.italic) text = `*${text}*`; if (styles?.strike) text = `~~${text}~~`;
    return text;
  }).join("");
}

function tableMarkdown(content: Record<string, unknown>) {
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const values = rows.map((row) => { const cells = Array.isArray(record(row)?.cells) ? record(row)!.cells as unknown[] : []; return cells.map((cell) => inline(record(cell)?.content ?? cell)); });
  if (!values.length) return ""; const width = Math.max(...values.map((row) => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => (row[index] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(values[0] ?? []), line(Array.from({ length: width }, () => "---")), ...values.slice(1).map(line)].join("\n");
}

export function blockNoteToMarkdown(title: string, blocks: unknown[]) {
  const lines = [`# ${title}`, ""];
  for (const raw of blocks) {
    const block = record(raw); if (!block) continue; const type = String(block.type ?? "paragraph"); const text = inline(block.content);
    const nested = Array.isArray(block.children) ? blockNoteToMarkdown("", block.children).replace(/^#\s*\n+/u, "") : "";
    let childrenHandled = false;
    if (type === "heading") lines.push(`${"#".repeat(Math.max(1, Math.min(6, Number(record(block.props)?.level ?? 1))))} ${text}`);
    else if (type === "bulletListItem") lines.push(`- ${text}`);
    else if (type === "numberedListItem") lines.push(`1. ${text}`);
    else if (type === "checkListItem") lines.push(`- [${record(block.props)?.checked ? "x" : " "}] ${text}`);
    else if (type === "quote") lines.push(`> ${text}`);
    else if (type === "codeBlock") lines.push(`\`\`\`${String(record(block.props)?.language ?? "")}\n${text}\n\`\`\``);
    else if (type === "image") lines.push(`![${String(record(block.props)?.caption ?? "image")}](${String(record(block.props)?.url ?? "")})`);
    else if (type === "table") lines.push(tableMarkdown(record(block.content) ?? {}));
    else if (type === "callout" || type === "banner") { const props = record(block.props); lines.push(`> **${String(props?.title || props?.kind || (type === "banner" ? "Banner" : "Note"))}** — ${text}`); }
    else if (type === "toggle" || type === "toggleListItem") { lines.push(`<details>\n<summary>${text || "Детали"}</summary>\n\n${nested}\n</details>`); childrenHandled = true; }
    else if (type === "bookmark") { const props = record(block.props); const url = String(props?.url ?? ""); lines.push(`**[${String(props?.title || url)}](${url})**${props?.description ? ` — ${String(props.description)}` : ""}`); }
    else if (type === "liveWidget") { const props = record(block.props); lines.push(`> **${String(props?.title || "Live Widget")}** — ${String(props?.targetLabel || "")}`); }
    else if (type === "divider") lines.push(text ? `--- **${text}** ---` : "---");
    else if (type === "tabs") { lines.push(nested); childrenHandled = true; }
    else if (type === "tabPanel") { lines.push(`## ${String(record(block.props)?.label || "Вкладка")}`, "", nested); childrenHandled = true; }
    else if (type === "columns" || type === "columnPanel") { lines.push(nested); childrenHandled = true; }
    else if (type === "tableOfContents") lines.push(`> **${String(record(block.props)?.title || "Оглавление")}** — формируется по заголовкам страницы`);
    else if (type === "pageVariables") { childrenHandled = true; }
    else lines.push(text);
    if (!childrenHandled && nested) lines.push(nested);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
