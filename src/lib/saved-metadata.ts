import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import { savedHtmlAccessGate, savedHtmlAccessLabel, savedHtmlLoginUrl } from "./saved-html-access";
import { classifySavedLink } from "./saved-link";
import { fetchSavedMetadataResource, metadataUrl, SavedMetadataError } from "./saved-metadata-network";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
const children = (node: Parent): Element[] => node.childNodes.filter((child): child is Element => "tagName" in child);
const attr = (node: Element, key: string) => node.attrs.find(attribute => attribute.name === key)?.value;
const clean = (value: string | undefined, limit: number) => value?.replace(/[\u0000-\u0020\u007f]+/gu, " ")
  .trim().slice(0, limit).replace(/[\ud800-\udbff]$/u, "") || null;
const htmlTypes = ["text/html", "application/xhtml+xml"];
const youtubeEndpoint = "https://www.youtube.com/oembed";
const threadsEndpoint = "https://graph.threads.com/oembed";
const oEmbedSchema = z.object({
  version: z.union([z.literal("1.0"), z.literal(1)]),
  type: z.enum(["video", "rich"]),
  title: z.string().optional(),
  author_name: z.string().optional(),
  thumbnail_url: z.string().optional(),
});

function previewUrl(value: string | undefined, base?: URL, httpsOnly = false) {
  if (!value || value.length > 2048) return null;
  try {
    const image = metadataUrl(value, base);
    return (!httpsOnly || image.protocol === "https:") && image.href.length <= 2048 ? image.href : null;
  } catch { return null; }
}

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

export function extractSavedMetadata(html: string, url: URL, publicPreviewOnly = false) {
  const document = parse(html);
  if (savedHtmlAccessGate(document)) throw new SavedMetadataError(false, "challenge");
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
    metadataImageUrl = previewUrl(value, url, httpsOnly);
    if (metadataImageUrl) break;
  }
  const metadataTitle = field("og:title", 300) ?? field("twitter:title", 300)
    ?? (publicPreviewOnly ? null : articleHeading(root && children(root).find(node => node.tagName === "body")) ?? clean(title, 300));
  if (metadataTitle && savedHtmlAccessLabel(metadataTitle)) throw new SavedMetadataError(false, "challenge");
  return {
    metadataTitle,
    metadataDescription: field("og:description", 1000) ?? (publicPreviewOnly ? null : field("description", 1000))
      ?? field("twitter:description", 1000),
    metadataSiteName: field("og:site_name", 160) ?? (publicPreviewOnly ? null : field("application-name", 160)) ?? url.hostname.slice(0, 253),
    metadataImageUrl,
  };
}

async function fetchOEmbed(endpoint: string, source: string, signal: AbortSignal, fetchResource: typeof fetchSavedMetadataResource) {
  const url = new URL(endpoint);
  url.searchParams.set("url", source);
  url.searchParams.set("format", "json");
  const { body } = await fetchResource(url.href, {
    signal, maxBytes: 64 * 1024, types: ["application/json"], rejectChallenge: true,
    checkUrl(target) {
      if (target.href !== url.href) throw new SavedMetadataError(false, "redirect");
    },
  });
  try {
    return oEmbedSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  } catch { throw new SavedMetadataError(false, "response"); }
}

export async function fetchSavedMetadata(value: string, signal: AbortSignal, fetchResource = fetchSavedMetadataResource) {
  const url = metadataUrl(value);
  const link = classifySavedLink(url);
  if (link.kind === "video" && link.provider === "youtube") {
    if (!link.videoId) return { metadataTitle: null, metadataDescription: null, metadataSiteName: "YouTube", metadataImageUrl: null };
    const data = await fetchOEmbed(youtubeEndpoint, `https://www.youtube.com/watch?v=${link.videoId}`, signal, fetchResource);
    if (data.type !== "video") throw new SavedMetadataError(false, "response");
    const author = clean(data.author_name, 150);
    return {
      metadataTitle: clean(data.title, 300), metadataDescription: null,
      metadataSiteName: author ? `YouTube · ${author}` : "YouTube",
      metadataImageUrl: previewUrl(data.thumbnail_url, undefined, true),
    };
  }

  const resource = await fetchResource(value, {
    signal, maxBytes: 512 * 1024, types: htmlTypes, rejectChallenge: true,
    checkUrl(target) {
      if (savedHtmlLoginUrl(target)) throw new SavedMetadataError(false, "challenge");
      if (link.kind === "article") return;
      const next = classifySavedLink(target);
      if (next.kind === "article" || next.provider !== link.provider) throw new SavedMetadataError(false, "redirect");
    },
  });
  const charset = resource.contentType.match(/charset\s*=\s*["']?([\w-]+)/iu)?.[1];
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  const metadata = extractSavedMetadata(decoder.decode(resource.body), resource.url, link.kind !== "article");
  if (link.kind === "social" && !metadata.metadataTitle && !metadata.metadataDescription && !metadata.metadataImageUrl) {
    const finalLink = classifySavedLink(resource.url);
    if (finalLink.kind === "social" && finalLink.postPath) {
      // Meta limits oEmbed to front-end display. Check the public representation without persisting its payload.
      const data = await fetchOEmbed(threadsEndpoint, new URL(finalLink.postPath, "https://www.threads.com").href, signal, fetchResource);
      if (data.type !== "rich") throw new SavedMetadataError(false, "response");
    }
  }
  return metadata;
}
