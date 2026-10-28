import { linkedPageId } from "./page-links";
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
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") { const id = linkedPageId(node as Record<string, unknown>);if (id) ids.add(id);Object.values(node).forEach(visit); }
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
  if (value && typeof value === "object" && !Array.isArray(value) && "type" in value && value.type === "pageLink" && "props" in value && value.props && typeof value.props === "object" && "pageId" in value.props && typeof value.props.pageId === "string") {
    const id = value.props.pageId;
    return { ...value, props: { ...value.props, pageId: direction === "export" ? `notebook-page://${mapping.get(id) ?? (id.startsWith("missing-") ? id : `missing-${id}`)}` : mapping.get(id.replace(/^notebook-page:\/\//, "")) ?? `missing-${id.replace(/^notebook-page:\/\//, "").replace(/^missing-/, "")}` } };
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "type" in value && value.type === "link" && "href" in value && typeof value.href === "string") {
    const href = value.href;
    return { ...value, href: direction === "export" ? href.replace(/^\/pages\/([A-Za-z0-9_-]+)([?#].*)?$/, (_original, id: string, suffix: string = "") => `notebook-page://${mapping.get(id) ?? (id.startsWith("missing-") ? id : `missing-${id}`)}${suffix}`) : href.replace(/^notebook-page:\/\/([A-Za-z0-9_-]+)([?#].*)?$/, (original, key: string, suffix: string = "") => mapping.has(key) ? `/pages/${mapping.get(key)}${suffix}` : original),
      ...("content" in value ? { content: rewriteInternalPageReferences(value.content, mapping, direction) } : {}) };
  }
  if (Array.isArray(value)) return value.map((child) => rewriteInternalPageReferences(child, mapping, direction));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteInternalPageReferences(child, mapping, direction)]));
  return value;
}
