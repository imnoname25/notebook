import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSavedArticle } from "./saved-article-extraction";
import { extractSavedMetadata, fetchSavedMetadata } from "./saved-metadata";
import { fetchSavedMetadataResource, metadataTarget, metadataUrl, publicMetadataAddress, savedRequestFailure } from "./saved-metadata-network";

const page = new URL("https://example.com/articles/page");
const publicIp = { address: "93.184.216.34", family: 4 };
const options = { maxBytes: 8, types: ["text/html"] };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/saved-links/${name}`, import.meta.url), "utf8");
const signal = new AbortController().signal;

function response(statusCode: number, headers: Record<string, string>, ...body: string[]) {
  return {
    statusCode, headers, destroy: vi.fn(),
    async *[Symbol.asyncIterator]() { for (const chunk of body) yield Buffer.from(chunk); },
  };
}

function localTransport(...responses: ReturnType<typeof response>[]) {
  const request = vi.fn<NonNullable<Parameters<typeof fetchSavedMetadataResource>[2]>["request"]>();
  for (const reply of responses) request.mockResolvedValueOnce(reply);
  const resolve = vi.fn(async () => [publicIp]);
  const fetchResource: typeof fetchSavedMetadataResource = (url, options) => fetchSavedMetadataResource(url, options, { resolve, request });
  return { fetchResource, resolve, request };
}

const html = (name: string) => response(200, { "content-type": "text/html; charset=utf-8" }, fixture(name));
const json = (body: string) => response(200, { "content-type": "application/json" }, body);

describe("saved link previews", () => {
  it("reads YouTube text and a thumbnail from only the official JSON endpoint", async () => {
    const { fetchResource, request } = localTransport(json(fixture("youtube.json")));
    await expect(fetchSavedMetadata("https://youtu.be/testVideo_1?si=private-share-token#t=10", signal, fetchResource)).resolves.toEqual({
      metadataTitle: "Звук дождя в сосновом лесу", metadataDescription: null,
      metadataSiteName: "YouTube · Тихие маршруты", metadataImageUrl: "https://i.ytimg.com/vi/testVideo_1/hqdefault.jpg",
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [target, address, , accept] = request.mock.calls[0];
    expect(target.origin + target.pathname).toBe("https://www.youtube.com/oembed");
    expect(target.searchParams.get("url")).toBe("https://www.youtube.com/watch?v=testVideo_1");
    expect(address).toEqual(publicIp);
    expect(accept).toBe("application/json");
  });

  it("bounds and validates oEmbed fields and discards an invalid cover", async () => {
    const url = "https://www.youtube.com/watch?v=testVideo_1";
    const invalid = localTransport(json('{"version":"1.0","type":"video","title":[]}'));
    await expect(fetchSavedMetadata(url, signal, invalid.fetchResource)).rejects.toMatchObject({ reason: "response" });
    const valid = localTransport(json(JSON.stringify({ version: 1, type: "video", title: " T\0itle ",
      author_name: "a".repeat(151), thumbnail_url: "https://127.0.0.1/private.jpg", html: "<script>discard me</script>" })));
    await expect(fetchSavedMetadata(url, signal, valid.fetchResource)).resolves.toEqual({
      metadataTitle: "T itle", metadataDescription: null, metadataSiteName: `YouTube · ${"a".repeat(150)}`, metadataImageUrl: null,
    });
    const oversized = localTransport(json(" ".repeat(64 * 1024 + 1)));
    await expect(fetchSavedMetadata(url, signal, oversized.fetchResource)).rejects.toMatchObject({ reason: "size" });
    const wrongOrigin = localTransport(response(302, { location: "https://example.com/oembed" }));
    await expect(fetchSavedMetadata(url, signal, wrongOrigin.fetchResource)).rejects.toMatchObject({ reason: "redirect" });
    expect(wrongOrigin.resolve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["https://vk.com/clip-123_456", "vk-clip.html", "Туман над озером", "VK Клипы", "https://covers.example.test/lake.webp"],
    ["https://www.threads.net/@field.notes/post/Cabc123", "threads.html", "Наблюдения с берега", "Threads", null],
  ])("reads public preview fields for %s", async (url, name, title, siteName, cover) => {
    const { fetchResource, request } = localTransport(html(name));
    await expect(fetchSavedMetadata(url, signal, fetchResource)).resolves.toMatchObject({
      metadataTitle: title, metadataDescription: expect.any(String), metadataSiteName: siteName, metadataImageUrl: cover,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("handles a Threads post with only a public oEmbed representation without using embed HTML", async () => {
    const { fetchResource, request } = localTransport(html("no-preview.html"), json(fixture("threads-oembed.json")));
    await expect(fetchSavedMetadata("https://www.threads.net/@notes/post/Cabc123?xmt=private", signal, fetchResource)).resolves.toEqual({
      metadataTitle: null, metadataDescription: null, metadataSiteName: "www.threads.net", metadataImageUrl: null,
    });
    expect(request).toHaveBeenCalledTimes(2);
    const [endpoint] = request.mock.calls[1];
    expect(endpoint.origin + endpoint.pathname).toBe("https://graph.threads.com/oembed");
    expect(endpoint.searchParams.get("url")).toBe("https://www.threads.com/@notes/post/Cabc123");
    expect(endpoint.searchParams.has("access_token")).toBe(false);
  });

  it("stops at access restrictions and never forwards a gated Threads URL to oEmbed", async () => {
    const url = "https://www.threads.com/@notes/post/Cabc123";
    for (const reply of [html("access.html"), response(503, { "cf-mitigated": "challenge" }),
      response(403, {}), response(302, { location: "/accounts/login/" })]) {
      const { fetchResource, request } = localTransport(reply);
      const error: unknown = await fetchSavedMetadata(url, signal, fetchResource).catch((error: unknown) => error);
      expect(savedRequestFailure(error)).toMatchObject({ reason: "access", retryable: false });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps HTML article text and image extraction on the existing path", async () => {
    const { fetchResource } = localTransport(html("article.html"), html("article.html"), html("no-preview.html"));
    await expect(fetchSavedMetadata(page.href, signal, fetchResource)).resolves.toMatchObject({
      metadataTitle: "Тропа вдоль кедрового ручья", metadataSiteName: "Полевой журнал",
    });
    await expect(fetchSavedArticle(page.href, signal, fetchResource)).resolves.toMatchObject({
      status: "ready", blocks: expect.arrayContaining([{ type: "image", key: expect.any(String), alt: "Туман над кедровым ручьём" }]),
      imageCandidates: [{ key: expect.any(String), sourceUrl: "https://example.com/covers/creek.webp" }],
    });
    await expect(fetchSavedMetadata(page.href, signal, fetchResource)).resolves.toMatchObject({
      metadataTitle: null, metadataDescription: null, metadataImageUrl: null,
    });
  });

  it("keeps public story metadata when the page has an aside sign-in form", () => {
    expect(extractSavedMetadata(fixture("pikabu-story.html"), page).metadataTitle).toBe("Пример публикации");
  });

  it("rejects a VK browser-upgrade page before saving the generic site title", async () => {
    const { fetchResource } = localTransport(html("vk-browser-upgrade.html"));
    await expect(fetchSavedMetadata("https://vk.ru/wall-123_456", signal, fetchResource)).rejects.toMatchObject({ reason: "challenge" });
  });

  it.each([fetchSavedArticle, fetchSavedMetadata])("stops at a sign-in redirect on a public article URL", async fetchContent => {
    const { fetchResource, request } = localTransport(response(302, { location: "/login/" }));
    await expect(fetchContent(page.href, signal, fetchResource)).rejects.toMatchObject({ reason: "challenge" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("stops article extraction before a redirect to a video", async () => {
    const { fetchResource, request } = localTransport(response(302, { location: "https://youtu.be/testVideo_1" }));
    await expect(fetchSavedArticle(page.href, signal, fetchResource)).rejects.toMatchObject({ reason: "redirect" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("saved URL metadata", () => {
  it("prefers Open Graph, decodes HTML entities and resolves the preview against the final URL", () => {
    expect(extractSavedMetadata(`<!doctype html><head>
      <title>Fallback</title><meta name="description" content="Fallback description">
      <meta property="og:title" content="Road &amp; River">
      <meta property="og:description" content="Read &quot;later&quot; &gt; here">
      <meta property="og:site_name" content="Field Notes">
      <meta property="og:image:secure_url" content="https://127.0.0.1/no">
      <meta property="og:image" content="../covers/river.webp">
      <script>throw new Error("inert")</script></head>`, page)).toEqual({
      metadataTitle: "Road & River", metadataDescription: 'Read "later" > here',
      metadataSiteName: "Field Notes", metadataImageUrl: "https://example.com/covers/river.webp",
    });
  });

  it("reads standard HTML fields and discards unusable image URLs", () => {
    expect(extractSavedMetadata(`<title>Пример &mdash; сайт</title><meta content="Описание" name="description">
      <meta name="application-name" content="Журнал"><meta property="og:image" content="data:image/png;base64,ABC">`, page)).toEqual({
      metadataTitle: "Пример — сайт", metadataDescription: "Описание", metadataSiteName: "Журнал", metadataImageUrl: null,
    });
  });

  it("uses a semantic article heading before the SEO title", () => {
    expect(extractSavedMetadata(`<title>${"SEO ".repeat(200)}</title>
      <nav><h1>Меню</h1></nav><main><article><h1>Как выбрать <em>инструмент</em></h1></article></main>`, page))
      .toMatchObject({ metadataTitle: "Как выбрать инструмент" });
    expect(extractSavedMetadata(`<title>${"a".repeat(299)}😀</title>`, page).metadataTitle).toBe("a".repeat(299));
  });

  it("falls back through repeated Open Graph images and handles absent metadata", () => {
    expect(extractSavedMetadata(`<meta property="og:image:secure_url" content="http://example.com/cover.png">
      <meta property="og:image" content="ftp://example.com/cover.png">
      <meta property="og:image" content=" //cdn.example.com/cover.png ">`, page).metadataImageUrl)
      .toBe("https://cdn.example.com/cover.png");
    expect(extractSavedMetadata("<main><p>Text only</p></main>", page)).toEqual({
      metadataTitle: null, metadataDescription: null, metadataSiteName: "example.com", metadataImageUrl: null,
    });
  });
});

describe("saved URL network boundary", () => {
  it.each([
    ["ENOTFOUND", "dns", false], ["EAI_AGAIN", "dns", true], ["CERT_HAS_EXPIRED", "tls", false],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls", false], ["ETIMEDOUT", "timeout", true],
    ["ECONNRESET", "request", true], ["unrecognized", "request", false],
  ])("normalizes %s to %s without copying error details", (code, reason, retryable) => {
    const error = Object.assign(new Error("private path, response and token"), { code });
    expect(savedRequestFailure(error)).toEqual({ reason, retryable });
  });

  it("keeps the timeout reason when the transport emits a socket AbortError", async () => {
    const controller = new AbortController();
    const resolve = async () => [publicIp];
    const request = async () => {
      controller.abort(new DOMException("test deadline", "TimeoutError"));
      throw new DOMException("socket aborted", "AbortError");
    };
    const error: unknown = await fetchSavedMetadataResource(page.href, { ...options, signal: controller.signal }, { resolve, request })
      .catch((error: unknown) => error);
    expect(savedRequestFailure(error)).toEqual({ reason: "timeout", retryable: true });
  });
  it.each([[401, false], [403, false], [429, true], [503, true]])("preserves the HTTP %i failure classification", async (status, retryable) => {
    const reply = response(status, { "content-type": "text/html" }, "<title>Error</title>");
    const resolve = async () => [publicIp];
    const request = async () => reply;
    await expect(fetchSavedMetadataResource(page.href, options, { resolve, request }))
      .rejects.toMatchObject({ reason: "http", httpStatus: status, retryable });
    expect(reply.destroy).toHaveBeenCalledOnce();
  });
  it.each(["127.0.0.1", "0.0.0.0", "10.0.0.1", "192.168.1.2", "172.16.0.2", "169.254.169.254", "100.64.0.1",
    "192.0.2.1", "192.88.99.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "64:ff9b::7f00:1", "2002:7f00:1::1",
  ])("blocks non-public address %s", address => expect(publicMetadataAddress(address)).toBe(false));

  it("rejects credentialed, non-HTTP, local and nonstandard port destinations", () => {
    for (const url of ["file:///etc/hosts", "http://user:pass@example.com", "http://host.local", "http://localhost./", "http://example.com:8080", "http://2130706433/"]) {
      expect(() => metadataUrl(url)).toThrow();
    }
    expect(publicMetadataAddress(publicIp.address)).toBe(true);
    expect(publicMetadataAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects mixed public and private DNS answers", async () => {
    await expect(metadataTarget(page, async () => [publicIp, { address: "10.0.0.1", family: 4 }])).rejects.toMatchObject({ retryable: false });
  });

  it("resolves every redirect before passing a pinned address to the transport", async () => {
    const resolve = vi.fn(async (host: string) => host === "example.com" ? [publicIp] : [{ address: "10.0.0.1", family: 4 }]);
    const redirect = response(302, { location: "https://other.example.com/target" });
    const request = vi.fn(async () => redirect);
    await expect(fetchSavedMetadataResource(page.href, options, { resolve, request })).rejects.toMatchObject({ retryable: false });
    expect(resolve.mock.calls).toEqual([["example.com"], ["other.example.com"]]);
    expect(request).toHaveBeenCalledExactlyOnceWith(page, publicIp, expect.any(AbortSignal), "text/html");
    expect(redirect.destroy).toHaveBeenCalledOnce();
  });

  it("caps redirects, validates MIME and rejects oversized streamed bodies", async () => {
    const resolve = vi.fn(async () => [publicIp]);
    const request = vi.fn(async () => response(302, { location: "/next" }));
    await expect(fetchSavedMetadataResource(page.href, options, { resolve, request })).rejects.toMatchObject({ retryable: false });
    expect(request).toHaveBeenCalledTimes(4);
    request.mockImplementation(async () => response(200, { "content-type": "text/html" }, "1234", "56789"));
    await expect(fetchSavedMetadataResource(page.href, options, { resolve, request })).rejects.toMatchObject({ retryable: false });
    request.mockImplementation(async () => response(200, { "content-type": "image/svg+xml" }, "abc"));
    await expect(fetchSavedMetadataResource(page.href, options, { resolve, request })).rejects.toMatchObject({ retryable: false });
    request.mockImplementation(async () => response(200, { "content-type": "text/html" }, "valid"));
    await expect(fetchSavedMetadataResource(page.href, options, { resolve, request })).resolves.toMatchObject({ body: Buffer.from("valid") });
  });

  it("aborts a pending DNS lookup without issuing a request", async () => {
    const signal = AbortSignal.timeout(10);
    const resolve = () => new Promise<typeof publicIp[]>(() => {});
    const request = vi.fn(async () => response(200, { "content-type": "text/html" }, "valid"));
    await expect(fetchSavedMetadataResource(page.href, { ...options, signal }, { resolve, request })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(request).not.toHaveBeenCalled();
  });
});
