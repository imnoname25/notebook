import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createZipArchive } from "@/lib/archive";
import { type ArchiveData, type DataManifest } from "@/lib/data-format";
import { savedItemCreateSchema } from "@/lib/saved-item-validation";
import * as storage from "@/lib/storage";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("Saved Articles portable backup v7", () => {
  let db: typeof import("@/lib/db").db;
  let exports: typeof import("./export-service");
  let imports: typeof import("./import-service");
  let directory: string;
  let owner: string;
  let itemId: string;
  let storageName: string;
  let raster: Buffer;
  const previousUploads = process.env.UPLOAD_DIR;
  const previousBackups = process.env.BACKUP_DIR;
  const firstKey = "a".repeat(64);
  const missingKey = "b".repeat(64);
  const sourceUrl = "https://offline.example/article";
  const timestamp = new Date("2026-11-01T10:20:30.000Z");
  const options = { includeDeleted: true, includeHistory: true, backup: true };

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), "notebook-backup-v7-"));
    process.env.UPLOAD_DIR = path.join(directory, "uploads");
    process.env.BACKUP_DIR = path.join(directory, "backups");
    ({ db } = await import("@/lib/db"));
    exports = await import("./export-service");
    imports = await import("./import-service");
    raster = await sharp({ create: { width: 24, height: 24, channels: 3, background: "teal" } }).webp().toBuffer();
  });
  beforeEach(async () => {
    await db.user.deleteMany();
    const user = await db.user.create({ data: { email: "backup-v7@test.local", name: "Backup", passwordHash: "unused" } });
    owner = user.id;
    storageName = `${owner}/local.webp`;
    await fs.mkdir(path.dirname(storage.resolveStoragePath(storageName)), { recursive: true });
    await fs.writeFile(storage.resolveStoragePath(storageName), raster);
    const upload = await db.upload.create({ data: {
      userId: owner, storageName, originalName: "local.webp", mimeType: "image/webp",
      size: raster.length, sha256: createHash("sha256").update(raster).digest("hex"),
    } });
    const tag = await db.tag.create({ data: { userId: owner, name: "Offline", normalized: "offline" } });
    const item = await db.savedItem.create({ data: {
      userId: owner, title: "", titleOrigin: "share", sharedTitle: "Shared original", text: "User text", url: sourceUrl,
      reviewStatus: "reviewed", archivedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      metadataTitle: "Website title", metadataDescription: "Description", metadataSiteName: "Offline",
      tags: { create: { tagId: tag.id } }, attachments: { create: { uploadId: upload.id, position: 0 } },
      article: { create: {
        contentVersion: 2, sourceUrl, extractedAt: timestamp,
        blocks: [{ type: "paragraph", content: [{ type: "text", text: "Read this without the original site." }] },
          { type: "image", key: firstKey, alt: "Local image" }, { type: "image", key: missingKey, alt: "Unavailable" }],
        images: { create: [
          { imageKey: firstKey, sourceUrl: "https://offline.example/one.webp", position: 0, uploadId: upload.id },
          { imageKey: missingKey, sourceUrl: "https://offline.example/missing.webp", position: 1 },
        ] },
      } },
    } });
    itemId = item.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS backup_v7_reject ON "SavedArticle"');
    await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS backup_v7_reject()");
  });
  afterAll(async () => {
    await db?.$disconnect();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    if (previousUploads === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploads;
    if (previousBackups === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = previousBackups;
  });

  async function prepare(file: string, backup = true) {
    return imports.prepareImport(new Request("http://localhost/import", {
      method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(await fs.readFile(file)),
    }), backup ? "backup" : "import");
  }
  async function archive(mutate?: (data: ArchiveData, manifest: DataManifest) => void, backup = true) {
    const built = await exports.buildPortableExport(owner, { ...options, backup });
    mutate?.(built.data, built.manifest);
    const file = path.join(directory, `archive-${Math.random()}.zip`);
    await createZipArchive(file, async zip => {
      zip.append(JSON.stringify(built.manifest), { name: "manifest.json" });
      zip.append(JSON.stringify(built.data), { name: backup ? "backup.json" : "notebook.json" });
      for (const [name, source] of built.attachmentFiles) zip.file(source, { name });
    });
    return file;
  }
  async function restoredItem() {
    return db.savedItem.findFirstOrThrow({ where: { userId: owner }, include: {
      tags: { include: { tag: true } }, attachments: true, article: { include: { images: { orderBy: { position: "asc" }, include: { upload: true } } } },
    } });
  }

  it("round-trips share-only and title-cleared materials through import, restore and safety backup", async () => {
    const saved = await import("./saved-item-service");
    const capture = (data: unknown) => saved.createSavedItem(owner, randomUUID(), savedItemCreateSchema.parse(data), []);
    await expect(capture({})).rejects.toMatchObject({ status: 400 });
    const share = await capture({ sharedTitle: "Share only", tags: ["#shareonly"] });
    const cleared = await capture({ title: "To be cleared", tags: ["#cleared"] });
    expect(share.item).toMatchObject({ title: "", titleOrigin: "share", sharedTitle: "Share only" });
    expect(await saved.updateSavedItem(owner, cleared.item.id, { title: "" })).toMatchObject({
      title: "", titleOrigin: "system", sharedTitle: null,
    });
    const expected = expect.arrayContaining([
      expect.objectContaining({ title: "", titleOrigin: "share", sharedTitle: "Share only", text: "", url: null, attachmentKeys: [] }),
      expect.objectContaining({ title: "", titleOrigin: "system", sharedTitle: null, text: "", url: null, attachmentKeys: [],
        tags: [expect.objectContaining({ normalized: "cleared" })] }),
    ]);
    const fullExport = path.join(directory, "retained-title-states.zip");
    await exports.writePortableArchive(owner, fullExport, { ...options, backup: false });
    const prepared = await prepare(fullExport, false);
    try {
      expect(prepared.manifest?.version).toBe(7);
      expect(prepared.data?.savedItems).toEqual(expected);
      const target = await db.user.create({ data: { email: "title-states@test.local", name: "Target", passwordHash: "unused" } });
      await imports.commitImport(target.id, prepared);
      expect((await exports.buildPortableExport(target.id, { ...options, backup: false })).data.savedItems).toEqual(expected);
    } finally { await imports.disposePreparedImport(prepared); }

    const backupFile = path.join(directory, "retained-title-backup.zip");
    await exports.writePortableArchive(owner, backupFile, options);
    const { restoreUploadedBackup } = await import("./backup-restore-service");
    const result = await restoreUploadedBackup(owner, new Request("http://localhost/restore", {
      method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(await fs.readFile(backupFile)),
    }));
    expect((await exports.buildPortableExport(owner, options)).data.savedItems).toEqual(expected);
    const backup = await import("./backup-service");
    const safety = await prepare((await backup.backupRecordFile(result.safetyBackupId)).filePath);
    try {
      expect(safety.data?.savedItems).toEqual(expected);
      await imports.restoreBackupData(owner, safety);
      expect((await exports.buildPortableExport(owner, options)).data.savedItems).toEqual(expected);
    } finally { await imports.disposePreparedImport(safety); }
  });

  it.each([2, 3, 6])("restores %i blocks sharing one image and cleans up its single file", async count => {
    const blocks = Array.from({ length: count }, (_, index) => ({ type: "image", key: firstKey, alt: `Reference ${index}` }));
    await db.$transaction([
      db.savedArticleImage.delete({ where: { savedItemId_imageKey: { savedItemId: itemId, imageKey: missingKey } } }),
      db.savedArticle.update({ where: { savedItemId: itemId }, data: { blocks } }),
    ]);
    const checkArchive = (data: ArchiveData | undefined) => {
      expect(data?.attachments).toHaveLength(1);
      expect(data?.savedItems?.[0].article).toMatchObject({ blocks, images: [{ imageKey: firstKey }] });
      expect(data?.attachments[0].sha256).toBe(createHash("sha256").update(raster).digest("hex"));
    };
    const exported = path.join(directory, `repeated-${count}-export.zip`);
    await exports.writePortableArchive(owner, exported, { ...options, backup: false });
    const prepared = await prepare(exported, false);
    const target = await db.user.create({ data: { email: "repeated-images@test.local", name: "Target", passwordHash: "unused" } });
    try {
      checkArchive(prepared.data);
      await imports.commitImport(target.id, prepared);
      checkArchive((await exports.buildPortableExport(target.id, options)).data);
      expect(await db.upload.count({ where: { userId: target.id } })).toBe(1);
    } finally { await imports.disposePreparedImport(prepared); }

    const file = path.join(directory, `repeated-${count}-backup.zip`);
    await exports.writePortableArchive(owner, file, options);
    const { restoreUploadedBackup } = await import("./backup-restore-service");
    await restoreUploadedBackup(owner, new Request("http://localhost/restore", {
      method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(await fs.readFile(file)),
    }));
    const copy = await restoredItem();
    expect(copy.article?.blocks).toEqual(blocks);
    expect(copy.article?.images).toHaveLength(1);
    const local = copy.article!.images[0].upload!;
    expect(createHash("sha256").update(await fs.readFile(storage.resolveStoragePath(local.storageName))).digest("hex")).toBe(local.sha256);
    expect(copy.attachments[0].uploadId).toBe(local.id);
    const { cleanupStorage } = await import("./attachment-service");
    expect(await cleanupStorage(owner)).toMatchObject({ removed: 0 });
    await (await import("./saved-item-service")).deleteSavedItem(owner, copy.id);
    expect(await cleanupStorage(owner)).toMatchObject({ removed: 1 });
    expect(await db.upload.count({ where: { userId: owner } })).toBe(0);
    await expect(fs.stat(storage.resolveStoragePath(local.storageName))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("round-trips archived articles, provenance, tags, dates, user attachments and missing external images offline", async () => {
    const file = path.join(directory, "full-export.zip");
    await exports.writePortableArchive(owner, file, { ...options, backup: false });
    const prepared = await prepare(file, false);
    expect(prepared.manifest?.version).toBe(7);
    expect(JSON.stringify(prepared.data)).not.toMatch(/leaseToken|attempts|generation|SavedArticleJob/);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
    const target = await db.user.create({ data: { email: "target@test.local", name: "Target", passwordHash: "unused" } });
    try {
      await imports.commitImport(target.id, prepared);
      const copy = await db.savedItem.findFirstOrThrow({ where: { userId: target.id }, include: {
        tags: { include: { tag: true } }, attachments: true, article: { include: { images: { include: { upload: true } } } },
      } });
      expect(copy).toMatchObject({ title: "", titleOrigin: "share", sharedTitle: "Shared original", text: "User text",
        reviewStatus: "reviewed", archivedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, metadataTitle: "Website title" });
      expect(copy.id).not.toBe(itemId);
      expect(copy.tags[0].tag.normalized).toBe("offline");
      expect(copy.article?.images.find(image => image.imageKey === missingKey)?.uploadId).toBeNull();
      const image = copy.article!.images.find(image => image.imageKey === firstKey)!;
      expect(image.upload?.userId).toBe(target.id);
      expect(copy.attachments[0].uploadId).toBe(image.uploadId);
      expect(await fs.readFile(storage.resolveStoragePath(image.upload!.storageName))).toEqual(raster);
      const reader = await import("./saved-article-reader");
      const read = await reader.readSavedArticle(target.id, copy.id);
      expect(read.article?.blocks).toEqual(prepared.data!.savedItems![0].article!.blocks);
      const response = await reader.readSavedArticleImage(target.id, copy.id, firstKey);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(raster);
      expect(await db.savedArticleJob.count({ where: { savedItemId: copy.id } })).toBe(0);
      expect(await db.savedItemMetadataJob.count({ where: { savedItemId: copy.id, finishedAt: null } })).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("restores a video card with an older local copy and omits operational metadata diagnostics from v7", async () => {
    const url = "https://youtu.be/testVideo_1";
    await db.savedItem.update({ where: { id: itemId }, data: {
      url, metadataSiteName: "YouTube · Channel", metadataJob: { create: { failed: true, failureReason: "access", finishedAt: timestamp } },
      article: { update: { sourceUrl: url } },
    } });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must stay offline"));
    const prepared = await prepare(await archive());
    try {
      expect(prepared.manifest?.version).toBe(7);
      expect(prepared.data!.savedItems![0]).toMatchObject({ url, metadata: { siteName: "YouTube · Channel" }, article: { sourceUrl: url } });
      expect(JSON.stringify(prepared.data)).not.toMatch(/failureReason|metadataJob/);
      await imports.restoreBackupData(owner, prepared);
      const restored = await restoredItem();
      const saved = await import("./saved-item-service");
      expect(await saved.getSavedItem(owner, restored.id)).toMatchObject({
        linkKind: "video", hasSavedArticle: true, metadataStatus: "ready", metadataFailure: null,
      });
      expect(await db.savedArticleJob.findUnique({ where: { savedItemId: restored.id } })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("operational restore replaces v7 Saved Items and fences an active old worker", async () => {
    const prepared = await prepare(await archive());
    const token = "old-token";
    await db.savedArticleJob.create({ data: { savedItemId: itemId, sourceUrl, generation: "old-generation", status: "running",
      leaseToken: token, leaseUntil: new Date(Date.now() + 60_000) } });
    try {
      await imports.restoreBackupData(owner, prepared);
      const copy = await restoredItem();
      expect(copy.id).not.toBe(itemId);
      expect(copy.article?.images).toHaveLength(2);
      expect(await db.savedArticleJob.count()).toBe(0);
      const queue = await import("./saved-article-queue");
      expect(await queue.settleSavedArticleJob({ savedItemId: itemId, userId: owner, sourceUrl, generation: "old-generation", attempts: 1, leaseToken: token },
        { status: "ready", blocks: [{ type: "paragraph", content: [{ type: "text", text: "Stale" }] }] })).toBe(false);
      expect(await fs.readFile(storage.resolveStoragePath(copy.article!.images[0].upload!.storageName))).toEqual(raster);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it.each([1, 2, 3, 4, 5, 6])("reads legacy v%i and preserves its Saved Items replacement semantics", async version => {
    const prepared = await prepare(await archive((data, manifest) => {
      manifest.version = version as DataManifest["version"];
      if (version < 6) delete data.savedItems;
      else for (const item of data.savedItems!) { delete item.article; delete item.titleOrigin; delete item.sharedTitle; item.title = "Legacy title"; }
    }));
    try {
      await imports.restoreBackupData(owner, prepared);
      const copy = await restoredItem();
      expect(copy.id === itemId).toBe(version < 6);
      expect(copy.article === null).toBe(version === 6);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("reads stage A v6 provenance without imposing v7 article fields", async () => {
    const prepared = await prepare(await archive((data, manifest) => {
      manifest.version = 6;
      for (const item of data.savedItems!) delete item.article;
    }));
    try { await imports.restoreBackupData(owner, prepared); expect(await restoredItem()).toMatchObject({ titleOrigin: "share", sharedTitle: "Shared original" }); }
    finally { await imports.disposePreparedImport(prepared); }
  });

  it.each([5, 6])("keeps the mandatory SHA-256 boundary at v6 when reading v%i", async version => {
    const file = await archive((data, manifest) => {
      manifest.version = version as DataManifest["version"];
      data.attachments[0].sha256 = null;
      if (version < 6) delete data.savedItems;
      else for (const item of data.savedItems!) delete item.article;
    });
    if (version === 6) await expect(prepare(file)).rejects.toMatchObject({ status: 400 });
    else {
      const prepared = await prepare(file);
      await imports.disposePreparedImport(prepared);
    }
  });

  it.each([1, 2, 3, 4, 5, 6])("imports v%i without replacing existing Saved Items", async version => {
    const prepared = await prepare(await archive((data, manifest) => {
      manifest.version = version as DataManifest["version"];
      if (version < 6) delete data.savedItems;
      else for (const item of data.savedItems!) delete item.article;
    }, false), false);
    try {
      await imports.commitImport(owner, prepared);
      expect(await db.savedItem.findUnique({ where: { id: itemId } })).not.toBeNull();
      expect(await db.savedItem.count({ where: { userId: owner } })).toBe(version === 6 ? 2 : 1);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it.each(["hash", "missing", "duplicate-key", "foreign-upload", "mime", "block", "version"])("rejects invalid %s before replacing user data", async problem => {
    const file = await archive((data, manifest) => {
      const article = data.savedItems![0].article!;
      if (problem === "hash") data.attachments[0].sha256 = "0".repeat(64);
      if (problem === "missing") data.attachments[0].archivePath = "attachments/missing.webp";
      if (problem === "duplicate-key") article.images[1].imageKey = firstKey;
      if (problem === "foreign-upload") article.images[0].attachmentKey = "foreign-user-upload-id";
      if (problem === "mime") data.attachments[0].mimeType = "application/pdf";
      if (problem === "block") article.blocks.push({ type: "image", key: "bad", alt: "Invalid" });
      if (problem === "version") Object.assign(manifest, { version: 8 });
    });
    await expect(prepare(file)).rejects.toBeDefined();
    expect((await restoredItem()).id).toBe(itemId);
  });

  it("rejects corrupt ZIP and missing locally stored images during export", async () => {
    const file = path.join(directory, "broken.zip");
    await fs.writeFile(file, "PK-broken");
    await expect(prepare(file)).rejects.toBeDefined();
    await fs.rm(storage.resolveStoragePath(storageName));
    await expect(exports.writePortableArchive(owner, file, options)).rejects.toMatchObject({ status: 409 });
    expect((await restoredItem()).id).toBe(itemId);
  });

  it("rejects undecodable article image content even when its size, signature and SHA-256 agree", async () => {
    const broken = raster.subarray(0, 16);
    await fs.writeFile(storage.resolveStoragePath(storageName), broken);
    await db.upload.updateMany({ where: { userId: owner }, data: {
      size: broken.length, sha256: createHash("sha256").update(broken).digest("hex"),
    } });
    await expect(exports.writePortableArchive(owner, path.join(directory, "bad-image.zip"), options)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an archive with a damaged raster whose SHA-256 has been recalculated", async () => {
    const built = await exports.buildPortableExport(owner, options);
    const broken = raster.subarray(0, 16);
    built.data.attachments[0].size = broken.length;
    built.data.attachments[0].sha256 = createHash("sha256").update(broken).digest("hex");
    const file = path.join(directory, "bad-raster.zip");
    await createZipArchive(file, async zip => {
      zip.append(JSON.stringify(built.manifest), { name: "manifest.json" });
      zip.append(JSON.stringify(built.data), { name: "backup.json" });
      zip.append(broken, { name: built.data.attachments[0].archivePath! });
    });
    await expect(prepare(file)).rejects.toMatchObject({ status: 400 });
    expect((await restoredItem()).id).toBe(itemId);
  });

  it("rolls back all rows and staged files on an article insert transaction failure", async () => {
    const prepared = await prepare(await archive());
    const before = await fs.readdir(path.dirname(storage.resolveStoragePath(storageName)));
    await db.$executeRawUnsafe("CREATE FUNCTION backup_v7_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected transaction failure'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER backup_v7_reject BEFORE INSERT ON "SavedArticle" FOR EACH ROW EXECUTE FUNCTION backup_v7_reject()');
    try {
      await expect(imports.restoreBackupData(owner, prepared)).rejects.toBeDefined();
      expect((await restoredItem()).id).toBe(itemId);
      expect(await fs.readdir(path.dirname(storage.resolveStoragePath(storageName)))).toEqual(before);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("leaves existing rows and files intact when a disk write fails", async () => {
    const prepared = await prepare(await archive());
    const before = await fs.readdir(path.dirname(storage.resolveStoragePath(storageName)));
    vi.spyOn(fs, "copyFile").mockRejectedValueOnce(Object.assign(new Error("Disk full"), { code: "ENOSPC" }));
    try {
      await expect(imports.restoreBackupData(owner, prepared)).rejects.toMatchObject({ code: "ENOSPC" });
      expect((await restoredItem()).id).toBe(itemId);
      expect(await fs.readdir(path.dirname(storage.resolveStoragePath(storageName)))).toEqual(before);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("excludes global Saved Items from a single notebook export", async () => {
    const notebook = await db.notebook.create({ data: { userId: owner, title: "Only notebook" } });
    const built = await exports.buildPortableExport(owner, { ...options, notebookId: notebook.id, backup: false });
    expect(built.data.savedItems).toBeUndefined();
    expect(built.data.attachments).toEqual([]);
  });

  it("creates a verified v7 safety backup before operational restore and can restore that copy", async () => {
    const file = await archive();
    await db.savedItem.update({ where: { id: itemId }, data: { text: "Latest user change" } });
    const service = await import("./backup-restore-service");
    const result = await service.restoreUploadedBackup(owner, new Request("http://localhost/restore", {
      method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(await fs.readFile(file)),
    }));
    expect((await restoredItem()).text).toBe("User text");
    const backup = await import("./backup-service");
    const safety = await backup.backupRecordFile(result.safetyBackupId);
    const prepared = await prepare(safety.filePath);
    try {
      expect(prepared.manifest?.version).toBe(7);
      expect(prepared.data!.savedItems![0].text).toBe("Latest user change");
      await imports.restoreBackupData(owner, prepared);
      const copy = await restoredItem();
      expect(copy.text).toBe("Latest user change");
      expect(await fs.readFile(storage.resolveStoragePath(copy.article!.images[0].upload!.storageName))).toEqual(raster);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("serializes export with article replacement, deletion and Upload cleanup", async () => {
    const original = storage.sha256File;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const inside = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(storage, "sha256File").mockImplementationOnce(async file => {
      entered(); await gate; return original(file);
    });
    const file = path.join(directory, "concurrent.zip");
    const exporting = exports.writePortableArchive(owner, file, options);
    await inside;
    const { deleteSavedItem } = await import("./saved-item-service");
    const { cleanupStorage } = await import("./attachment-service");
    let deleted = false;
    const deleting = deleteSavedItem(owner, itemId).then(() => { deleted = true; });
    const cleaning = cleanupStorage(owner);
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(deleted).toBe(false);
    } finally { release(); }
    await Promise.all([exporting, deleting, cleaning]);
    const prepared = await prepare(file);
    try {
      expect(prepared.data!.savedItems![0].article?.images).toHaveLength(2);
      await imports.restoreBackupData(owner, prepared);
      expect((await restoredItem()).article?.images[0].upload).toBeTruthy();
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("recovers when PostgreSQL interrupts restore after files have been written", async () => {
    const prepared = await prepare(await archive());
    const before = await fs.readdir(path.dirname(storage.resolveStoragePath(storageName)));
    await db.$executeRawUnsafe("CREATE FUNCTION backup_v7_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER backup_v7_reject BEFORE INSERT ON "SavedArticle" FOR EACH ROW EXECUTE FUNCTION backup_v7_reject()');
    try {
      await expect(imports.restoreBackupData(owner, prepared)).rejects.toBeDefined();
      expect((await restoredItem()).id).toBe(itemId);
      expect(await fs.readdir(path.dirname(storage.resolveStoragePath(storageName)))).toEqual(before);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("keeps a complete pre-update snapshot while an article worker replaces its images", async () => {
    await db.savedArticleJob.create({ data: { savedItemId: itemId, sourceUrl, generation: "replacement", status: "running",
      leaseToken: "replacement-token", leaseUntil: new Date(Date.now() + 60_000) } });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const original = storage.sha256File;
    vi.spyOn(storage, "sha256File").mockImplementationOnce(async file => { entered(); await gate; return original(file); });
    const file = path.join(directory, "replacement.zip");
    const exporting = exports.writePortableArchive(owner, file, options);
    await inside;
    const queue = await import("./saved-article-queue");
    let settled = false;
    const replacing = queue.settleSavedArticleJob({ savedItemId: itemId, userId: owner, sourceUrl,
      generation: "replacement", attempts: 1, leaseToken: "replacement-token" },
    { status: "ready", blocks: [{ type: "paragraph", content: [{ type: "text", text: "New copy" }] }] }).then(result => { settled = result; });
    try { await new Promise(resolve => setTimeout(resolve, 50)); expect(settled).toBe(false); }
    finally { release(); }
    await Promise.all([exporting, replacing]);
    expect(settled).toBe(true);
    const prepared = await prepare(file);
    try {
      expect(prepared.data!.savedItems![0].article!.images).toHaveLength(2);
      expect((await restoredItem()).article!.images).toHaveLength(0);
      await imports.restoreBackupData(owner, prepared);
      expect(await fs.readFile(storage.resolveStoragePath((await restoredItem()).article!.images[0].upload!.storageName))).toEqual(raster);
    } finally { await imports.disposePreparedImport(prepared); }
  });
});
