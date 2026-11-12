import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterAll(async () => { await db?.$disconnect(); });

  it("scopes internal services to the owner and starts with no jobs for existing links", async () => {
    expect(await state()).toEqual({ article: null, job: null });
    expect(await queue.claimSavedArticleJob()).toBeNull();
    await expect(queue.enqueueSavedArticle(other, savedItemId)).rejects.toMatchObject({ status: 404 });
    await expect(queue.getSavedArticleState(other, savedItemId)).rejects.toMatchObject({ status: 404 });
    const textOnly = await db.savedItem.create({ data: { userId: owner, text: "Text" } });
    await expect(queue.enqueueSavedArticle(owner, textOnly.id)).rejects.toMatchObject({ status: 409 });
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
});
