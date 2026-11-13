import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { extractSavedArticle } from "@/lib/saved-article-extraction";
import { SavedMetadataError } from "@/lib/saved-metadata-network";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("SavedArticle durable PostgreSQL jobs", () => {
  let db: typeof import("@/lib/db").db;
  let queue: typeof import("./saved-article-queue");
  let processJob: typeof import("./saved-article-worker").processSavedArticleJob;
  let owner: string;
  let other: string;
  let savedItemId: string;
  let directory: string;
  const previousUploads = process.env.UPLOAD_DIR;
  const url = "https://example.org/article";
  const text = "A full article contains enough main prose to satisfy the extractor and persist a structured result.";
  const article = (title: string) => extractSavedArticle(`<article><h1>${title}</h1><p>${text}</p></article>`, new URL(url));
  const signal = () => new AbortController().signal;
  const enqueue = () => queue.enqueueSavedArticle(owner, savedItemId);
  const state = () => queue.getSavedArticleState(owner, savedItemId);
  const expireLease = () => db.savedArticleJob.update({
    where: { savedItemId }, data: { leaseUntil: new Date(0) },
  });

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "notebook-article-images-"));
    process.env.UPLOAD_DIR = directory;
    ({ db } = await import("@/lib/db"));
    queue = await import("./saved-article-queue");
    ({ processSavedArticleJob: processJob } = await import("./saved-article-worker"));
  });

  beforeEach(async () => {
    await db.user.deleteMany();
    const [first, second] = await Promise.all(["owner", "other"].map(name => db.user.create({
      data: { name, email: `${name}@article.test`, passwordHash: "unused" },
    })));
    owner = first.id;
    other = second.id;
    const item = await db.savedItem.create({ data: { userId: owner, url, title: "Kept", titleOrigin: "legacy" } });
    savedItemId = item.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousUploads === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploads;
  });

  async function illustratedArticle(title: string, failedSecond = true) {
    const result = extractSavedArticle(`<article><h1>${title}</h1><p>${text}</p>
      <img src="/one.png" alt="One"><img src="/two.png" alt="Two"></article>`, new URL(url));
    if (result.status !== "ready" || !result.imageCandidates) throw new Error("Invalid article fixture");
    const { prepareUpload } = await import("./upload-service");
    const raster = await sharp({ create: { width: 80, height: 50, channels: 3, background: "teal" } }).webp().toBuffer();
    const file = await prepareUpload(new File([new Uint8Array(raster)], "article.webp", { type: "image/webp" }));
    return { ...result, images: result.imageCandidates.map((image, index) => ({ ...image, file: index === 1 && failedSecond ? null : file })) };
  }

  it("scopes internal services to the owner and starts with no jobs for existing links", async () => {
    expect(await state()).toEqual({ article: null, job: null });
    expect(await queue.claimSavedArticleJob()).toBeNull();
    await expect(queue.enqueueSavedArticle(other, savedItemId)).rejects.toMatchObject({ status: 404 });
    await expect(queue.getSavedArticleState(other, savedItemId)).rejects.toMatchObject({ status: 404 });
    const textOnly = await db.savedItem.create({ data: { userId: owner, text: "Text" } });
    await expect(queue.enqueueSavedArticle(owner, textOnly.id)).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    "https://youtu.be/testVideo_1", "https://vk.com/clip-123_456", "https://www.threads.net/@notes/post/Cabc123",
  ])("settles an old article job for %s without fetching or discarding an existing copy", async sourceUrl => {
    await db.savedItem.update({ where: { id: savedItemId }, data: { url: sourceUrl } });
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "Previously saved text" }] }];
    await db.savedArticle.create({ data: { savedItemId, sourceUrl, blocks, contentVersion: 1, extractedAt: new Date() } });
    await db.savedArticleJob.create({ data: { savedItemId, sourceUrl, generation: "legacy" } });
    const extract = vi.fn(async () => article("Unexpected"));
    await expect(enqueue()).rejects.toMatchObject({ status: 409 });
    await expect(queue.enqueueSavedArticle(other, savedItemId, { manual: true })).rejects.toMatchObject({ status: 404 });
    expect(await processJob(signal(), extract)).toBe(true);
    expect(extract).not.toHaveBeenCalled();
    expect(await state()).toMatchObject({ article: { sourceUrl }, job: { status: "fallback", reason: "link-type" } });
    const { readSavedArticle } = await import("./saved-article-reader");
    expect(await readSavedArticle(owner, savedItemId)).toMatchObject({ article: { blocks } });
  });

  it("gives a job to only one competing handler and makes an expired lease recoverable", async () => {
    await enqueue();
    const claims = await Promise.all([queue.claimSavedArticleJob(), queue.claimSavedArticleJob()]);
    const first = claims.find(job => job !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expireLease();
    expect(await queue.settleSavedArticleJob(first, article("Expired"))).toBe(false);
    const second = (await queue.claimSavedArticleJob())!;
    expect(second).toMatchObject({ generation: first.generation, attempts: 2 });
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(await queue.settleSavedArticleJob(first, article("Late"))).toBe(false);
    expect(await queue.settleSavedArticleJob(second, article("Recovered"))).toBe(true);
    expect(await state()).toMatchObject({
      article: { contentVersion: 1, sourceUrl: url, extractedAt: expect.any(Date) },
      job: { status: "ready", attempts: 2, finishedAt: expect.any(Date) },
    });
  });

  it("makes newly created jobs eligible in a non-UTC database session", async () => {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Yekaterinburg'`;
      await tx.savedArticleJob.create({ data: { savedItemId, sourceUrl: url, generation: "database-default" } });
    });
    expect(await queue.claimSavedArticleJob()).toMatchObject({ savedItemId, generation: "database-default", attempts: 1 });
  });

  it("finishes exhausted expired leases without another network request", async () => {
    await enqueue();
    for (let attempt = 1; attempt <= queue.MAX_ARTICLE_ATTEMPTS; attempt++) {
      expect(await queue.claimSavedArticleJob()).toMatchObject({ attempts: attempt });
      await expireLease();
    }
    const extract = vi.fn(async () => article("Unexpected"));
    expect(await processJob(signal(), extract)).toBe(false);
    expect(extract).not.toHaveBeenCalled();
    expect(await state()).toMatchObject({ job: { status: "failed", reason: "lease-expired", attempts: queue.MAX_ARTICLE_ATTEMPTS } });
  });

  it("keeps the last good article after retries and replaces it only on success", async () => {
    await enqueue();
    expect(await processJob(signal(), async () => article("First"))).toBe(true);
    const where = { savedItemId };
    const first = await db.savedArticle.findUniqueOrThrow({ where });
    await enqueue();
    await processJob(signal(), async () => { throw new SavedMetadataError(true, "http", 429); });
    expect(await state()).toMatchObject({ job: { status: "retry", reason: "http", attempts: 1 } });
    expect(await queue.claimSavedArticleJob()).toBeNull();
    expect(await db.savedArticle.findUnique({ where })).toEqual(first);
    await db.savedArticleJob.update({ where, data: { availableAt: new Date(0) } });
    await processJob(signal(), async () => ({ status: "fallback", reason: "access" }));
    expect(await state()).toMatchObject({ job: { status: "fallback", reason: "access", attempts: 2 } });
    expect(await db.savedArticle.findUnique({ where })).toEqual(first);
    await enqueue();
    await processJob(signal(), async () => article("Second"));
    expect((await db.savedArticle.findUniqueOrThrow({ where })).blocks).not.toEqual(first.blocks);
    expect(await db.savedItem.findUnique({ where: { id: savedItemId } })).toMatchObject({ title: "Kept", url });
  });

  it("rejects a result after re-enqueue or a change of source URL", async () => {
    await enqueue();
    const old = (await queue.claimSavedArticleJob())!;
    const next = await enqueue();
    expect(next.generation).not.toBe(old.generation);
    expect(await queue.settleSavedArticleJob(old, article("Old"))).toBe(false);
    const current = (await queue.claimSavedArticleJob())!;
    await db.savedItem.update({ where: { id: savedItemId }, data: { url: "https://example.org/new" } });
    expect(await queue.settleSavedArticleJob(current, article("Wrong source"))).toBe(false);
    expect((await state()).article).toBeNull();
    await expireLease();
    expect(await queue.claimSavedArticleJob()).toBeNull();
    expect(await state()).toMatchObject({ job: { status: "failed", reason: "source-changed" } });
  });

  it("does not recreate jobs or articles after deletion during extraction, including a restored item", async () => {
    await enqueue();
    await processJob(signal(), async () => {
      await db.savedItem.delete({ where: { id: savedItemId } });
      expect(await db.savedArticleJob.count()).toBe(0);
      await db.savedItem.create({ data: { id: savedItemId, userId: owner, url } });
      await enqueue();
      return article("Deleted generation");
    });
    expect(await state()).toMatchObject({ article: null, job: { status: "queued", attempts: 0 } });
    await db.savedItem.delete({ where: { id: savedItemId } });
    expect(await db.savedArticleJob.count()).toBe(0);
    expect(await db.savedArticle.count()).toBe(0);
  });

  it("leaves a cancelled job recoverable without publishing", async () => {
    await enqueue();
    const controller = new AbortController();
    expect(await processJob(controller.signal, async () => {
      controller.abort();
      return article("Cancelled");
    })).toBe(false);
    expect(await state()).toMatchObject({ article: null, job: { status: "running", attempts: 1 } });
    await expireLease();
    expect(await processJob(signal(), async () => article("Resumed"))).toBe(true);
    expect(await state()).toMatchObject({ job: { status: "ready", attempts: 2 } });
  });

  it("serves local images only to the owner and excludes live images from Upload cleanup", async () => {
    const reader = await import("./saved-article-reader");
    const storage = await import("./attachment-service");
    const first = await illustratedArticle("Illustrated");
    await enqueue();
    const download = vi.fn(async () => first.images);
    await processJob(signal(), async () => first, download);
    expect(download).toHaveBeenCalledOnce();
    const { article: copy } = await reader.readSavedArticle(owner, savedItemId);
    expect(copy).toMatchObject({ contentVersion: 2, images: [{ key: first.images[0].key }] });
    await expect(reader.readSavedArticle(other, savedItemId)).rejects.toMatchObject({ status: 404 });
    await expect(reader.readSavedArticleImage(other, savedItemId, first.images[0].key)).rejects.toMatchObject({ status: 404 });
    await expect(reader.readSavedArticleImage(owner, savedItemId, first.images[1].key)).rejects.toMatchObject({ status: 404 });
    const response = await reader.readSavedArticleImage(owner, savedItemId, first.images[0].key);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(first.images[0].file!.bytes));
    expect((await storage.auditStorage(owner)).unusedAttachments).toEqual([]);

    await enqueue();
    await processJob(signal(), async () => ({ status: "fallback", reason: "access" }));
    expect((await reader.readSavedArticle(owner, savedItemId)).article).toEqual(copy);
    const updated = await illustratedArticle("Updated", false);
    await enqueue();
    await processJob(signal(), async () => updated, async () => updated.images);
    expect((await reader.readSavedArticle(owner, savedItemId)).article?.images).toHaveLength(2);
    expect((await storage.cleanupStorage(owner)).removed).toBe(1);
    const { deleteSavedItem } = await import("./saved-item-service");
    await deleteSavedItem(owner, savedItemId);
    expect(await db.savedArticleImage.count()).toBe(0);
    expect((await storage.cleanupStorage(owner)).removed).toBe(2);
    expect(await db.upload.count({ where: { userId: owner } })).toBe(0);
  });

  it("rolls back a partial write and removes new files while retaining the previous copy", async () => {
    const original = await illustratedArticle("Original");
    await enqueue();
    expect(await queue.settleSavedArticleJob((await queue.claimSavedArticleJob())!, original)).toBe(true);
    const where = { savedItemId };
    const before = await db.savedArticle.findUniqueOrThrow({ where, include: { images: true } });
    const disk = path.join(directory, owner);
    const files = await readdir(disk);
    const update = await illustratedArticle("New", false);
    await enqueue();
    const job = (await queue.claimSavedArticleJob())!;
    await db.$executeRaw`CREATE FUNCTION notebook_article_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.position = 1 THEN RAISE EXCEPTION 'rollback test'; END IF; RETURN NEW; END $$`;
    try {
      await db.$executeRaw`CREATE TRIGGER notebook_article_test_abort BEFORE INSERT ON "SavedArticleImage" FOR EACH ROW EXECUTE FUNCTION notebook_article_test_abort()`;
      await expect(queue.settleSavedArticleJob(job, update)).rejects.toThrow();
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS notebook_article_test_abort ON "SavedArticleImage"`;
      await db.$executeRaw`DROP FUNCTION IF EXISTS notebook_article_test_abort()`;
    }
    expect(await db.savedArticle.findUnique({ where, include: { images: true } })).toEqual(before);
    expect(await readdir(disk)).toEqual(files);
    expect(await db.upload.count({ where: { userId: owner } })).toBe(1);
  });

  it("serializes manual requests and rate limits immediate re-enqueue", async () => {
    const manual = () => queue.enqueueSavedArticle(owner, savedItemId, { manual: true });
    const results = await Promise.allSettled([manual(), manual()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    await processJob(signal(), async () => ({ status: "fallback", reason: "empty" }));
    await expect(manual()).rejects.toMatchObject({ status: 429 });
  });
});
