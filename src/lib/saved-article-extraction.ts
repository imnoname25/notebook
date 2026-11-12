import { defaultTreeAdapter, Parser, parseFragment, type DefaultTreeAdapterTypes, type TreeAdapter } from "parse5";
import {
  MAX_ARTICLE_BLOCKS, MAX_ARTICLE_INLINE, MAX_ARTICLE_INLINE_TEXT, MAX_ARTICLE_LIST_DEPTH,
  savedArticleBlocks, type SavedArticleBlocks,
} from "./saved-article-format";
import { fetchSavedMetadataResource, metadataUrl } from "./saved-metadata-network";

export const MAX_ARTICLE_HTML_BYTES = 512 * 1024;
export const MAX_ARTICLE_DOM_NODES = 12_000;
export const MAX_ARTICLE_DOM_DEPTH = 64;
const PARSE_BUDGET_MS = 750;

type Element = DefaultTreeAdapterTypes.Element;
type Child = DefaultTreeAdapterTypes.ChildNode;
type Parent = DefaultTreeAdapterTypes.ParentNode;
type Block = SavedArticleBlocks[number];
type Inline = Block["content"][number];
export type ArticleExtraction =
  | { status: "ready"; blocks: SavedArticleBlocks }
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

function hidden(node: Element) {
  return attr(node, "hidden") !== undefined || attr(node, "inert") !== undefined
    || /(?:^|\s)(?:hidden|sr-only|visually-hidden|d-none)(?:\s|$)/iu.test(attr(node, "class") ?? "")
    || attr(node, "aria-hidden")?.toLowerCase() === "true"
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)\s*(?:!important\s*)?(?:;|$)/iu.test(attr(node, "style") ?? "");
}

function ignored(node: Element) {
  return node.namespaceURI !== htmlNamespace || blocked.has(node.tagName)
    || roles.has(attr(node, "role") ?? "") || hidden(node)
    || (node.tagName === "details" && attr(node, "open") === undefined);
}

function accessGate(node: Element) {
  const markers = [attr(node, "id"), attr(node, "class"), attr(node, "src")].filter(Boolean).join(" ");
  if (/(?:^|[^\w])(?:paywall|metered[-_]wall|g-recaptcha|h-captcha|hcaptcha|cf-turnstile|cf-challenge|challenge-form|challenge-platform|captcha)(?:[^\w]|$)/iu.test(markers)) return true;
  if (attr(node, "data-paywall") !== undefined && attr(node, "data-paywall") !== "false") return true;
  if (node.tagName === "title" || node.tagName === "h1") {
    const label = node.childNodes.map(child => "value" in child ? child.value : "").join("").trim();
    if (/^(?:sign[ -]?in|log[ -]?in|authentication required|вход|авторизация)(?:\s*[|–—:]|\s*$)/iu.test(label)
      || /^(?:just a moment[. …]*|verify (?:that )?you (?:are|’re|'re) human|access denied)[.!…]*$/iu.test(label)) return true;
  }
  if (node.tagName === "input" && attr(node, "type")?.toLowerCase() === "password" && !hidden(node)) return true;
  return node.tagName === "script" && attr(node, "type")?.toLowerCase() === "application/ld+json"
    && node.childNodes.some(child => "value" in child && /"isAccessibleForFree"\s*:\s*(?:false|"false")/iu.test(child.value));
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

function inlineContent(parent: Parent, url: URL, checkTime: () => void) {
  const parts: Inline[] = [];
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
  function visit(node: Child, href?: string) {
    checkTime();
    if ("value" in node) append(node.value, href);
    if (!("tagName" in node) || ignored(node) || node.tagName === "ol" || node.tagName === "ul") return;
    if (node.tagName === "br" || node.tagName === "p" || node.tagName === "div") append(" ", href);
    const childLink = node.tagName === "a" ? safeLink(attr(node, "href"), url) : href;
    for (const child of node.childNodes) visit(child, childLink);
    if (node.tagName === "p" || node.tagName === "div") append(" ", href);
  }
  for (const child of parent.childNodes) visit(child);
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
  return parts;
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
    const scan: Array<{ node: Parent; depth: number }> = [{ node: document, depth: 0 }];
    while (scan.length) {
      const { node, depth } = scan.pop()!;
      checkTime();
      if (depth > MAX_ARTICLE_DOM_DEPTH) throw new ArticleLimit();
      if ("tagName" in node && accessGate(node)) return { status: "fallback", reason: "access" };
      for (const child of elements(node)) scan.push({ node: child, depth: depth + 1 });
    }
    const main = selectMain(body, checkTime);
    if (!main) return { status: "fallback", reason: "empty" };
    const blocks: SavedArticleBlocks = [];
    function emit(node: Element, depth = 0, ordered = false) {
      checkTime();
      if (ignored(node)) return;
      const heading = /^h([1-6])$/u.exec(node.tagName);
      if (heading || paragraphs.has(node.tagName)) {
        const content = inlineContent(node, url, checkTime);
        if (content.length) {
          if (blocks.length >= MAX_ARTICLE_BLOCKS || depth > MAX_ARTICLE_LIST_DEPTH) throw new ArticleLimit();
          if (heading) blocks.push({ type: "heading", level: Number(heading[1]), content });
          else if (node.tagName === "li") blocks.push({ type: "listItem", ordered, depth, content });
          else blocks.push({ type: node.tagName === "blockquote" ? "quote" : "paragraph", content });
        }
        if (node.tagName !== "li") return;
        for (const child of elements(node).filter(element => element.tagName === "ul" || element.tagName === "ol"))
          emit(child, depth + 1);
        return;
      }
      for (const child of elements(node)) emit(child, depth, node.tagName === "ol");
    }
    emit(main);
    const parsed = savedArticleBlocks.safeParse(blocks);
    checkTime();
    return parsed.success ? { status: "ready", blocks: parsed.data } : { status: "fallback", reason: "limits" };
  } catch (error) {
    if (error instanceof ArticleLimit) return { status: "fallback", reason: "limits" };
    throw error;
  }
}

export async function fetchSavedArticle(url: string, signal: AbortSignal, fetchResource = fetchSavedMetadataResource) {
  const resource = await fetchResource(url, {
    signal, maxBytes: MAX_ARTICLE_HTML_BYTES, types: ["text/html", "application/xhtml+xml"], rejectChallenge: true,
  });
  return extractSavedArticle(decodeHtml(resource.body, resource.contentType), resource.url, signal);
}
