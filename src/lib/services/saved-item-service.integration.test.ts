import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { savedItemCreateSchema, savedItemListSchema } from "@/lib/saved-item-validation";
import { fetchSavedMetadata } from "@/lib/saved-metadata";
import { fetchSavedMetadataResource, SavedMetadataError } from "@/lib/saved-metadata-network";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("saved items on PostgreSQL with persistent files", () => {
  let db: typeof import("@/lib/db").db;
  let saved: typeof import("./saved-item-service");
  let queue: typeof import("./saved-item-metadata-queue");
  let files: typeof import("./attachment-service");
  let prepareUpload: typeof import("./upload-service").prepareUpload;
  let directory: string;
  let owner: string;
  let other: string;
  let sectionId: string;
  let otherSectionId: string;
  const previousUploads = process.env.UPLOAD_DIR;
  const pdf = (contents = "%PDF-1.7\n%%EOF") => new File([contents], "document.pdf", { type: "application/pdf" });
  const input = savedItemCreateSchema.parse({ title: "Sample capture", text: "Find this original text", tags: ["#Inbox"] });
  const list = savedItemListSchema.parse({});

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "notebook-saved-test-"));
    process.env.UPLOAD_DIR = directory;
    ({ db } = await import("@/lib/db"));
    saved = await import("./saved-item-service");
    queue = await import("./saved-item-metadata-queue");
    files = await import("./attachment-service");
    ({ prepareUpload } = await import("./upload-service"));
  });

  beforeEach(async () => {
    await db.user.deleteMany();
    const [first, second] = await Promise.all(["owner", "other"].map(name => db.user.create({
      data: { email: `${name}@saved.test`, name, passwordHash: "unused" },
    })));
    owner = first.id;
    other = second.id;
    const [section, otherSection] = await Promise.all([owner, other].map(userId => db.section.create({
      data: { title: "Destination", notebook: { create: { userId, title: "Test notebook" } } },
    })));
    sectionId = section.id;
    otherSectionId = otherSection.id;
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousUploads === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploads;
    await db?.$disconnect();
  });

  it("isolates users, filters by FTS and tags, and changes review status independently of archive", async () => {
    const first = await saved.createSavedItem(owner, "list-first", input, []);
    const second = await saved.createSavedItem(owner, "list-second", input, []);
    const foreign = await saved.createSavedItem(other, "list-first", input, []);
    const page = await saved.listSavedItems(owner, { ...list, tag: "inbox", q: "original", limit: 1 });
    expect(page.items).toHaveLength(1);
    const remaining = await saved.listSavedItems(owner, { ...list, cursor: page.nextCursor! });
    expect(new Set([page.items[0].id, remaining.items[0].id])).toEqual(new Set([first.item.id, second.item.id]));
    await expect(saved.listSavedItems(owner, { ...list, cursor: foreign.item.id })).rejects.toMatchObject({ status: 404 });
    await expect(saved.getSavedItem(other, first.item.id)).rejects.toMatchObject({ status: 404 });
    await expect(saved.updateSavedItem(other, first.item.id, { archived: true })).rejects.toMatchObject({ status: 404 });
    await expect(saved.deleteSavedItem(other, first.item.id)).rejects.toMatchObject({ status: 404 });
    const reviewed = await saved.updateSavedItem(owner, first.item.id, { reviewStatus: "reviewed", tags: ["read"] });
    expect(reviewed).toMatchObject({ archivedAt: null, tags: [{ normalized: "read" }] });
    const archived = await saved.updateSavedItem(owner, first.item.id, { archived: true });
    expect(archived.reviewStatus).toBe("reviewed");
    expect((await saved.listSavedItems(owner, list)).items.map(item => item.id)).toEqual([second.item.id]);
    expect((await saved.listSavedItems(owner, { ...list, archive: "archived", reviewStatus: "reviewed" })).items).toHaveLength(1);
    expect((await saved.updateSavedItem(owner, first.item.id, { archived: false })).archivedAt).toBeNull();
  });

  it("deduplicates concurrent file captures, validates the fingerprint, and protects archived files", async () => {
    const prepared = await prepareUpload(pdf(), true);
    const [first, retry] = await Promise.all([
      saved.createSavedItem(owner, "offline-capture", input, [prepared]),
      saved.createSavedItem(owner, "offline-capture", input, [prepared]),
    ]);
    expect(first.item.id).toBe(retry.item.id);
    expect([first.replayed, retry.replayed].sort()).toEqual([false, true]);
    expect(await db.upload.count({ where: { userId: owner } })).toBe(1);
    const altered = await prepareUpload(pdf("%PDF-1.7\ndifferent\n%%EOF"), true);
    await expect(saved.createSavedItem(owner, "offline-capture", input, [altered])).rejects.toMatchObject({ status: 409 });
    await expect(saved.createSavedItem(owner, "offline-capture", { ...input, text: "Other text" }, [prepared])).rejects.toMatchObject({ status: 409 });
    await expect(prepareUpload(new File(["text"], "fake.pdf", { type: "application/pdf" }), true)).rejects.toMatchObject({ status: 415 });
    await expect(prepareUpload(pdf())).rejects.toMatchObject({ status: 415 });
    const uploadId = first.item.attachments[0].id;
    await saved.updateSavedItem(owner, first.item.id, { archived: true });
    await expect(files.deleteUnusedAttachment(other, uploadId)).rejects.toMatchObject({ status: 404 });
    await expect(files.deleteUnusedAttachment(owner, uploadId)).rejects.toMatchObject({ status: 409 });
    expect(await files.cleanupStorage(owner)).toMatchObject({ removed: 0 });
    await saved.deleteSavedItem(owner, first.item.id);
    await expect(saved.getSavedItem(owner, first.item.id)).rejects.toMatchObject({ status: 404 });
    await expect(saved.createSavedItem(owner, "offline-capture", input, [prepared])).rejects.toMatchObject({ status: 410 });
    expect(await files.cleanupStorage(owner)).toMatchObject({ removed: 1 });
  });

  it("queues only eligible new bookmarks when automatic extraction is enabled", async () => {
    const shared = savedItemCreateSchema.parse({ url: "https://example.org/story", sharedTitle: "Shared title" });
    try {
      vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", "0");
      const old = await saved.createSavedItem(owner, "old-bookmark", shared, []);
      vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", "1");
      const [one, two] = await Promise.all([
        saved.createSavedItem(owner, "android-capture", shared, []),
        saved.createSavedItem(owner, "android-capture", shared, []),
      ]);
      expect(one.item.id).toBe(two.item.id);
      expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
      expect((await saved.createSavedItem(owner, "old-bookmark", shared, [])).item.id).toBe(old.item.id);
      await saved.createSavedItem(owner, "with-attachment", shared, [await prepareUpload(pdf(), true)]);
      await saved.createSavedItem(owner, "without-url", input, []);
      await saved.createSavedItem(owner, "private-url", { ...shared, url: "http://127.0.0.1/story" }, []);
      expect(await db.savedArticleJob.findMany()).toMatchObject([
        { savedItemId: one.item.id, sourceUrl: shared.url, status: "queued" },
      ]);
    } finally { vi.unstubAllEnvs(); }
  });

  it("commits the bookmark and its idempotency record if automatic queue insertion fails", async () => {
    vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", "1");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = savedItemCreateSchema.parse({ url: "https://example.org/queue-failure", tags: ["#Inbox"] });
    try {
      await db.$executeRaw`CREATE FUNCTION reject_test_article_capture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test queue failure'; END $$`;
      await db.$executeRaw`CREATE TRIGGER reject_test_article_capture BEFORE INSERT ON "SavedArticleJob"
        FOR EACH ROW EXECUTE FUNCTION reject_test_article_capture()`;
      const { item } = await saved.createSavedItem(owner, "queue-error", source, []);
      expect(item.tags).toMatchObject([{ normalized: "inbox" }]);
      expect(await db.savedArticleJob.count()).toBe(0);
      expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ url: source.url });
      expect(await saved.createSavedItem(owner, "queue-error", source, [])).toMatchObject({
        item: { id: item.id }, replayed: true,
      });
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS reject_test_article_capture ON "SavedArticleJob"`;
      await db.$executeRaw`DROP FUNCTION IF EXISTS reject_test_article_capture()`;
      warning.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("transfers once across parallel keys, indexes the new page and retains its files", async () => {
    const created = await saved.createSavedItem(owner, "capture", input, [await prepareUpload(pdf(), true)]);
    const id = created.item.id;
    await expect(saved.convertSavedItem(other, id, otherSectionId, "transfer")).rejects.toMatchObject({ status: 404 });
    await expect(saved.convertSavedItem(owner, id, otherSectionId, "transfer")).rejects.toMatchObject({ status: 404 });
    const [first, retry, differentKey] = await Promise.all([
      saved.convertSavedItem(owner, id, sectionId, "transfer"),
      saved.convertSavedItem(owner, id, sectionId, "transfer"),
      saved.convertSavedItem(owner, id, sectionId, "transfer-again"),
    ]);
    expect(new Set([first.pageId, retry.pageId, differentKey.pageId]).size).toBe(1);
    expect([first, retry, differentKey].filter(result => !result.replayed)).toHaveLength(1);
    const page = await db.page.findUniqueOrThrow({ where: { id: first.pageId }, include: { uploads: true, tags: { include: { tag: true } } } });
    expect(page.searchText).toContain("Find this original text");
    expect(page.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "file" })]));
    expect(page.tags.map(link => link.tag.normalized)).toEqual(["inbox"]);
    expect(page.uploads[0].id).toBe(created.item.attachments[0].id);
    expect(await db.page.count({ where: { sectionId } })).toBe(1);
    expect(await saved.getSavedItem(owner, id)).toMatchObject({ reviewStatus: "pending", convertedPageId: page.id, archivedAt: expect.any(Date) });
    const otherSection = await db.section.create({ data: { notebookId: (await db.section.findUniqueOrThrow({ where: { id: sectionId } })).notebookId, title: "Another" } });
    await expect(saved.convertSavedItem(owner, id, otherSection.id, "transfer")).rejects.toMatchObject({ status: 409 });
    await expect(saved.convertSavedItem(owner, id, otherSection.id, "transfer-new")).rejects.toMatchObject({ status: 409 });
    await saved.deleteSavedItem(owner, id);
    expect(await files.cleanupStorage(owner)).toMatchObject({ removed: 0 });
  });

  it("removes a staged file when its database transaction rolls back", async () => {
    const { withUploadWrites } = await import("./upload-service");
    const prepared = await prepareUpload(pdf(), true);
    await expect(withUploadWrites(owner, async (_tx, store) => {
      await store(prepared);
      throw new Error("Test rollback");
    })).rejects.toThrow("Test rollback");
    expect(await db.upload.count({ where: { userId: owner } })).toBe(0);
    expect(await readdir(path.join(directory, owner))).toEqual([]);
  });

  it("protects a referenced upload while allowing the owner's data to cascade", async () => {
    const { item } = await saved.createSavedItem(owner, "cascade", input, [await prepareUpload(pdf(), true)]);
    const uploadId = item.attachments[0].id;
    await expect(db.upload.delete({ where: { id: uploadId } })).rejects.toMatchObject({ code: "P2003" });
    await db.user.delete({ where: { id: owner } });
    expect(await db.savedItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await db.upload.findUnique({ where: { id: uploadId } })).toBeNull();
  });

  it("claims one durable job, fences expired leases and honors a scheduled retry", async () => {
    const { item } = await saved.createSavedItem(owner, "with-url", { ...input, url: "https://example.org/" }, []);
    expect(item.metadataStatus).toBe("queued");
    const claims = await Promise.all([queue.claimSavedItemMetadataJob(), queue.claimSavedItemMetadataJob()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(job => job !== null)!;
    expect(first).toMatchObject({ savedItemId: item.id, attempts: 1, url: item.url });
    await db.savedItemMetadataJob.update({ where: { savedItemId: item.id }, data: { availableAt: new Date(0) } });
    expect(await db.$transaction(tx => queue.settleSavedItemMetadataJob(tx, first, { status: "done" }))).toBe(false);
    const second = (await queue.claimSavedItemMetadataJob())!;
    expect(second.attempts).toBe(2);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(await db.$transaction(tx => queue.settleSavedItemMetadataJob(tx, first, { status: "failed", reason: "request" }))).toBe(false);
    expect(await db.$transaction(tx => queue.settleSavedItemMetadataJob(tx, second, { status: "retry", retryAt: new Date(Date.now() + 60_000) }))).toBe(true);
    expect(await queue.claimSavedItemMetadataJob()).toBeNull();
    await db.savedItemMetadataJob.update({ where: { savedItemId: item.id }, data: { availableAt: new Date(0) } });
    const third = (await queue.claimSavedItemMetadataJob())!;
    expect(await db.$transaction(tx => queue.settleSavedItemMetadataJob(tx, third, { status: "failed", reason: "request" }))).toBe(true);
    expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "failed", reviewStatus: "pending" });
    await saved.deleteSavedItem(owner, item.id);
    expect(await db.savedItemMetadataJob.count()).toBe(0);
  });

  it("resolves share, manual and legacy titles without changing create retries when the flag flips", async () => {
    const shared = savedItemCreateSchema.parse({
      sharedTitle: "Android SEO title", url: "https://example.org/article",
    });
    const key = "android-title";
    vi.stubEnv("SAVED_ITEM_TITLE_ORIGINS", "0");
    try {
      const { item } = await saved.createSavedItem(owner, key, shared, []);
      expect(item).toMatchObject({ title: "", titleOrigin: "share", displayTitle: "Android SEO title" });
      const legacy = await db.savedItem.create({
        data: { userId: owner, title: "Original legacy", titleOrigin: "legacy", metadataTitle: "Website title" },
      });
      const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
      const { searchNotebook } = await import("./search-service");
      const signal = new AbortController().signal;
      expect(await processSavedMetadataJob(signal, async () => ({
        metadataTitle: "Website title", metadataDescription: null, metadataSiteName: "Example", metadataImageUrl: null,
      }))).toBe(true);
      expect((await saved.getSavedItem(owner, item.id)).displayTitle).toBe("Android SEO title");
      await expect(saved.updateSavedItem(owner, item.id, { useWebsiteTitle: true })).rejects.toMatchObject({ status: 409 });

      vi.stubEnv("SAVED_ITEM_TITLE_ORIGINS", "1");
      expect(await saved.createSavedItem(owner, key, shared, [])).toMatchObject({
        replayed: true, item: { id: item.id, displayTitle: "Website title", sharedTitle: "Android SEO title" },
      });
      await expect(saved.createSavedItem(owner, key, { ...shared, sharedTitle: "Another share" }, []))
        .rejects.toMatchObject({ status: 409 });
      expect((await saved.getSavedItem(owner, legacy.id)).displayTitle).toBe("Original legacy");
      expect((await saved.listSavedItems(owner, { ...list, q: "Android" })).items[0].displayTitle).toBe("Website title");
      expect((await searchNotebook(owner, "Android")).results[0]).toMatchObject({ id: item.id, title: "Website title" });

      expect(await saved.updateSavedItem(owner, item.id, { title: "My title" })).toMatchObject({ titleOrigin: "manual" });
      await db.savedItem.update({ where: { id: item.id }, data: { metadataTitle: "Updated website title" } });
      expect((await saved.getSavedItem(owner, item.id)).displayTitle).toBe("My title");
      expect(await saved.updateSavedItem(owner, item.id, { useWebsiteTitle: true })).toMatchObject({
        title: "", titleOrigin: "system", displayTitle: "Updated website title", sharedTitle: "Android SEO title",
      });
      const { pageId } = await saved.convertSavedItem(owner, item.id, sectionId, "convert-site-title");
      expect(await db.page.findUnique({ where: { id: pageId } })).toMatchObject({ title: "Updated website title" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stores fetched metadata atomically and searches only owned, active materials", async () => {
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const { searchNotebook } = await import("./search-service");
    const metadata = {
      metadataTitle: "Workshop Transcription", metadataDescription: "Seminar handout",
      metadataSiteName: "Fieldnotes", metadataImageUrl: "https://example.com/preview.png",
    };
    const signal = new AbortController().signal;
    const { item } = await saved.createSavedItem(owner, "searchable", { ...input, url: "https://example.com/docs/", tags: ["reference"] }, []);
    const foreign = await saved.createSavedItem(other, "foreign", { ...input, text: "Workshop Transcription" }, []);
    await saved.updateSavedItem(owner, item.id, { title: "Моё название" });
    expect(await processSavedMetadataJob(signal, async () => metadata)).toBe(true);
    const hydrated = await saved.getSavedItem(owner, item.id);
    expect(hydrated).toMatchObject({
      title: "Моё название", metadataStatus: "ready", reviewStatus: "pending",
      metadata: { title: metadata.metadataTitle, description: metadata.metadataDescription, siteName: "Fieldnotes", hasPreview: true },
    });
    expect(hydrated).not.toHaveProperty("metadataImageUrl");
    expect(await db.upload.count({ where: { userId: owner } })).toBe(0);
    for (const query of ["Workshop Transcription", "handout", "Fieldnotes", "example.com", "reference", "#reference", "original handout"]) {
      const results = (await searchNotebook(owner, query)).results;
      expect(results.filter(result => result.type === "savedItem").map(result => result.id)).toEqual([item.id]);
      expect(results.map(result => result.id)).not.toContain(foreign.item.id);
    }
    expect((await searchNotebook(owner, "handout", 25, 0, { sectionId })).results.some(result => result.type === "savedItem")).toBe(false);
    const { notebookId } = await db.section.findUniqueOrThrow({ where: { id: sectionId }, select: { notebookId: true } });
    expect((await searchNotebook(owner, "handout", 25, 0, { notebookId })).results.some(result => result.type === "savedItem")).toBe(false);
    await saved.updateSavedItem(owner, item.id, { archived: true });
    expect((await searchNotebook(owner, "handout")).results).toEqual([]);
    expect((await saved.listSavedItems(owner, { ...list, archive: "archived", q: "handout" })).items[0].id).toBe(item.id);
  });

  it("preserves the source after SSRF rejection and allows owner-only manual retry after exhaustion", async () => {
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const signal = new AbortController().signal;
    const blocked = await saved.createSavedItem(owner, "blocked", { ...input, url: "http://127.0.0.1/" }, []);
    expect(await processSavedMetadataJob(signal)).toBe(true);
    expect(await saved.getSavedItem(owner, blocked.item.id)).toMatchObject({
      metadataStatus: "failed", url: "http://127.0.0.1/", text: input.text, reviewStatus: "pending",
    });
    await expect(saved.retrySavedItemMetadata(other, blocked.item.id)).rejects.toMatchObject({ status: 404 });
    await expect(saved.retrySavedItemMetadata(owner, blocked.item.id)).rejects.toMatchObject({ status: 409 });
    const { item } = await saved.createSavedItem(owner, "exhausted", { ...input, url: "https://example.com/" }, []);
    await db.savedItemMetadataJob.update({
      where: { savedItemId: item.id }, data: { attempts: queue.MAX_METADATA_ATTEMPTS, availableAt: new Date(0), leaseToken: "abandoned" },
    });
    expect(await queue.claimSavedItemMetadataJob()).toBeNull();
    expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "failed" });
    await db.savedItemMetadataJob.update({ where: { savedItemId: item.id }, data: { finishedAt: new Date(0) } });
    const retries = await Promise.allSettled([saved.retrySavedItemMetadata(owner, item.id), saved.retrySavedItemMetadata(owner, item.id)]);
    expect(retries.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await queue.claimSavedItemMetadataJob()).toMatchObject({ savedItemId: item.id, attempts: 1 });
  });

  it("queues previews for video and social links and reserves article jobs for the HTML path", async () => {
    vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", "1");
    try {
      const links = [
        ["video", "https://youtu.be/testVideo_1"], ["video", "https://vk.com/clip-123_456"],
        ["social", "https://threads.com/@notes/post/Cabc123"], ["article", "https://example.org/story"],
      ];
      for (const [index, [linkKind, url]] of links.entries()) {
        const { item } = await saved.createSavedItem(owner, `capture-${index}`, { ...input, url }, []);
        expect(item).toMatchObject({ linkKind, hasSavedArticle: false, metadataStatus: "queued" });
        expect(Boolean(await db.savedArticleJob.findUnique({ where: { savedItemId: item.id } }))).toBe(linkKind === "article");
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([
    ["dns", Object.assign(new Error("private response"), { code: "ENOTFOUND" })],
    ["tls", Object.assign(new Error("private response"), { code: "CERT_HAS_EXPIRED" })],
    ["timeout", new DOMException("private response", "TimeoutError")],
    ["http", new SavedMetadataError(false, "http", 404)],
    ["access", new SavedMetadataError(false, "http", 403)],
    ["request", new Error("private response")],
  ])("stores only the normalized %s failure and keeps the Android title", async (reason, failure) => {
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const url = "https://threads.com/@notes/post/Cabc123?secret=private";
    const { item } = await saved.createSavedItem(owner, `failure-${reason}`, savedItemCreateSchema.parse({ url, sharedTitle: "Android title" }), []);
    const where = { savedItemId: item.id };
    await db.savedItemMetadataJob.update({ where, data: { attempts: queue.MAX_METADATA_ATTEMPTS - 1 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const signal = new AbortController().signal;
      expect(await processSavedMetadataJob(signal, async () => { throw failure; })).toBe(true);
      const httpStatus = failure instanceof SavedMetadataError ? failure.httpStatus : undefined;
      expect(warn.mock.calls).toEqual([["Notebook saved metadata unavailable", { provider: "threads", attempts: queue.MAX_METADATA_ATTEMPTS, reason, httpStatus }]]);
      expect(await db.savedItemMetadataJob.findUniqueOrThrow({ where })).toMatchObject({ failureReason: reason, failed: true });
      expect(await saved.getSavedItem(owner, item.id)).toMatchObject({
        linkKind: "social", displayTitle: "Android title", sharedTitle: "Android title", metadataStatus: "failed", metadataFailure: reason,
      });
      await db.savedItemMetadataJob.update({ where, data: { finishedAt: new Date(0) } });
      expect(await saved.retrySavedItemMetadata(owner, item.id)).toMatchObject({ metadataStatus: "queued", metadataFailure: null });
    } finally { warn.mockRestore(); }
  });

  it("finishes a page without preview metadata and preserves the shared title", async () => {
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const url = "https://vk.com/clip-123_456";
    const { item } = await saved.createSavedItem(owner, "no-preview", savedItemCreateSchema.parse({ url, sharedTitle: "Android title" }), []);
    const body = await readFile(new URL("../fixtures/saved-links/no-preview.html", import.meta.url));
    expect(await processSavedMetadataJob(new AbortController().signal, (source, signal) => fetchSavedMetadata(source, signal,
      async target => ({ url: new URL(target), body, mimeType: "text/html", contentType: "text/html" })))).toBe(true);
    expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ displayTitle: "Android title", metadataStatus: "empty", metadataFailure: null });
  });

  it("logs retry and lease exhaustion without inventing a network failure for an abandoned job", async () => {
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const { item } = await saved.createSavedItem(owner, "youtube-lease", {
      ...input, url: "https://youtu.be/testVideo_1?private=fixture",
    }, []);
    const where = { savedItemId: item.id };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const signal = new AbortController().signal;
      const fetch = vi.fn(async () => { throw new DOMException("private response", "TimeoutError"); });
      expect(await processSavedMetadataJob(signal, fetch)).toBe(true);
      expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "queued", metadataFailure: null });
      await db.savedItemMetadataJob.update({ where, data: { availableAt: new Date(0), attempts: queue.MAX_METADATA_ATTEMPTS } });
      expect(await processSavedMetadataJob(signal, fetch)).toBe(false);
      expect(fetch).toHaveBeenCalledOnce();
      expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "failed", metadataFailure: null });
      expect(warn.mock.calls).toEqual([
        ["Notebook saved metadata will retry", { provider: "youtube", attempts: 1, reason: "timeout", httpStatus: undefined }],
        ["Notebook saved metadata lease expired", { attempts: queue.MAX_METADATA_ATTEMPTS }],
      ]);
    } finally { warn.mockRestore(); }
  });

  it("persists a YouTube cover from oEmbed separately from the share title", async () => {
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const url = "https://youtu.be/testVideo_1";
    const { item } = await saved.createSavedItem(owner, "youtube-cover", savedItemCreateSchema.parse({ url, sharedTitle: "Android title" }), []);
    expect(item).toMatchObject({ displayTitle: "Android title", metadataStatus: "queued", metadata: { hasPreview: false } });
    const body = await readFile(new URL("../fixtures/saved-links/youtube.json", import.meta.url));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const run = (data: Buffer<ArrayBuffer>) => processSavedMetadataJob(new AbortController().signal,
        (source, signal) => fetchSavedMetadata(source, signal, async target => ({
          url: new URL(target), body: data, mimeType: "application/json", contentType: "application/json",
        })));
      expect(await run(Buffer.from('{"version":"1.0","type":"video","title":"Title without cover"}'))).toBe(true);
      expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "ready", metadata: { hasPreview: false } });
      await db.savedItemMetadataJob.update({ where: { savedItemId: item.id }, data: { finishedAt: new Date(0) } });
      await saved.retrySavedItemMetadata(owner, item.id);
      expect(await run(body)).toBe(true);
      expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "ready", metadata: {
        title: "Звук дождя в сосновом лесу", siteName: "YouTube · Тихие маршруты", hasPreview: true,
      } });
      expect(await db.savedItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
        metadataImageUrl: "https://i.ytimg.com/vi/testVideo_1/hqdefault.jpg",
      });
      expect(info.mock.calls).toEqual([
        ["Notebook saved oEmbed has no usable thumbnail", { provider: "youtube" }],
        ["Notebook saved oEmbed thumbnail stored", { provider: "youtube" }],
      ]);
    } finally { info.mockRestore(); }
  });

  it("checks article access and metadata independently without overwriting a known title", async () => {
    const { processSavedArticleJob } = await import("./saved-article-worker");
    const { fetchSavedArticle } = await import("@/lib/saved-article-extraction");
    const { processSavedMetadataJob } = await import("./saved-item-metadata-worker");
    const url = "https://club.dns-shop.ru/blog/example/";
    const { item } = await saved.createSavedItem(owner, "dns-club", savedItemCreateSchema.parse({ url, sharedTitle: "Заголовок Android" }), []);
    const where = { id: item.id };
    await db.savedItem.update({ where, data: { metadataTitle: "Проверенный заголовок", metadataDescription: "Описание статьи" } });
    await db.savedArticleJob.upsert({
      where: { savedItemId: item.id }, update: {}, create: { savedItemId: item.id, sourceUrl: url, generation: "dns-club" },
    });
    const signal = new AbortController().signal;
    const resolve = async () => [{ address: "93.184.215.14", family: 4 }];
    const restricted: typeof fetchSavedMetadataResource = (value, options) =>
      fetchSavedMetadataResource(value, options, {
        resolve,
        request: async () => ({ statusCode: 401, headers: {}, destroy() {}, async *[Symbol.asyncIterator]() {} }),
      });
    expect(await processSavedArticleJob(signal, (source, abort) => fetchSavedArticle(source, abort, restricted))).toBe(true);
    expect(await db.savedArticleJob.findUniqueOrThrow({ where: { savedItemId: item.id } })).toMatchObject({ status: "fallback", reason: "access" });
    expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ metadataStatus: "queued", hasSavedArticle: false });
    const blockedHtml = Buffer.from('<title>Доступ ограничен | Клуб DNS</title><meta property="og:title" content="Служебный заголовок">');
    expect(await processSavedMetadataJob(signal, (source, abort) => fetchSavedMetadata(source, abort, async value => ({
      url: new URL(value), body: blockedHtml, mimeType: "text/html", contentType: "text/html",
    })))).toBe(true);
    expect(await saved.getSavedItem(owner, item.id)).toMatchObject({
      url, metadataStatus: "failed", metadataFailure: "access", hasSavedArticle: false, sharedTitle: "Заголовок Android",
      metadata: { title: "Проверенный заголовок", description: "Описание статьи" },
    });
    await db.savedItem.update({ where, data: { metadataTitle: "Доступ ограничен | Клуб DNS" } });
    expect(await saved.getSavedItem(owner, item.id)).toMatchObject({ url, metadata: { title: null }, displayTitle: "Заголовок Android" });
  });

  it("preserves saved-only files on v5 restore and restores converted PDF references", async () => {
    const [standalone, converted] = await Promise.all(["standalone", "converted"].map(async key => (
      await saved.createSavedItem(owner, key, { ...input, title: key }, [await prepareUpload(pdf(), true)])
    ).item));
    await saved.convertSavedItem(owner, converted.id, sectionId, "transfer");
    const { buildPortableExport } = await import("./export-service");
    const { createZipArchive } = await import("@/lib/archive");
    const { prepareImport, restoreBackupData, disposePreparedImport } = await import("./import-service");
    const archivePath = path.join(directory, "v5.zip");
    const built = await buildPortableExport(owner, { includeDeleted: true, includeHistory: true, backup: true });
    const { savedItems, ...legacy } = built.data;
    const convertedAttachment = savedItems!.find(item => item.title === "converted")!.attachmentKeys[0];
    const files = legacy.attachments.filter(file => file.key === convertedAttachment);
    await createZipArchive(archivePath, async zip => {
      zip.append(JSON.stringify({ ...built.manifest, version: 5, attachmentCount: files.length }), { name: "manifest.json" });
      zip.append(JSON.stringify({ ...legacy, attachments: files }), { name: "backup.json" });
      for (const file of files) zip.file(built.attachmentFiles.get(file.archivePath!)!, { name: file.archivePath! });
    });
    const prepared = await prepareImport(new Request("http://local/restore", {
      method: "POST", headers: { "content-type": "application/zip" }, body: await readFile(archivePath),
    }), "backup");
    try {
      expect(prepared.manifest?.version).toBe(5);
      expect(prepared.data?.attachments).toHaveLength(1);
      await restoreBackupData(owner, prepared);
      for (const item of [standalone, converted]) {
        const restored = await saved.getSavedItem(owner, item.id);
        expect(restored.attachments).toEqual(item.attachments);
        const upload = await db.upload.findUniqueOrThrow({ where: { id: restored.attachments[0].id } });
        expect(await readFile(path.join(directory, upload.storageName), "utf8")).toMatch(/^%PDF-/);
      }
      const page = await db.page.findFirstOrThrow({ where: { section: { notebook: { userId: owner } } } });
      expect(page.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "file", props: expect.objectContaining({ url: expect.stringMatching(/^\/api\/uploads\//) }) })]));
      expect(await db.upload.count({ where: { userId: owner, mimeType: "application/pdf" } })).toBe(3);
      await expect(saved.convertSavedItem(owner, converted.id, sectionId, "transfer")).rejects.toMatchObject({ status: 410 });
    } finally {
      await disposePreparedImport(prepared);
    }
  });
});
