import { canonicalJson, type BlockPath } from "./document-state";
export type DiffRow = { key: string; oldPath: BlockPath | null; newPath: BlockPath | null; change: "added" | "removed" | "changed" | "moved" | "unchanged"; moved: boolean };
type Flat = { block: Record<string, unknown>; path: number[]; parent: number; order: number; own: string; semantic: string };
function flatten(content: unknown[]): Flat[] {
  const result: Flat[] = [];
  const semantic = (block: Record<string, unknown>, depth = 0): unknown => { if (depth > 64) throw new Error("Слишком глубокая структура документа");const { id: _id, children, ...own } = block;void _id;return { ...own, ...(Array.isArray(children) ? { children: children.map(child => child && typeof child === "object" && !Array.isArray(child) ? semantic(child, depth + 1) : child) } : {}) }; };
  const visit = (list: unknown[], prefix: number[], parent: number) => list.forEach((raw, index) => {
    if (prefix.length > 64 || result.length > 20_000) throw new Error("Документ слишком велик для безопасного сравнения");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const block = raw as Record<string, unknown>;const { id: _id, children, ...own } = block;void _id;
    const at = result.length;const path = [...prefix, index];result.push({ block, path, parent, order: index, own: canonicalJson(own), semantic: canonicalJson(semantic(block)) });
    if (Array.isArray(children)) visit(children, path, at);
  });visit(content, [], -1);return result;
}
function uniqueKeys(nodes: Flat[], key: (node: Flat) => string | undefined) {
  const map = new Map<string, number[]>();nodes.forEach((node, index) => { const value = key(node);if (value) { const list = map.get(value) ?? [];list.push(index);map.set(value, list); } });return map;
}
/** Conservative matching: unique IDs, then unique exact semantic subtrees. No fuzzy guesses. */
export function compareBlocks(before: unknown[], after: unknown[]): DiffRow[] {
  const old = flatten(before), next = flatten(after);const matched = new Map<number, number>();const reverse = new Map<number, number>();
  for (const key of [(node: Flat) => typeof node.block.id === "string" ? node.block.id : undefined, (node: Flat) => node.semantic]) {
    const a = uniqueKeys(old, key), b = uniqueKeys(next, key);
    for (const [value, indices] of a) { const other = b.get(value);if (indices.length !== 1 || other?.length !== 1) continue;const left = indices[0]!, right = other[0]!;if (!matched.has(left) && !reverse.has(right)) { matched.set(left, right);reverse.set(right, left); } }
  }
  // LIS per matched parent avoids reporting every following row as moved after insertion.
  const stable = new Set<number>();const groups = new Map<number, number[]>();
  for (let index = 0; index < next.length; index++) if (reverse.has(index)) { const parent = next[index]!.parent;const list = groups.get(parent) ?? [];list.push(index);groups.set(parent, list); }
  for (const [parent, indices] of groups) {
    const candidates = indices.filter(index => { const prior = old[reverse.get(index)!]!.parent;return prior === -1 ? parent === -1 : matched.get(prior) === parent; });
    const tails: number[] = [], previous: number[] = [];
    candidates.forEach((index, position) => { const value = old[reverse.get(index)!]!.order;let low = 0, high = tails.length;while (low < high) { const middle = (low + high) >>> 1;if (old[reverse.get(candidates[tails[middle]!]!)!]!.order < value) low = middle + 1;else high = middle; }previous[position] = low ? tails[low - 1]! : -1;tails[low] = position; });
    let at = tails.at(-1) ?? -1;while (at >= 0) { stable.add(candidates[at]!);at = previous[at]!; }
  }
  const rows: DiffRow[] = next.map((node, index) => {
    const prior = reverse.get(index);if (prior === undefined) return { key: `new:${index}`, oldPath: null, newPath: node.path, change: "added", moved: false };
    const moved = !stable.has(index);const changed = old[prior]!.own !== node.own;
    return { key: `old:${prior}`, oldPath: old[prior]!.path, newPath: node.path, change: changed ? "changed" : moved ? "moved" : "unchanged", moved };
  });
  // Deleted rows retain their historical relative order and are inserted before their next surviving neighbour.
  const removed = new Map<string, DiffRow[]>();let anchor = "end";
  for (let index = old.length - 1; index >= 0; index--) {
    const counterpart = matched.get(index);
    if (counterpart !== undefined) anchor = `old:${index}`;
    else { const list = removed.get(anchor) ?? [];list.push({ key: `old:${index}`, oldPath: old[index]!.path, newPath: null, change: "removed", moved: false });removed.set(anchor, list); }
  }
  return [...rows.flatMap(row => [...(removed.get(row.key) ?? []).reverse(), row]), ...(removed.get("end") ?? []).reverse()];
}
export function textFragment(before: Record<string, unknown>, after: Record<string, unknown>) {
  if (before.type !== after.type || canonicalJson(before.props) !== canonicalJson(after.props) || !Array.isArray(before.content) || !Array.isArray(after.content) || before.content.length !== 1 || after.content.length !== 1) return null;
  const a = before.content[0], b = after.content[0];
  if (!a || !b || a.type !== "text" || b.type !== "text" || typeof a.text !== "string" || typeof b.text !== "string" || canonicalJson(a.styles) !== canonicalJson(b.styles)) return null;
  const segments = (value: string) => Array.from(new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(value), part => part.segment);
  const old = segments(a.text), next = segments(b.text);let prefix = 0, suffix = 0;
  while (prefix < Math.min(old.length, next.length) && old[prefix] === next[prefix]) prefix++;
  while (suffix < Math.min(old.length, next.length) - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  if (prefix === old.length && prefix === next.length) return null;
  return { prefix: next.slice(0, prefix).join(""), removed: old.slice(prefix, old.length - suffix).join(""), added: next.slice(prefix, next.length - suffix).join(""), suffix: suffix ? next.slice(-suffix).join("") : "" };
}
