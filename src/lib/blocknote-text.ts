export function extractBlockNoteText(value: unknown): string {
  const fragments: string[] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const type = "type" in node && typeof node.type === "string" ? node.type : null;
    if (type === "tableOfContents" || type === "pageVariables") return;
    for (const [key, child] of Object.entries(node)) {
      if ((key === "text" || key === "title" || key === "label" || key === "description" || key === "url" || key === "targetLabel") && typeof child === "string") fragments.push(child);
      else visit(child);
    }
  }

  visit(value);
  return fragments.join(" ").replace(/\s+/g, " ").trim();
}

export function createSearchSnippet(text: string, query: string, radius = 70) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const index = normalized.toLocaleLowerCase("ru").indexOf(query.toLocaleLowerCase("ru"));
  if (index < 0) return normalized.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(normalized.length, index + query.length + radius);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}
