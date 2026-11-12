import sharp from "sharp";
import { beforeAll, expect, it, vi } from "vitest";
import { extractSavedArticle } from "@/lib/saved-article-extraction";
import { fetchSavedMetadataResource } from "@/lib/saved-metadata-network";
import { downloadSavedArticleImages, MAX_ARTICLE_IMAGE_BYTES } from "./saved-article-images";

const url = new URL("https://example.org/journal/article");
const prose = "This field guide contains enough prose for the main content detector and has a few observations about the trail.";
let png: Buffer<ArrayBuffer>;
beforeAll(async () => {
  png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "teal" } }).png().toBuffer();
});

it("extracts only article image candidates, with stable keys and absolute URLs", () => {
  const page = `<aside><img src="/teaser.png"></aside><article><p>${prose}</p>
    <div class="advertisement"><img src="/ad.png"></div><img src="/tiny.png" width="1">
    <img src="/tracker.png"><img src="http://127.0.0.1/image.png">
    <figure><img src="../first.png" alt="Trail"></figure>
    <p><img src="data:image/png;base64,placeholder" data-src="/second.png" alt="Map"></p>
    <img src="../first.png" alt="Trail again"></article>`;
  const first = extractSavedArticle(page, url);
  const second = extractSavedArticle(page, url);
  expect(first).toEqual(second);
  expect(first.status).toBe("ready");
  if (first.status !== "ready") throw new Error("Article fixture was rejected");
  expect(first.imageCandidates?.map(image => image.sourceUrl)).toEqual(["https://example.org/first.png", "https://example.org/second.png"]);
  const blocks = first.blocks.filter(block => block.type === "image");
  expect(blocks.map(block => block.alt)).toEqual(["Trail", "Map", "Trail again"]);
  expect(blocks[0].key).toBe(blocks[2].key);
});

it("normalizes allowed raster data and leaves unavailable, spoofed, SVG and tracking pixels missing", async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  const variants = [
    { body: png, mimeType: "image/png" }, { body: Buffer.from("<svg/>"), mimeType: "image/svg+xml" },
    { body: Buffer.from("not an image"), mimeType: "image/jpeg" }, { body: tiny, mimeType: "image/png" },
  ];
  const candidates = Array.from({ length: 5 }, (_, index) => ({ key: String(index), sourceUrl: new URL(`/${index}.png`, url).href }));
  const fetch = vi.fn(async (source: string) => {
    const fixture = variants[Number(new URL(source).pathname.slice(1, 2))];
    if (!fixture) throw new Error("missing");
    return { ...fixture, contentType: fixture.mimeType, url: new URL(source) };
  });
  const images = await downloadSavedArticleImages(candidates, new AbortController().signal, fetch);
  expect(images.map(image => image.file?.mimeType ?? null)).toEqual(["image/webp", null, null, null, null]);
  expect(await sharp(images[0].file!.bytes).metadata()).toMatchObject({ width: 200, height: 100, format: "webp" });
});

it("bounds per-image, total transfer and candidate count", async () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ key: String(index), sourceUrl: url.href }));
  const fetch = vi.fn(async () => ({ body: Buffer.alloc(MAX_ARTICLE_IMAGE_BYTES), mimeType: "image/png", contentType: "image/png", url }));
  const images = await downloadSavedArticleImages(candidates, new AbortController().signal, fetch);
  expect(images).toHaveLength(8);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch).toHaveBeenCalledWith(url.href, expect.objectContaining({ maxBytes: MAX_ARTICLE_IMAGE_BYTES }));
  expect(images.every(image => !image.file)).toBe(true);
});

it("uses the transport redirect check and skips a blocked image", async () => {
  const request = vi.fn(async () => ({
    statusCode: 302, headers: { location: "https://target.example/image.png" }, destroy: vi.fn(),
    async *[Symbol.asyncIterator]() { yield Buffer.alloc(0); },
  }));
  const resolve = vi.fn(async () => [{ address: "93.184.215.14", family: 4 }])
    .mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  const [image] = await downloadSavedArticleImages([{ key: "first", sourceUrl: url.href }], new AbortController().signal,
    (source, options) => fetchSavedMetadataResource(source, options, { request, resolve }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(image.file).toBeNull();
});
