import { expect, it, vi } from "vitest";
import {
  extractSavedArticle, fetchSavedArticle, MAX_ARTICLE_DOM_DEPTH, MAX_ARTICLE_DOM_NODES, MAX_ARTICLE_HTML_BYTES,
} from "./saved-article-extraction";
import { savedArticleBlocks } from "./saved-article-format";
import { fetchSavedMetadataResource } from "./saved-metadata-network";
import { savedArticleRequestFailure } from "./services/saved-article-worker";

const url = new URL("https://example.org/journal/entry");
const paragraph = "This is the text of a complete article. It is long enough to count as prose and includes a few details.";
const article = `<article><h1>Actual headline</h1><p>${paragraph}</p></article>`;
const extract = (html: string) => extractSavedArticle(html, url);

it("extracts semantic blocks without Open Graph and ignores the SEO title", () => {
  const result = extract(`<title>${"Keywords for promotion ".repeat(40)}</title><nav>Navigation</nav>
    <main><article><header><h1>Actual headline</h1></header><p>${paragraph} See
    <a href="../more">another article</a>.</p><h2>Details</h2><ol><li>First<ul><li>Nested</li></ul></li></ol>
    <blockquote><p>A quotation.</p></blockquote></article></main><footer>Footer</footer>`);
  expect(result).toMatchObject({ status: "ready", blocks: [
    { type: "heading", level: 1, content: [{ type: "text", text: "Actual headline" }] },
    { type: "paragraph", content: [
      { type: "text", text: expect.stringContaining(paragraph) },
      { type: "link", href: "https://example.org/more", text: "another article" },
      { type: "text", text: "." },
    ] },
    { type: "heading", level: 2 }, { type: "listItem", ordered: true, depth: 0 },
    { type: "listItem", ordered: false, depth: 1 }, { type: "quote" },
  ] });
});

it("selects prose when semantic article tags are missing", () => {
  expect(extract(`<div class="layout"><div><h1>Story</h1><p>${paragraph}</p></div></div>`))
    .toMatchObject({ status: "ready" });
});

it.each([
  ["empty", "<h1>No article</h1><p>Short.</p>"],
  ["access", `<form><input type="password"></form>${article}`],
  ["access", `<title>Sign in | Example</title><form><input type="email"></form>${article}`],
  ["access", `<div class="g-recaptcha"></div>${article}`],
  ["access", `<div id="paywall"></div>${article}`],
  ["access", `<script type="application/ld+json">{"isAccessibleForFree":false}</script>${article}`],
])("falls back with %s for gated or empty HTML", (reason, html) => {
  expect(extract(html)).toEqual({ status: "fallback", reason });
});

it("discards active markup, hidden content and non-HTTP links", () => {
  const result = extract(`<article><p onclick="boom()">${paragraph}
    <script>badScript</script><iframe>badFrame</iframe><img src="/image" onerror="badImage()">
    <a href="javascript:alert(1)">plain text</a><a href="data:text/html,unsafe">data text</a>
    <span style="display: none">secret</span><span class="hidden">other secret</span></p>
    <form action="/send"><p>form content</p></form></article>`);
  expect(result.status).toBe("ready");
  const serialized = JSON.stringify(result);
  expect(serialized).toContain("plain text");
  expect(serialized).not.toMatch(/javascript:|data:|onclick|badScript|badFrame|badImage|secret|form content|\/image/u);
  expect(savedArticleBlocks.safeParse([{ type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", text: "x" }] }]).success).toBe(false);
  expect(savedArticleBlocks.safeParse([{ type: "paragraph", html: "<img>", content: [{ type: "text", text: "x" }] }]).success).toBe(false);
});

it.each([
  () => "x".repeat(MAX_ARTICLE_HTML_BYTES + 1),
  () => "<div>".repeat(MAX_ARTICLE_DOM_DEPTH + 1),
  () => "<br>".repeat(MAX_ARTICLE_DOM_NODES + 1),
])("bounds HTML, DOM depth and DOM node count", input => {
  expect(extract(input())).toEqual({ status: "fallback", reason: "limits" });
});

it("enforces the parse time budget while building the tree", () => {
  const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(751);
  try { expect(extract(article)).toEqual({ status: "fallback", reason: "limits" }); }
  finally { now.mockRestore(); }
});

it("honors the transport charset and a document charset in its absence", async () => {
  const signal = new AbortController().signal;
  const body = Buffer.from(`<meta charset="windows-1252"><article><p>${paragraph} caf\xe9</p></article>`, "latin1");
  for (const contentType of ["text/html; charset=windows-1252", "text/html"]) {
    const fetchResource = vi.fn(async () => ({ url, body, mimeType: "text/html", contentType }));
    const result = await fetchSavedArticle(url.href, signal, fetchResource);
    expect(JSON.stringify(result)).toContain("café");
    expect(fetchResource).toHaveBeenCalledWith(url.href, expect.objectContaining({ signal, maxBytes: MAX_ARTICLE_HTML_BYTES }));
  }
});

function network(statusCode: number, headers: Record<string, string> = {}, body = Buffer.from(article)) {
  return {
    resolve: vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]),
    request: vi.fn(async () => ({
      statusCode, headers, destroy: vi.fn(),
      async *[Symbol.asyncIterator]() { yield body; },
    })),
  };
}

it.each([401, 403, 429, 500, 503])("classifies HTTP %i with the shared transport", async status => {
  const mocked = network(status);
  const error = await fetchSavedMetadataResource(url.href, { types: ["text/html"], maxBytes: MAX_ARTICLE_HTML_BYTES }, mocked)
    .catch((error: unknown) => error);
  expect(savedArticleRequestFailure(error, 1)).toMatchObject(status < 429
    ? { status: "fallback", reason: "access" } : { status: "retry", reason: "http" });
  if (status >= 429) expect(savedArticleRequestFailure(error, 3)).toEqual({ status: "failed", reason: "http" });
});

it("retries timeouts up to the attempt limit and honors cancellation during DNS", async () => {
  const timeout = new DOMException("timed out", "TimeoutError");
  expect(savedArticleRequestFailure(timeout, 1)).toMatchObject({ status: "retry", reason: "timeout" });
  expect(savedArticleRequestFailure(timeout, 3)).toEqual({ status: "failed", reason: "timeout" });
  const mocked = network(200);
  mocked.resolve.mockImplementationOnce(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = fetchSavedMetadataResource(url.href, { types: ["text/html"], maxBytes: MAX_ARTICLE_HTML_BYTES, signal: controller.signal }, mocked);
  controller.abort(timeout);
  await expect(pending).rejects.toBe(timeout);
  expect(mocked.request).not.toHaveBeenCalled();
});

it("revalidates DNS on redirects and rejects private destinations without connecting", async () => {
  const mocked = network(302, { location: "https://destination.example/article" });
  mocked.resolve.mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  const options = { types: ["text/html"], maxBytes: MAX_ARTICLE_HTML_BYTES };
  await expect(fetchSavedMetadataResource(url.href, options, mocked)).rejects.toMatchObject({ reason: "destination", retryable: false });
  expect(mocked.request).toHaveBeenCalledTimes(1);
});

it("does not retry a challenge marked by the server, even on a temporary HTTP status", async () => {
  const mocked = network(503, { "cf-mitigated": "challenge" });
  const error = await fetchSavedArticle(url.href, new AbortController().signal,
    (url, options) => fetchSavedMetadataResource(url, options, mocked)).catch((error: unknown) => error);
  expect(savedArticleRequestFailure(error, 1)).toEqual({ status: "fallback", reason: "access" });
});

it("rejects unsupported formats and oversized response streams", async () => {
  const options = { types: ["text/html"], maxBytes: MAX_ARTICLE_HTML_BYTES };
  await expect(fetchSavedMetadataResource(url.href, options, network(200, { "content-type": "application/pdf" })))
    .rejects.toMatchObject({ reason: "mime", retryable: false });
  await expect(fetchSavedMetadataResource(url.href, options, network(200, { "content-type": "text/html" }, Buffer.alloc(MAX_ARTICLE_HTML_BYTES + 1))))
    .rejects.toMatchObject({ reason: "size", retryable: false });
});
