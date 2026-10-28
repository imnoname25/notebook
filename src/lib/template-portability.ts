import { rewriteInternalPageReferences } from "./portable-content";

const portable = "notebook-page://";
const internalHref = /^\/pages\/([A-Za-z0-9_-]+)([?#].*)?$/;
const unavailable = (id: string) => `missing-${id.replace(/^(?:missing-)+/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160) || "target"}`;

/** Only v5 portable keys can resolve. Legacy database IDs are never looked up or guessed. */
export function restoreTemplateReferences(content: unknown, pageIds: ReadonlyMap<string, string>, version: number) {
  let unavailableLinks = 0;
  const target = (value: string) => {
    const key = value.startsWith(portable) ? value.slice(portable.length) : value;
    const resolved = version >= 5 && value.startsWith(portable) && !key.startsWith("missing-") ? pageIds.get(key) : undefined;
    if (resolved) return resolved;
    unavailableLinks++;
    return unavailable(key);
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    if (node.type === "pageLink" && node.props && typeof node.props === "object" && "pageId" in node.props && typeof node.props.pageId === "string") {
      result.props = { ...node.props, pageId: target(node.props.pageId) };
    } else if (node.type === "link" && typeof node.href === "string") {
      const match = internalHref.exec(node.href);
      if (node.href.startsWith(portable)) {
        const [, reference, suffix = ""] = /^(notebook-page:\/\/[^?#]*)([?#].*)?$/.exec(node.href) ?? [];
        result.href = `/pages/${target(reference ?? node.href)}${suffix}`;
      } else if (match) result.href = `/pages/${target(match[1]!)}${match[2] ?? ""}`;
    }
    return result;
  };
  return { content: visit(content), unavailableLinks };
}

export function templateReferenceWarnings(contents: unknown[], pageIds: ReadonlyMap<string, string>, version: number): string[] {
  const count = contents.reduce<number>((total, content) => total + restoreTemplateReferences(content, pageIds, version).unavailableLinks, 0);
  return count ? [`В шаблонах ${count} внутренних ссылок останутся недоступными: ${version < 5 ? "старый формат не содержит надёжного сопоставления целей" : "цели отсутствуют в резервной копии"}. Текст и alias сохранены; сопоставление по названию не выполнялось.`] : [];
}

export function portableTemplateReferences(content: unknown, pageIds: ReadonlyMap<string, string>) {
  return rewriteInternalPageReferences(content, pageIds, "export");
}
