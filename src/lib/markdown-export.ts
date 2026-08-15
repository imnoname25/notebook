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
    if (type === "heading") lines.push(`${"#".repeat(Math.max(1, Math.min(6, Number(record(block.props)?.level ?? 1))))} ${text}`);
    else if (type === "bulletListItem") lines.push(`- ${text}`);
    else if (type === "numberedListItem") lines.push(`1. ${text}`);
    else if (type === "checkListItem") lines.push(`- [${record(block.props)?.checked ? "x" : " "}] ${text}`);
    else if (type === "quote") lines.push(`> ${text}`);
    else if (type === "codeBlock") lines.push(`\`\`\`${String(record(block.props)?.language ?? "")}\n${text}\n\`\`\``);
    else if (type === "image") lines.push(`![${String(record(block.props)?.caption ?? "image")}](${String(record(block.props)?.url ?? "")})`);
    else if (type === "table") lines.push(tableMarkdown(record(block.content) ?? {}));
    else if (type === "callout") { const props = record(block.props); lines.push(`> **${String(props?.title || props?.kind || "Note")}** — ${text}`); }
    else if (type === "toggle") lines.push(`<details>\n<summary>${text || "Детали"}</summary>\n\n${Array.isArray(block.children) ? blockNoteToMarkdown("", block.children).replace(/^#\s*\n+/, "") : ""}\n</details>`);
    else lines.push(text);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
