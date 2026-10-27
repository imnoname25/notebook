import type { Node as ProseMirrorNode } from "prosemirror-model";
import { isSimplePrefixSearch } from "./search-query";

export type TextMatch = { from: number; to: number };
export type DocumentSearchRequest = { pageId: string; query: string; snippet?: string; request: number };
export const MAX_DOCUMENT_MATCHES = 3000;

/** Literal matching only: no user-provided regular expression is evaluated. */
export function textMatches(text: string, query: string, wordPrefixes = true): TextMatch[] {
  const normalized = query.trim().replace(/\s+/gu, " ");
  if (!normalized) return [];
  const quoted = [...normalized.matchAll(/"([^"]+)"/gu)].map(match => match[1]!);
  const words = normalized.replace(/"[^"]*"/gu, "").split(/\s+/u).filter(word => word && word.toLowerCase() !== "or" && !word.startsWith("-"));
  const terms = [...new Set([...quoted, ...words])].sort((a, b) => b.length - a.length);
  if (!terms.length) return [];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = wordPrefixes && isSimplePrefixSearch(normalized);
  const expression = new RegExp(`${prefix ? "(?<![\\p{L}\\p{N}_])" : ""}(?:${terms.map(escape).join("|")})`, "giu");
  const result: TextMatch[] = [];
  for (const match of text.matchAll(expression)) {
    result.push({ from: match.index, to: match.index + match[0].length });
    if (result.length >= MAX_DOCUMENT_MATCHES) break;
  }
  return result;
}

export function documentMatches(doc: ProseMirrorNode, query: string, snippet = "") {
  const matches: TextMatch[] = [];
  let preferred = 0;let bestScore = -1;
  const context = new Set(snippet.toLocaleLowerCase("ru").match(/[\p{L}\p{N}_]{2,}/gu) ?? []);
  doc.descendants((node, position) => {
    if (matches.length >= MAX_DOCUMENT_MATCHES) return false;
    if (!node.isTextblock) return;
    // One UTF-16 code unit per inline atom/hard break preserves PM positions.
    const text = node.textBetween(0, node.content.size, "", "\uFFFC");
    const found = textMatches(text, query);
    const words = new Set(text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}_]{2,}/gu) ?? []);
    const score = [...context].filter(word => words.has(word)).length;
    if (found.length && score > bestScore) { preferred = matches.length;bestScore = score; }
    for (const match of found) {
      if (matches.length >= MAX_DOCUMENT_MATCHES) break;
      matches.push({ from: position + 1 + match.from, to: position + 1 + match.to });
    }
    return false;
  });
  return { matches, preferred };
}
