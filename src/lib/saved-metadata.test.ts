import { describe, expect, it, vi } from "vitest";
import { extractSavedMetadata } from "./saved-metadata";
import { fetchSavedMetadataResource, metadataTarget, metadataUrl, publicMetadataAddress } from "./saved-metadata-network";

const page = new URL("https://example.com/articles/page");
const publicIp = { address: "93.184.216.34", family: 4 };
const options = { maxBytes: 8, types: ["text/html"] };

function response(statusCode: number, headers: Record<string, string>, ...body: string[]) {
  return {
    statusCode, headers, destroy: vi.fn(),
    async *[Symbol.asyncIterator]() { for (const chunk of body) yield Buffer.from(chunk); },
  };
}

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
});

describe("saved URL network boundary", () => {
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
