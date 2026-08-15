const UPLOAD_URL = /\/api\/uploads\/([A-Za-z0-9_-]+)/g;

export function attachmentIdsInContent(value: unknown) {
  const ids = new Set<string>();
  function visit(node: unknown) {
    if (typeof node === "string") { for (const match of node.matchAll(UPLOAD_URL)) if (match[1]) ids.add(match[1]); return; }
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === "object") Object.values(node).forEach(visit);
  }
  visit(value); return ids;
}

export function rewriteAttachmentReferences(value: unknown, mapping: ReadonlyMap<string, string>, direction: "export" | "import"): unknown {
  if (typeof value === "string") {
    if (direction === "export") return value.replace(UPLOAD_URL, (original, id: string) => mapping.has(id) ? `attachment://${mapping.get(id)}` : original);
    return value.replace(/attachment:\/\/([A-Za-z0-9_-]+)/g, (original, key: string) => mapping.has(key) ? `/api/uploads/${mapping.get(key)}` : original);
  }
  if (Array.isArray(value)) return value.map((child) => rewriteAttachmentReferences(child, mapping, direction));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteAttachmentReferences(child, mapping, direction)]));
  return value;
}

export function internalPageIdsInContent(value: unknown) {
  const ids = new Set<string>();
  function visit(node: unknown) {
    if (typeof node === "string") { for (const match of node.matchAll(/\/pages\/([A-Za-z0-9_-]+)/g)) if (match[1]) ids.add(match[1]); }
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  }
  visit(value); return ids;
}

export function portableAttachmentKeysInContent(value: unknown) {
  const keys = new Set<string>();
  function visit(node: unknown) {
    if (typeof node === "string") { for (const match of node.matchAll(/attachment:\/\/([A-Za-z0-9_-]+)/g)) if (match[1]) keys.add(match[1]); }
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  }
  visit(value); return keys;
}

export function rewriteInternalPageReferences(value: unknown, mapping: ReadonlyMap<string, string>, direction: "export" | "import"): unknown {
  if (typeof value === "string") {
    if (direction === "export") return value.replace(/\/pages\/([A-Za-z0-9_-]+)/g, (_original, id: string) => `notebook-page://${mapping.get(id) ?? `missing-${id}`}`);
    return value.replace(/notebook-page:\/\/([A-Za-z0-9_-]+)/g, (original, key: string) => mapping.has(key) ? `/pages/${mapping.get(key)}` : original);
  }
  if (Array.isArray(value)) return value.map((child) => rewriteInternalPageReferences(child, mapping, direction));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteInternalPageReferences(child, mapping, direction)]));
  return value;
}
