import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { fetchSavedMetadataResource, metadataUrl } from "./saved-metadata-network";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
const children = (node: Parent): Element[] => node.childNodes.filter((child): child is Element => "tagName" in child);
const attr = (node: Element, key: string) => node.attrs.find(attribute => attribute.name === key)?.value;
const clean = (value: string | undefined, limit: number) => value?.replace(/[\u0000-\u0020\u007f]+/gu, " ")
  .trim().slice(0, limit).replace(/[\ud800-\udbff]$/u, "") || null;

function articleHeading(body: Element | undefined) {
  if (!body) return null;
  const pending = [{ node: body, inArticle: false }];
  while (pending.length) {
    const { node, inArticle } = pending.pop()!;
    if (["nav", "aside", "footer", "template"].includes(node.tagName) || attr(node, "hidden") !== undefined) continue;
    if (inArticle && node.tagName === "h1") {
      const text: string[] = [];
      const descendants = [...node.childNodes].reverse();
      while (descendants.length) {
        const child = descendants.pop()!;
        if (child.nodeName === "#text" && "value" in child) text.push(child.value);
        else if ("childNodes" in child && !["script", "style", "template"].includes(child.nodeName)) {
          for (const nested of [...child.childNodes].reverse()) descendants.push(nested);
        }
      }
      const title = clean(text.join(""), 300);
      if (title) return title;
    }
    const inside = inArticle || ["main", "article"].includes(node.tagName);
    for (const child of children(node).reverse()) pending.push({ node: child, inArticle: inside });
  }
  return null;
}

export function extractSavedMetadata(html: string, url: URL) {
  const document = parse(html);
  const root = children(document).find(node => node.tagName === "html");
  const head = root && children(root).find(node => node.tagName === "head");
  const elements = head ? children(head) : [];
  const values = new Map<string, string[]>();
  for (const element of elements) {
    if (element.tagName !== "meta") continue;
    const name = (attr(element, "property") ?? attr(element, "name"))?.trim().toLowerCase();
    const value = attr(element, "content");
    if (name && value?.trim()) {
      const existing = values.get(name);
      if (existing) existing.push(value.trim());
      else values.set(name, [value.trim()]);
    }
  }
  const field = (name: string, limit: number) => values.get(name)?.map(value => clean(value, limit)).find(Boolean) ?? null;
  const title = elements.find(node => node.tagName === "title")?.childNodes
    .flatMap(node => "value" in node ? [node.value] : []).join("");
  const imageLink = elements.find(node => node.tagName === "link" && attr(node, "rel")?.toLowerCase().split(/\s+/u).includes("image_src"));
  const candidates = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image"].flatMap(name =>
    (values.get(name) ?? []).map(value => ({ value, httpsOnly: name === "og:image:secure_url" })));
  const imageHref = imageLink && attr(imageLink, "href");
  if (imageHref?.trim()) candidates.push({ value: imageHref.trim(), httpsOnly: false });
  let metadataImageUrl: string | null = null;
  for (const { value, httpsOnly } of candidates) {
    if (value.length > 2048) continue;
    try {
      const image = metadataUrl(value, url);
      if (httpsOnly && image.protocol !== "https:") continue;
      if (image.href.length > 2048) continue;
      metadataImageUrl = image.href;
      break;
    } catch {
      continue;
    }
  }
  return {
    metadataTitle: field("og:title", 300) ?? field("twitter:title", 300)
      ?? articleHeading(root && children(root).find(node => node.tagName === "body")) ?? clean(title, 300),
    metadataDescription: field("og:description", 1000) ?? field("description", 1000) ?? field("twitter:description", 1000),
    metadataSiteName: field("og:site_name", 160) ?? field("application-name", 160) ?? url.hostname,
    metadataImageUrl,
  };
}

export async function fetchSavedMetadata(url: string, signal: AbortSignal) {
  const resource = await fetchSavedMetadataResource(url, { signal, maxBytes: 512 * 1024, types: ["text/html", "application/xhtml+xml"] });
  const charset = resource.contentType.match(/charset\s*=\s*["']?([\w-]+)/iu)?.[1];
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  return extractSavedMetadata(decoder.decode(resource.body), resource.url);
}
