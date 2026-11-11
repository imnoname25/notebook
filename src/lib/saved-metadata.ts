import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { fetchSavedMetadataResource, metadataUrl } from "./saved-metadata-network";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
const children = (node: Parent): Element[] => node.childNodes.filter((child): child is Element => "tagName" in child);
const attr = (node: Element, key: string) => node.attrs.find(attribute => attribute.name === key)?.value;
const clean = (value: string | undefined, limit: number) => value?.replace(/[\u0000-\u0020\u007f]+/gu, " ")
  .trim().slice(0, limit).replace(/[\ud800-\udbff]$/u, "") || null;

export function extractSavedMetadata(html: string, url: URL) {
  const document = parse(html);
  const root = children(document).find(node => node.tagName === "html");
  const head = root && children(root).find(node => node.tagName === "head");
  const elements = head ? children(head) : [];
  const values = new Map<string, string>();
  for (const element of elements) {
    if (element.tagName !== "meta") continue;
    const name = (attr(element, "property") ?? attr(element, "name"))?.trim().toLowerCase();
    const value = attr(element, "content");
    if (name && value?.trim() && !values.has(name)) values.set(name, value);
  }
  const title = elements.find(node => node.tagName === "title")?.childNodes
    .flatMap(node => "value" in node ? [node.value] : []).join("");
  const imageLink = elements.find(node => node.tagName === "link" && attr(node, "rel")?.toLowerCase().split(/\s+/u).includes("image_src"));
  const candidates = [values.get("og:image:secure_url"), values.get("og:image"), values.get("og:image:url"), values.get("twitter:image"), imageLink && attr(imageLink, "href")];
  let metadataImageUrl: string | null = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.length > 2048) continue;
    try {
      const image = metadataUrl(candidate, url);
      if (image.href.length > 2048) continue;
      metadataImageUrl = image.href;
      break;
    } catch {
      continue;
    }
  }
  return {
    metadataTitle: clean(values.get("og:title"), 300) ?? clean(title, 300),
    metadataDescription: clean(values.get("og:description"), 1000) ?? clean(values.get("description"), 1000),
    metadataSiteName: clean(values.get("og:site_name"), 160) ?? clean(values.get("application-name"), 160) ?? url.hostname,
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
