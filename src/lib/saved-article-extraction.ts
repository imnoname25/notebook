import { createHash } from "node:crypto";
import { defaultTreeAdapter, Parser, parseFragment, type DefaultTreeAdapterTypes, type TreeAdapter } from "parse5";
import {
  MAX_ARTICLE_BLOCKS, MAX_ARTICLE_IMAGES, MAX_ARTICLE_INLINE, MAX_ARTICLE_INLINE_TEXT, MAX_ARTICLE_LIST_DEPTH,
  savedArticleBlocks, type SavedArticleBlocks,
} from "./saved-article-format";
import { fetchSavedMetadataResource, metadataUrl, SavedMetadataError } from "./saved-metadata-network";
import { savedHtmlAccessGate, savedHtmlElementHidden as hidden, savedHtmlLoginUrl } from "./saved-html-access";
import { classifySavedLink } from "./saved-link";

export const MAX_ARTICLE_HTML_BYTES = 512 * 1024;
export const MAX_ARTICLE_DOM_NODES = 12_000;
export const MAX_ARTICLE_DOM_DEPTH = 64;
const PARSE_BUDGET_MS = 750;

type Element = DefaultTreeAdapterTypes.Element;
type Child = DefaultTreeAdapterTypes.ChildNode;
type Parent = DefaultTreeAdapterTypes.ParentNode;
type Block = SavedArticleBlocks[number];
type Inline = Exclude<Block, { type: "image" }>["content"][number];
export type ArticleImageCandidate = { key: string; sourceUrl: string };
export type ArticleExtraction =
  | { status: "ready"; blocks: SavedArticleBlocks; imageCandidates?: ArticleImageCandidate[] }
  | { status: "fallback"; reason: "access" | "empty" | "limits" };

class ArticleLimit extends Error {}
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const blocked = new Set(["aside", "nav", "footer", "script", "style", "template", "noscript", "form", "input",
  "button", "select", "textarea", "iframe", "object", "embed", "svg", "math", "canvas", "dialog", "img", "video", "audio"]);
const roles = new Set(["navigation", "complementary", "contentinfo", "search", "dialog"]);
const paragraphs = new Set(["p", "blockquote", "li"]);
const candidates = new Set(["article", "main", "section", "div", "body"]);
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value;
const elements = (node: Parent) => node.childNodes.filter((child): child is Element => "tagName" in child);
const clean = (text: string) => text.replace(/[\s\u0000-\u001f\u007f]+/gu, " ");

function charsetDecoder(label: string | undefined, inDocument = false) {
  if (!label) return undefined;
  try {
    const decoder = new TextDecoder(label);
    return inDocument && decoder.encoding.startsWith("utf-16") ? new TextDecoder("utf-8") : decoder;
  } catch { return undefined; }
}

function decodeHtml(body: Buffer, contentType: string) {
  if (body[0] === 0xff && body[1] === 0xfe) return new TextDecoder("utf-16le").decode(body);
  if (body[0] === 0xfe && body[1] === 0xff) return new TextDecoder("utf-16be").decode(body);
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return new TextDecoder().decode(body);
  const charset = (value: string) => value.match(/\bcharset\s*=\s*["']?([\w-]+)/iu)?.[1];
  const header = charsetDecoder(charset(contentType));
  if (header) return header.decode(body);
  const prefix = parseFragment(body.subarray(0, 1024).toString("latin1"));
  for (const meta of elements(prefix).filter(element => element.tagName === "meta")) {
    const label = attr(meta, "charset") ?? (attr(meta, "http-equiv")?.toLowerCase() === "content-type"
      ? charset(attr(meta, "content") ?? "") : undefined);
    const decoder = charsetDecoder(label, true);
    if (decoder) return decoder.decode(body);
  }
  return new TextDecoder().decode(body);
}

function parseBounded(html: string, checkTime: () => void) {
  let nodes = 1;
  let stackDepth = 0;
  const count = () => {
    checkTime();
    nodes++;
    if (nodes > MAX_ARTICLE_DOM_NODES) throw new ArticleLimit();
  };
  const adapter: TreeAdapter<DefaultTreeAdapterTypes.DefaultTreeAdapterMap> = {
    ...defaultTreeAdapter,
    createElement(...args) { count(); return defaultTreeAdapter.createElement(...args); },
    createCommentNode(...args) { count(); return defaultTreeAdapter.createCommentNode(...args); },
    createDocumentFragment() { count(); return defaultTreeAdapter.createDocumentFragment(); },
    insertText(...args) { count(); defaultTreeAdapter.insertText(...args); },
    insertTextBefore(...args) { count(); defaultTreeAdapter.insertTextBefore(...args); },
    onItemPush() { if (++stackDepth > MAX_ARTICLE_DOM_DEPTH) throw new ArticleLimit(); },
    onItemPop() { stackDepth--; },
  };
  // parse5 is pinned. Feed its tokenizer in chunks so long tokens also hit the time budget.
  const parser = new Parser({ treeAdapter: adapter });
  for (let start = 0; start < html.length; start += 4096) {
    checkTime();
    parser.tokenizer.write(html.slice(start, start + 4096), false);
  }
  parser.tokenizer.write("", true);
  return parser.document;
}

function ignored(node: Element) {
  return node.namespaceURI !== htmlNamespace || blocked.has(node.tagName)
    || roles.has(attr(node, "role") ?? "") || hidden(node) || ancillary(node)
    || (node.tagName === "details" && attr(node, "open") === undefined);
}

function safeLink(value: string | undefined, url: URL) {
  if (!value?.trim() || value.length > 2048) return undefined;
  try {
    const target = new URL(value, url);
    metadataUrl(target.href);
    const link = target.href;
    return link.length <= 2048 ? link : undefined;
  } catch { return undefined; }
}

function ancillary(node: Element) {
  return /(?:^|[\s._:-])(?:ads?|advert(?:ising|isement)?|sponsored|tracking|tracker|pixel|beacon|avatars?|logos?|sidebar|comments|recommend(?:ed|ations?)|related[-_](?:articles|posts|stories|items|content)|social[-_](?:share|links)|author[-_](?:bio|card|profile))(?:$|[\s._:-])/iu
    .test([attr(node, "class"), attr(node, "id")].filter(Boolean).join(" "));
}

function imageCandidate(node: Element, base: URL) {
  if (node.namespaceURI !== htmlNamespace || hidden(node) || ancillary(node)
    || attr(node, "onerror") !== undefined || attr(node, "onload") !== undefined
    || [attr(node, "width"), attr(node, "height")].some(value => value && /^\d+$/u.test(value) && Number(value) < 32)) return null;
  for (const name of ["data-src", "src"]) {
    const value = attr(node, name);
    if (!value?.trim() || value.length > 2048) continue;
    try {
      const url = metadataUrl(value, base);
      if (url.href.length > 2048 || /(?:^|[/.?_-])(?:tracking|tracker|pixel|beacon)(?:[/.?_-]|$)/iu.test(url.pathname)) continue;
      const key = createHash("sha256").update(url.href).digest("hex");
      return { key, sourceUrl: url.href, alt: clean(attr(node, "alt") ?? "").trim().slice(0, 300) };
    } catch { continue; }
  }
  return null;
}

function emitInline(parent: Element, url: URL, checkTime: () => void,
  text: (parts: Inline[]) => void, image: (node: Element, flush: () => void) => void) {
  let parts: Inline[] = [];
  function append(text: string, href?: string) {
    const value = clean(text);
    if (!value) return;
    const previous = parts.at(-1);
    if (previous && (previous.type === "link" ? previous.href : undefined) === href) {
      previous.text += value;
    } else {
      if (parts.length >= MAX_ARTICLE_INLINE) throw new ArticleLimit();
      parts.push(href ? { type: "link", text: value, href } : { type: "text", text: value });
    }
    if (parts.at(-1)!.text.length > MAX_ARTICLE_INLINE_TEXT) throw new ArticleLimit();
  }
  function flush() {
    while (parts.length) {
      const first = parts[0];
      first.text = first.text.trimStart();
      if (first.text) break;
      parts.shift();
    }
    while (parts.length) {
      const last = parts.at(-1)!;
      last.text = last.text.trimEnd();
      if (last.text) break;
      parts.pop();
    }
    if (parts.length) text(parts);
    parts = [];
  }
  function visit(node: Child, href?: string) {
    checkTime();
    if ("value" in node) append(node.value, href);
    if (!("tagName" in node)) return;
    if (node.tagName === "img") { image(node, flush); return; }
    if (ignored(node) || node.tagName === "ol" || node.tagName === "ul") return;
    const wrapsText = node.tagName === "p" || node.tagName === "div";
    if (node.tagName === "br" || wrapsText) append(" ", href);
    const childLink = node.tagName === "a" ? safeLink(attr(node, "href"), url) : href;
    for (const child of node.childNodes) visit(child, childLink);
    if (wrapsText) append(" ", href);
  }
  for (const child of parent.childNodes) visit(child);
  flush();
}

function selectMain(body: Element, checkTime: () => void) {
  let best: Element | undefined;
  let bestScore = 0;
  function measure(node: Element): { length: number; linked: number; prose: number; semanticChild: boolean } {
    checkTime();
    let length = 0;
    let linked = 0;
    let prose = 0;
    let semanticChild = false;
    if (ignored(node)) return { length, linked, prose, semanticChild };
    for (const child of node.childNodes) {
      if ("value" in child) length += clean(child.value).trim().length;
      if (!("tagName" in child)) continue;
      const score = measure(child);
      length += score.length;
      linked += score.linked;
      prose += score.prose;
      semanticChild ||= score.semanticChild || (child.tagName === "article" && score.prose >= 80);
    }
    if (node.tagName === "a") linked = length;
    if (paragraphs.has(node.tagName)) prose = Math.max(prose, length - linked);
    const semantic = node.tagName === "article" || attr(node, "itemprop") === "articleBody";
    if (candidates.has(node.tagName) && prose >= 80 && linked * 2 < length && (!semanticChild || semantic)) {
      const score = prose * (semantic ? 4 : node.tagName === "main" || attr(node, "role") === "main" ? 2 : 1);
      if (score > bestScore) { bestScore = score; best = node; }
    }
    return { length, linked, prose, semanticChild };
  }
  measure(body);
  return best;
}

export function extractSavedArticle(html: string, url: URL, signal?: AbortSignal): ArticleExtraction {
  const deadline = performance.now() + PARSE_BUDGET_MS;
  const checkTime = () => {
    signal?.throwIfAborted();
    if (performance.now() > deadline) throw new ArticleLimit();
  };
  try {
    if (html.length > MAX_ARTICLE_HTML_BYTES) throw new ArticleLimit();
    const document = parseBounded(html, checkTime);
    const root = elements(document).find(node => node.tagName === "html");
    const body = root && elements(root).find(node => node.tagName === "body");
    if (!body) return { status: "fallback", reason: "empty" };
    if (savedHtmlAccessGate(document, checkTime)) return { status: "fallback", reason: "access" };
    const main = selectMain(body, checkTime);
    if (!main) return { status: "fallback", reason: "empty" };
    const blocks: SavedArticleBlocks = [];
    const imageCandidates = new Map<string, ArticleImageCandidate>();
    let imageCount = 0;
    function emitImage(node: Element, flush?: () => void) {
      if (imageCount >= MAX_ARTICLE_IMAGES || blocks.length >= MAX_ARTICLE_BLOCKS) return;
      const image = imageCandidate(node, url);
      if (!image) return;
      flush?.();
      if (blocks.length >= MAX_ARTICLE_BLOCKS) return;
      imageCandidates.set(image.key, { key: image.key, sourceUrl: image.sourceUrl });
      blocks.push({ type: "image", key: image.key, alt: image.alt });
      imageCount++;
    }
    function emit(node: Element, depth = 0, ordered = false) {
      checkTime();
      if (node.tagName === "img") { emitImage(node); return; }
      if (ignored(node)) return;
      const heading = /^h([1-6])$/u.exec(node.tagName);
      if (heading || paragraphs.has(node.tagName) || node.tagName === "figcaption") {
        emitInline(node, url, checkTime, content => {
          if (blocks.length >= MAX_ARTICLE_BLOCKS || depth > MAX_ARTICLE_LIST_DEPTH) throw new ArticleLimit();
          if (heading) blocks.push({ type: "heading", level: Number(heading[1]), content });
          else if (node.tagName === "li") blocks.push({ type: "listItem", ordered, depth, content });
          else blocks.push({ type: node.tagName === "blockquote" ? "quote" : "paragraph", content });
        }, emitImage);
        if (node.tagName !== "li") return;
        for (const child of elements(node).filter(element => element.tagName === "ul" || element.tagName === "ol"))
          emit(child, depth + 1);
        return;
      }
      for (const child of elements(node)) emit(child, depth, node.tagName === "ol");
    }
    emit(main);
    if (!blocks.some(block => block.type === "paragraph" || block.type === "quote" || block.type === "listItem")) {
      return { status: "fallback", reason: "empty" };
    }
    const parsed = savedArticleBlocks.safeParse(blocks);
    checkTime();
    return parsed.success ? { status: "ready", blocks: parsed.data,
      ...(imageCandidates.size ? { imageCandidates: [...imageCandidates.values()] } : {}),
    } : { status: "fallback", reason: "limits" };
  } catch (error) {
    if (error instanceof ArticleLimit) return { status: "fallback", reason: "limits" };
    throw error;
  }
}

export async function fetchSavedArticle(url: string, signal: AbortSignal, fetchResource = fetchSavedMetadataResource) {
  const resource = await fetchResource(url, {
    signal, maxBytes: MAX_ARTICLE_HTML_BYTES, types: ["text/html", "application/xhtml+xml"], rejectChallenge: true,
    checkUrl(target) {
      if (savedHtmlLoginUrl(target)) throw new SavedMetadataError(false, "challenge");
      if (classifySavedLink(target).kind !== "article") throw new SavedMetadataError(false, "redirect");
    },
  });
  return extractSavedArticle(decodeHtml(resource.body, resource.contentType), resource.url, signal);
}
