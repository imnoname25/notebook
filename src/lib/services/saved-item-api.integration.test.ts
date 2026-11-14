import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const origin = process.env.TEST_SAVED_HTTP_ORIGIN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(origin && databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("saved item routes over HTTP with real sessions", () => {
  let db: typeof import("@/lib/db").db;
  const userIds: string[] = [];
  let ownerId: string;
  let ownerCookie: string;
  let otherCookie: string;
  let sectionId: string;
  const endpoint = "/api/saved-items";

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    const { hashSessionToken, SESSION_COOKIE } = await import("@/lib/auth/session");
    const sessions = await Promise.all(["owner", "other"].map(async (name) => {
      const user = await db.user.create({ data: { name, email: `${randomUUID()}@saved-http.test`, passwordHash: "unused" } });
      userIds.push(user.id);
      const token = randomUUID();
      const expires = new Date(Date.now() + 3_600_000);
      await db.session.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: expires, absoluteExpiresAt: expires } });
      return { userId: user.id, cookie: `${SESSION_COOKIE}=${token}` };
    }));
    ownerCookie = sessions[0].cookie;
    ownerId = sessions[0].userId;
    otherCookie = sessions[1].cookie;
    sectionId = (await db.section.create({ data: { title: "Destination", notebook: { create: { userId: sessions[0].userId, title: "Notebook" } } } })).id;
  });

  afterAll(async () => {
    await db?.user.deleteMany({ where: { id: { in: userIds } } });
    await db?.$disconnect();
  });

  function request(path: string, options?: RequestInit) {
    return fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(60_000) });
  }

  function json(cookie: string, body: unknown, key?: string, method = "POST") {
    return {
      method, body: JSON.stringify(body),
      headers: { cookie, origin: origin!, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    };
  }

  it("requires a session, matching origin and idempotency key, then enforces ownership", async () => {
    expect((await request(endpoint)).status).toBe(401);
    expect((await request(endpoint, { method: "POST", headers: { cookie: ownerCookie } })).status).toBe(403);
    expect((await request(endpoint, { method: "POST", headers: { cookie: ownerCookie, origin: "https://foreign.invalid" } })).status).toBe(403);
    expect((await request(endpoint, json(ownerCookie, { text: "data" }))).status).toBe(400);
    expect((await request(endpoint, json(ownerCookie, { url: "file:///file" }, "invalid-url"))).status).toBe(400);
    expect((await request(endpoint, json(ownerCookie, { text: " ".repeat(530_000) }, "oversize"))).status).toBe(413);
    const capture = json(ownerCookie, { text: "data" }, "http-save");
    const responses = await Promise.all([request(endpoint, capture), request(endpoint, capture)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const created = responses.find(response => response.status === 201)!;
    const { item } = await created.json();
    expect(await responses.find(response => response.status === 200)!.json()).toMatchObject({ item: { id: item.id } });
    expect((await request(endpoint, json(ownerCookie, { text: "different" }, "http-save"))).status).toBe(409);
    const itemPath = `${endpoint}/${item.id}`;
    expect((await request(itemPath, { headers: { cookie: otherCookie } })).status).toBe(404);
    expect((await request(itemPath, json(otherCookie, { archived: true }, undefined, "PATCH"))).status).toBe(404);
    expect((await request(`${itemPath}/convert`, json(otherCookie, { sectionId }, "http-transfer"))).status).toBe(404);
    const patched = await request(itemPath, json(ownerCookie, { title: "Edited through PATCH", reviewStatus: "reviewed" }, undefined, "PATCH"));
    expect(await patched.json()).toMatchObject({ item: { titleOrigin: "manual", displayTitle: "Edited through PATCH", reviewStatus: "reviewed", archivedAt: null } });
    const transfer = json(ownerCookie, { sectionId }, "http-transfer");
    const transfers = await Promise.all([request(`${itemPath}/convert`, transfer), request(`${itemPath}/convert`, transfer)]);
    expect(transfers.map(response => response.status).sort()).toEqual([200, 201]);
    expect(await transfers[0].json()).toEqual(await transfers[1].json());
    const archived = await request(`${endpoint}?archive=archived`, { headers: { cookie: ownerCookie } });
    expect(await archived.json()).toMatchObject({ items: [{ id: item.id, reviewStatus: "reviewed" }] });
    expect((await request(itemPath, { method: "DELETE", headers: { cookie: ownerCookie, origin: origin! } })).status).toBe(204);
    expect((await request(itemPath, { headers: { cookie: ownerCookie } })).status).toBe(404);
  }, 120_000);

  it("stores a multipart PDF privately and rejects unsupported attachments and excess files", async () => {
    const pdf = new File(["%PDF-1.7\n%%EOF"], "capture.pdf", { type: "application/pdf" });
    const multipart = (body: FormData, key: string) => request(endpoint, {
      method: "POST", headers: { cookie: ownerCookie, origin: origin!, "idempotency-key": key }, body,
    });
    const invalid = new FormData();
    invalid.append("file", new File(["bad"], "capture.pdf", { type: "application/pdf" }));
    expect((await multipart(invalid, "invalid-pdf")).status).toBe(415);
    const excess = new FormData();
    for (let index = 0; index < 5; index++) excess.append("file", pdf);
    expect((await multipart(excess, "excess-files")).status).toBe(413);
    const valid = new FormData();
    valid.append("payload", JSON.stringify({ title: "Private PDF" }));
    valid.append("file", pdf);
    const response = await multipart(valid, "valid-pdf");
    expect(response.status).toBe(201);
    const { item } = await response.json();
    const fileUrl = item.attachments[0].url;
    expect((await request(fileUrl)).status).toBe(401);
    expect((await request(fileUrl, { headers: { cookie: otherCookie } })).status).toBe(404);
    const ownFile = await request(fileUrl, { headers: { cookie: ownerCookie } });
    expect(ownFile.status).toBe(200);
    expect(ownFile.headers.get("cache-control")).toBe("private, no-store");
    expect(ownFile.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(await ownFile.text()).toMatch(/^%PDF-/);
  }, 120_000);

  it("accepts Android titles and adopts site metadata only on explicit PATCH for manual titles", async () => {
    const key = randomUUID();
    const payload = { title: "Manual title", sharedTitle: "Android title", text: "Source text" };
    const created = await request(endpoint, json(ownerCookie, payload, key));
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ titleOrigin: "manual", sharedTitle: "Android title", displayTitle: "Manual title" });
    await db.savedItem.update({ where: { id: item.id }, data: { metadataTitle: "Website title" } });
    const retry = await request(endpoint, json(ownerCookie, payload, key));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ item: { id: item.id, displayTitle: "Manual title" } });
    expect((await request(endpoint, json(ownerCookie, { ...payload, sharedTitle: "Changed" }, key))).status).toBe(409);
    const itemPath = `${endpoint}/${item.id}`;
    expect((await request(itemPath, json(otherCookie, { useWebsiteTitle: true }, undefined, "PATCH"))).status).toBe(404);
    const response = await request(itemPath, json(ownerCookie, { useWebsiteTitle: true }, undefined, "PATCH"));
    if (process.env.SAVED_ITEM_TITLE_ORIGINS !== "1") {
      expect(response.status).toBe(409);
    } else {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        item: { displayTitle: "Website title", title: "", titleOrigin: "system", sharedTitle: "Android title" },
      });
    }
  }, 120_000);

  it("requires ownership for previews and refuses a private preview destination", async () => {
    const { id } = await db.savedItem.create({
      data: { userId: ownerId, title: "Private preview", titleOrigin: "legacy", metadataImageUrl: "http://127.0.0.1/preview.png" },
      select: { id: true },
    });
    const path = `${endpoint}/${id}/preview`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, { headers: { cookie: otherCookie } })).status).toBe(404);
    const refused = await request(path, { headers: { cookie: ownerCookie } });
    expect(refused.status).toBe(404);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
    expect(await refused.json()).toEqual({ error: "Превью недоступно" });
    await db.savedItem.update({ where: { id }, data: { metadataImageUrl: null } });
    expect((await request(path, { headers: { cookie: ownerCookie } })).status).toBe(404);
  }, 120_000);

  it("serves a restricted video card and an existing copy, and rejects new article capture for it", async () => {
    const url = "https://youtu.be/testVideo_1";
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "Local copy" }] }];
    const { id } = await db.savedItem.create({ data: {
      userId: ownerId, url, titleOrigin: "share", sharedTitle: "Android video",
      metadataJob: { create: { finishedAt: new Date(), failed: true, failureReason: "access" } },
      article: { create: { contentVersion: 1, blocks, sourceUrl: url, extractedAt: new Date() } },
    } });
    const path = `${endpoint}/${id}`;
    const item = await request(path, { headers: { cookie: ownerCookie } });
    expect(await item.json()).toMatchObject({ item: { linkKind: "video", displayTitle: "Android video",
      hasSavedArticle: true, metadataStatus: "failed", metadataFailure: "access" } });
    const article = await request(`${path}/article`, { headers: { cookie: ownerCookie } });
    expect(article.headers.get("cache-control")).toBe("private, no-store");
    expect(await article.json()).toMatchObject({ article: { blocks } });
    expect((await request(`${path}/article`, json(otherCookie, {}))).status).toBe(404);
    expect((await request(`${path}/article`, json(ownerCookie, {}))).status).toBe(409);
    expect(await db.savedArticleJob.findUnique({ where: { savedItemId: id } })).toBeNull();
  }, 120_000);

  it("enforces private article and image access, Origin and manual throttling", async () => {
    const { createHash } = await import("node:crypto");
    const { default: sharp } = await import("sharp");
    const { prepareUpload, withUploadWrites } = await import("./upload-service");
    const userId = ownerId;
    const url = "https://example.invalid/article";
    const sourceUrl = "https://example.invalid/image.webp";
    const key = createHash("sha256").update(sourceUrl).digest("hex");
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: "teal" } }).webp().toBuffer();
    const file = await prepareUpload(new File([new Uint8Array(bytes)], "fixture.webp", { type: "image/webp" }));
    const { id, uploadId } = await withUploadWrites(userId, async (tx, store) => {
      const { id } = await tx.savedItem.create({ data: { userId, url, text: "Story" }, select: { id: true } });
      const upload = await store(file);
      await tx.savedArticle.create({ data: { savedItemId: id, sourceUrl: url, extractedAt: new Date(), contentVersion: 2,
        blocks: [{ type: "paragraph", content: [{ type: "text", text: "Story" }] }, { type: "image", key, alt: "Fixture" }],
        images: { create: { imageKey: key, position: 0, sourceUrl, uploadId: upload.id } },
      } });
      return { id, uploadId: upload.id };
    });
    const article = `${endpoint}/${id}/article`;
    const image = `${article}/images/${key}`;
    const owner = { headers: { cookie: ownerCookie } };
    const other = { headers: { cookie: otherCookie } };
    expect((await request(article)).status).toBe(401);
    expect((await request(article, other)).status).toBe(404);
    expect((await request(image, other)).status).toBe(404);
    expect((await request(`/api/uploads/${uploadId}`, owner)).status).toBe(404);
    const content = await request(article, owner);
    expect(content.headers.get("cache-control")).toBe("private, no-store");
    expect(await content.json()).toMatchObject({ article: { contentVersion: 2, images: [{ key }] }, job: null });
    const binary = await request(image, owner);
    expect(binary.headers.get("x-content-type-options")).toBe("nosniff");
    expect(binary.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await binary.arrayBuffer())).toEqual(bytes);
    expect((await request(article, { method: "POST", ...owner })).status).toBe(403);
    expect((await request(article, json(otherCookie, {}))).status).toBe(404);
    expect((await request(article, json(ownerCookie, {}))).status).toBe(202);
    await db.savedArticleJob.update({ where: { savedItemId: id }, data: {
      status: "failed", finishedAt: new Date(), leaseToken: null, leaseUntil: null,
    } });
    const throttled = await request(article, json(ownerCookie, {}));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("60");
  }, 120_000);

  it.each([
    "https://vk.ru/wall-123_456",
    "https://vk.ru/clip-123_456",
  ])("diagnoses a legacy browser placeholder and discards only the confirmed copy at %s", async url => {
    const extractedAt = new Date("2025-01-02T03:04:05.000Z");
    const blocks = [
      { type: "heading", level: 1, content: [{ type: "text", text: "Ваш браузер устарел" }] },
      { type: "paragraph", content: [{ type: "text", text: "Обновите свой браузер или установите один из рекомендуемых." }] },
    ];
    const { id } = await db.savedItem.create({ data: {
      userId: ownerId, url, sharedTitle: "Исходная публикация", titleOrigin: "share",
      article: { create: { blocks, sourceUrl: url, contentVersion: 1, extractedAt } },
      articleJob: { create: { sourceUrl: url, generation: randomUUID(), status: "ready", finishedAt: extractedAt } },
    } });
    const itemPath = `${endpoint}/${id}`;
    const path = `${itemPath}/article`;
    const where = { savedItemId: id };
    const mutation = (cookie: string, time = extractedAt) => json(cookie, { extractedAt: time }, undefined, "DELETE");
    const read = await request(path, { headers: { cookie: ownerCookie } });
    expect(await read.json()).toMatchObject({ article: { blocks, browserPlaceholder: true }, job: { status: "ready" } });
    expect((await request(path, { ...mutation(ownerCookie), headers: { ...mutation(ownerCookie).headers, origin: "https://foreign.invalid" } })).status).toBe(403);
    expect((await request(path, mutation(otherCookie))).status).toBe(404);
    expect((await request(path, mutation(ownerCookie, new Date(0)))).status).toBe(409);
    const original = [{ type: "paragraph", content: [{ type: "text", text: "Содержимое настоящей статьи" }] }];
    await db.savedArticle.update({ where, data: { blocks: original } });
    expect((await request(path, mutation(ownerCookie))).status).toBe(409);
    await db.savedArticle.update({ where, data: { blocks } });
    await db.savedArticleJob.update({ where, data: {
      status: "running", finishedAt: null, leaseUntil: new Date(Date.now() + 600_000), leaseToken: randomUUID(),
    } });
    expect((await request(path, mutation(ownerCookie))).status).toBe(409);
    await db.savedArticleJob.update({ where, data: { status: "ready", finishedAt: extractedAt, leaseUntil: null, leaseToken: null } });
    const discarded = await request(path, mutation(ownerCookie));
    expect(discarded.status).toBe(200);
    expect(await discarded.json()).toMatchObject({ article: null, job: { status: "fallback", accessLimited: true } });
    expect(await db.savedArticle.findUnique({ where })).toBeNull();
    expect(await (await request(itemPath, { headers: { cookie: ownerCookie } })).json()).toMatchObject({
      item: { url, displayTitle: "Исходная публикация", hasSavedArticle: false },
    });
  }, 120_000);
});
