import { escapeHtml } from "./html-export";

/** Plain TSV only; rich spreadsheet HTML remains handled by BlockNote. */
export function tsvToTableHtml(text: string, widths: readonly unknown[] = []): string | null {
  if (!text.includes("\t") || text.length > 1_000_000) return null;
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted) quoted = false;
      else if (!cell.length) quoted = true;
      else cell += char;
    } else if (!quoted && (char === "\t" || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (row.length > 10_000) return null;
      if (char !== "\t") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        rows.push(row); row = [];
        if (rows.length > 10_000) return null;
      }
    } else cell += char;
  }
  if (quoted) return null;
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const columns = Math.max(0, ...rows.map(row => row.length));
  if (columns < 2 || rows.length * columns > 10_000) return null;
  const colgroup = `<colgroup>${Array.from({ length: columns }, (_, index) => {
    const width = widths[index];
    return `<col${typeof width === "number" && Number.isInteger(width) && width > 0 && width <= 10000 ? ` style="width:${width}px"` : ""}>`;
  }).join("")}</colgroup>`;
  return `<table>${colgroup}<tbody>${rows.map(row => `<tr>${Array.from({ length: columns }, (_, index) => {
    const width = widths[index];
    const attribute = typeof width === "number" && Number.isInteger(width) && width > 0 && width <= 10000 ? ` colwidth="${width}"` : "";
    return `<td${attribute}>${escapeHtml(row[index] ?? "").replace(/\r?\n/g, "<br>")}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
}
