export type DocumentState = { title: string; content: unknown[] };
export function canonicalJson(value: unknown): string {
  const normalize = (node: unknown): unknown => Array.isArray(node) ? node.map(normalize) : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : node;
  return JSON.stringify(normalize(value));
}
export type BlockPath = number[];
export function localIdentity() { const bytes = crypto.getRandomValues(new Uint8Array(16));return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
export function blockAtPath(content: unknown[], path: BlockPath): Record<string, unknown> | null {
  let list = content;let result: Record<string, unknown> | null = null;
  for (const index of path) { const item = list[index];if (!item || typeof item !== "object" || Array.isArray(item)) return null;result = item as Record<string, unknown>;list = Array.isArray(result.children) ? result.children : []; }
  return result;
}
export function cloneBlockWithIds(block: Record<string, unknown>, used = new Set<string>(), rootId?: string): Record<string, unknown> {
  const copy = structuredClone(block);
  const visit = (node: Record<string, unknown>, id?: string) => {
    const proposed = id ?? (typeof node.id === "string" ? node.id : "");
    node.id = proposed && !used.has(proposed) ? proposed : localIdentity();used.add(node.id as string);
    if (Array.isArray(node.children)) for (const child of node.children) if (child && typeof child === "object" && !Array.isArray(child)) visit(child);
  };
  visit(copy, rootId);return copy;
}
