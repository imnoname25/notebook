import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createZipArchive } from "@/lib/archive";
import { savedItemCreateSchema } from "@/lib/saved-item-validation";
import { BACKUP_FORMAT, type ArchiveData, type DataManifest } from "@/lib/data-format";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, copyFile: vi.fn(fs.copyFile) };
});

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
const url = "https://example.test/capture";
const captureDate = new Date("2026-01-09T10:00:00.000Z");
const all = { includeDeleted: false, includeHistory: false, backup: false };
const backup = { includeDeleted: true, includeHistory: true, backup: true };
const request = (bytes: Uint8Array<ArrayBuffer>) => new Request("http://local/restore", {
  method: "POST", headers: { "content-type": "application/zip" }, body: bytes,
});

describe.skipIf(!enabled)("v6 Saved Items backup, real PostgreSQL and ZIP", () => {
  let db: typeof import("@/lib/db").db;
  let exports: typeof import("./export-service");
  let imports: typeof import("./import-service");
  let backups: typeof import("./backup-service");
  let restores: typeof import("./backup-restore-service");
  let saved: typeof import("./saved-item-service");
  let uploads: typeof import("./upload-service");
  let root: string;
  let owner: string;
  let other: string;
  let notebook: string;
  let section: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "notebook-v6-"));
    process.env.UPLOAD_DIR = path.join(root, "uploads");
    process.env.BACKUP_DIR = path.join(root, "backups");
    ({ db } = await import("@/lib/db"));
    exports = await import("./export-service");
    imports = await import("./import-service");
    backups = await import("./backup-service");
    restores = await import("./backup-restore-service");
    saved = await import("./saved-item-service");
    uploads = await import("./upload-service");
  });

  beforeEach(async () => {
    await db.user.deleteMany();
    await db.backupRecord.deleteMany();
    await db.applicationSettings.deleteMany();
    await db.applicationSettings.create({ data: {} });
    await rm(process.env.UPLOAD_DIR!, { recursive: true, force: true });
    await mkdir(process.env.UPLOAD_DIR!);
    owner = (await db.user.create({ data: { email: "v6@local.test", name: "Owner", passwordHash: "unused" } })).id;
    other = (await db.user.create({ data: { email: "other@local.test", name: "Other", passwordHash: "unused" } })).id;
    notebook = (await db.notebook.create({ data: { userId: owner, title: "Destination" } })).id;
    section = (await db.section.create({ data: { notebookId: notebook, title: "Clips" } })).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function capture() {
    const active = (await saved.createSavedItem(owner, randomUUID(), savedItemCreateSchema.parse({
      title: "Link", text: "Original text\n\nComment", url, tags: ["#Reading"],
    }), [await uploads.prepareUpload(new File([png], "clip.png", { type: "image/png" }), true)])).item;
    const archived = (await saved.createSavedItem(owner, randomUUID(), savedItemCreateSchema.parse({
      title: "PDF", text: "Scanned memo", tags: ["#Reading"],
    }), [await uploads.prepareUpload(new File([pdf], "memo.pdf", { type: "application/pdf" }), true)])).item;
    await saved.convertSavedItem(owner, archived.id, section, randomUUID());
    await db.savedItem.update({ where: { id: active.id }, data: {
      reviewStatus: "reviewed", updatedAt: captureDate, metadataTitle: "Preview title",
      metadataDescription: "Preview summary", metadataSiteName: "Example", metadataImageUrl: "https://example.test/image.png",
    } });
    await db.savedItemMetadataJob.update({ where: { savedItemId: active.id }, data: { attempts: 3, leaseToken: "fixture-lease" } });
    return { active, archived };
  }

  async function readZip(options = backup) {
    const file = path.join(root, `${randomUUID()}.zip`);
    await exports.writePortableArchive(owner, file, options);
    return new Uint8Array(await readFile(file));
  }

  async function writeFixture(manifest: DataManifest, data: ArchiveData, files: Map<string, string>) {
    const file = path.join(root, `${randomUUID()}.zip`);
    await createZipArchive(file, async zip => {
      zip.append(JSON.stringify(manifest), { name: "manifest.json" });
      zip.append(JSON.stringify(data), { name: manifest.format === BACKUP_FORMAT ? "backup.json" : "notebook.json" });
      for (const [name, source] of files) zip.file(source, { name });
    });
    return new Uint8Array(await readFile(file));
  }

  async function assertRestored(userId: string) {
    const entries = await db.savedItem.findMany({
      where: { userId }, orderBy: { title: "asc" },
      include: {
        tags: { include: { tag: true } },
        attachments: { include: { upload: true } },
        convertedPage: true, metadataJob: true,
      },
    });
    expect(entries).toHaveLength(2);
    const [active, archived] = entries;
    expect(active).toMatchObject({
      title: "Link", url, text: "Original text\n\nComment", reviewStatus: "reviewed",
      archivedAt: null, updatedAt: captureDate, metadataTitle: "Preview title",
      metadataDescription: "Preview summary", metadataSiteName: "Example", metadataImageUrl: "https://example.test/image.png",
      metadataJob: { leaseToken: null, attempts: 0, finishedAt: expect.any(Date) },
      tags: [{ tag: { normalized: "reading", userId } }],
    });
    expect(archived).toMatchObject({ title: "PDF", archivedAt: expect.any(Date), convertedAt: expect.any(Date), convertedPage: { title: "PDF" } });
    for (const [item, mime, bytes] of [[active, "image/png", png], [archived, "application/pdf", pdf]] as const) {
      expect(item.attachments).toHaveLength(1);
      const { upload } = item.attachments[0];
      expect(upload).toMatchObject({ userId, mimeType: mime, size: bytes.length });
      expect(await readFile(path.join(process.env.UPLOAD_DIR!, upload.storageName))).toEqual(bytes);
    }
    expect(JSON.stringify(archived.convertedPage!.content)).toContain(archived.attachments[0].uploadId);
    return entries;
  }

  it("round-trips active and archived items, stable data and links, with fresh IDs on every import", async () => {
    const initial = await capture();
    const bytes = await readZip(all);
    const prepared = await imports.prepareImport(request(bytes));
    try {
      expect(prepared.manifest?.version).toBe(6);
      expect(prepared.summary.savedItems).toBe(2);
      expect(JSON.stringify(prepared.data)).not.toMatch(/leaseToken|fixture-lease|fingerprint|convertedPageId/);
      await imports.commitImport(other, prepared);
      const entries = await assertRestored(other);
      expect(entries[0].id).not.toBe(initial.active.id);
      expect(entries[0].attachments[0].uploadId).not.toBe(initial.active.attachments[0].id);
      await imports.commitImport(other, prepared);
      expect(await db.savedItem.count({ where: { userId: other } })).toBe(4);
      expect(await db.upload.count({ where: { userId: other } })).toBe(4);
      expect(await db.savedItemRequest.count({ where: { userId: other } })).toBe(0);
      expect(await db.savedItem.count({ where: { userId: owner } })).toBe(2);
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("reads v6 saved titles from archives predating title provenance", async () => {
    await saved.createSavedItem(owner, randomUUID(), savedItemCreateSchema.parse({ title: "Old title" }), []);
    const { manifest, data } = await exports.buildPortableExport(owner, all);
    for (const item of data.savedItems ?? []) {
      delete item.titleOrigin;
      delete item.sharedTitle;
    }
    const prepared = await imports.prepareImport(request(await writeFixture(manifest, data, new Map())));
    try {
      await imports.commitImport(other, prepared);
      expect(await db.savedItem.findFirst({ where: { userId: other } })).toMatchObject({
        title: "Old title", titleOrigin: "legacy", sharedTitle: null,
      });
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("round-trips share provenance through v6 independently of the feature flag", async () => {
    const previousFlag = process.env.SAVED_ITEM_TITLE_ORIGINS;
    try {
      process.env.SAVED_ITEM_TITLE_ORIGINS = "1";
      const { item } = await saved.createSavedItem(owner, randomUUID(), savedItemCreateSchema.parse({
        sharedTitle: "Android title", url: "https://example.org/",
      }), []);
      await db.savedItem.update({ where: { id: item.id }, data: { metadataTitle: "Website title" } });
      const prepared = await imports.prepareImport(request(await readZip(all)));
      try {
        expect(prepared.manifest?.version).toBe(6);
        expect(prepared.data?.savedItems?.[0]).toMatchObject({
          title: "Website title", titleOrigin: "share", sharedTitle: "Android title",
        });
        delete process.env.SAVED_ITEM_TITLE_ORIGINS;
        await imports.commitImport(other, prepared);
        process.env.SAVED_ITEM_TITLE_ORIGINS = "1";
        await imports.commitImport(other, prepared);
        expect(await db.savedItem.findMany({ where: { userId: other } })).toMatchObject(Array.from({ length: 2 }, () => ({
          title: "", titleOrigin: "share", sharedTitle: "Android title", metadataTitle: "Website title",
        })));
      } finally { await imports.disposePreparedImport(prepared); }
    } finally {
      if (previousFlag === undefined) delete process.env.SAVED_ITEM_TITLE_ORIGINS;
      else process.env.SAVED_ITEM_TITLE_ORIGINS = previousFlag;
    }
  });

  it("excludes Saved Items from notebook exports and drops unavailable page links", async () => {
    const { archived } = await capture();
    const notebookOnly = await exports.buildPortableExport(owner, { ...all, notebookId: notebook });
    expect(notebookOnly.data.savedItems).toBeUndefined();
    expect(notebookOnly.data.attachments.map(file => file.mimeType)).toEqual(["application/pdf"]);
    const current = await db.savedItem.findUniqueOrThrow({ where: { id: archived.id } });
    await db.page.update({ where: { id: current.convertedPageId! }, data: { deletedAt: new Date() } });
    const prepared = await imports.prepareImport(request(await readZip(all)));
    try {
      expect(prepared.data?.savedItems?.find(item => item.title === "PDF")?.convertedPageKey).toBeNull();
      await imports.commitImport(other, prepared);
      expect(await db.savedItem.findFirst({ where: { userId: other, title: "PDF" } })).toMatchObject({
        convertedPageId: null, convertedAt: expect.any(Date), archivedAt: expect.any(Date),
      });
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("restores a recorded backup over existing data and keeps the v6 safety copy", async () => {
    await capture();
    const record = await backups.createOperationalBackup(owner, "manual");
    const { item: later } = await saved.createSavedItem(owner, randomUUID(), savedItemCreateSchema.parse({ text: "Later" }), []);
    const { item: foreign } = await saved.createSavedItem(other, randomUUID(), savedItemCreateSchema.parse({ text: "Other user" }), []);
    const result = await restores.restoreRecordedBackup(owner, record.id);
    await assertRestored(owner);
    expect(await db.savedItem.findUnique({ where: { id: later.id } })).toBeNull();
    expect(await db.savedItem.findUnique({ where: { id: foreign.id } })).not.toBeNull();
    const safety = await backups.backupRecordFile(result.safetyBackupId);
    const prepared = await imports.prepareImport(request(new Uint8Array(await readFile(safety.filePath))), "backup");
    try {
      expect(prepared.manifest?.version).toBe(6);
      expect(prepared.data?.savedItems?.map(item => item.text)).toContain("Later");
      expect(safety.record.type).toBe("safety");
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it.each([1, 2, 3, 4, 5] as const)("restores legacy v%i without removing current Saved Items", async version => {
    const { active, archived } = await capture();
    const bytes = await writeFixture({
      format: BACKUP_FORMAT, version, createdAt: captureDate.toISOString(), app: "Notebook",
      scope: "backup", includesHistory: false, attachmentCount: 0,
    }, { notebooks: [], attachments: [] }, new Map());
    await restores.restoreUploadedBackup(owner, request(bytes));
    expect(await db.savedItem.count({ where: { userId: owner } })).toBe(2);
    expect(await db.savedItem.findUnique({ where: { id: archived.id } })).toMatchObject({ convertedPageId: null, convertedAt: expect.any(Date) });
    const audit = await (await import("./attachment-service")).auditStorage(owner);
    expect(audit).toMatchObject({ missingFiles: [], unusedAttachments: [] });
    expect(await db.savedItemTag.count({ where: { savedItemId: active.id } })).toBe(1);
  });

  it.each(["corrupt ZIP", "missing file", "bad SHA-256", "bad MIME", "traversal"] as const)(
    "rejects %s before creating a safety backup or altering the original data", async fault => {
      const { active } = await capture();
      const built = await exports.buildPortableExport(owner, backup);
      const first = built.data.attachments[0];
      if (fault === "missing file") built.attachmentFiles.delete(first.archivePath!);
      if (fault === "bad SHA-256") first.sha256 = "0".repeat(64);
      if (fault === "bad MIME") first.mimeType = "image/jpeg";
      if (fault === "traversal") first.archivePath = "attachments/../../outside.png";
      const bytes = fault === "corrupt ZIP"
        ? new Uint8Array([0x50, 0x4b, 0x03, 0x04])
        : await writeFixture(built.manifest, built.data, built.attachmentFiles);
      await expect(restores.restoreUploadedBackup(owner, request(bytes))).rejects.toMatchObject({ status: fault === "bad MIME" ? 415 : 400 });
      expect(await db.savedItem.findUnique({ where: { id: active.id } })).not.toBeNull();
      expect(await db.backupRecord.count()).toBe(0);
    });

  it("keeps the old files and a restorable safety backup when PostgreSQL aborts midway", async () => {
    const { active } = await capture();
    const bytes = await readZip();
    const before = await readdir(path.join(process.env.UPLOAD_DIR!, owner));
    await db.$executeRaw`CREATE FUNCTION notebook_v6_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.title = 'PDF' THEN PERFORM pg_terminate_backend(pg_backend_pid()); END IF; RETURN NEW; END $$`;
    try {
      await db.$executeRaw`CREATE TRIGGER notebook_v6_test_abort BEFORE INSERT ON "SavedItem" FOR EACH ROW EXECUTE FUNCTION notebook_v6_test_abort()`;
      await expect(restores.restoreUploadedBackup(owner, request(bytes))).rejects.toThrow("Safety backup сохранён");
      expect(await db.savedItem.findUnique({ where: { id: active.id } })).not.toBeNull();
      expect(await readdir(path.join(process.env.UPLOAD_DIR!, owner))).toEqual(before);
      const safety = await db.backupRecord.findFirstOrThrow({ where: { type: "safety", status: "success" } });
      expect(await backups.backupRecordFile(safety.id)).toMatchObject({ record: { id: safety.id } });
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS notebook_v6_test_abort ON "SavedItem"`;
      await db.$executeRaw`DROP FUNCTION notebook_v6_test_abort()`;
    }
  });

  it("cleans copied files and leaves the original rows intact if the filesystem fails during materialization", async () => {
    const { active } = await capture();
    const prepared = await imports.prepareImport(request(await readZip()), "backup");
    const userFiles = path.join(process.env.UPLOAD_DIR!, owner);
    const before = await readdir(userFiles);
    try {
      // The archive has passed validation and the first attachment still copies successfully.
      await rm(path.join(prepared.directory, "extracted", prepared.data!.attachments[1].archivePath!));
      await expect(imports.restoreBackupData(owner, prepared)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(userFiles)).toEqual(before);
      expect(await db.savedItem.findUnique({ where: { id: active.id } })).not.toBeNull();
    } finally { await imports.disposePreparedImport(prepared); }
  });

  it("rolls back and keeps the safety backup on ENOSPC after copying the first file", async () => {
    const { active } = await capture();
    const bytes = await readZip();
    const userFiles = path.join(process.env.UPLOAD_DIR!, owner);
    const before = await readdir(userFiles);
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(copyFile).mockImplementationOnce(fs.copyFile)
      .mockRejectedValueOnce(Object.assign(new Error("fixture disk full"), { code: "ENOSPC" }));
    try {
      await expect(restores.restoreUploadedBackup(owner, request(bytes))).rejects.toThrow("Safety backup сохранён");
      expect(await readdir(userFiles)).toEqual(before);
      expect(await db.savedItem.findUnique({ where: { id: active.id } })).not.toBeNull();
      expect(await db.backupRecord.count({ where: { type: "safety", status: "success" } })).toBe(1);
    } finally { vi.mocked(copyFile).mockReset(); }
  });

  it("keeps active and archived files during cleanup, including after restore", async () => {
    await capture();
    await restores.restoreUploadedBackup(owner, request(await readZip()));
    await writeFile(path.join(process.env.UPLOAD_DIR!, owner, "orphan.pdf"), pdf);
    const storage = await import("./attachment-service");
    expect(await storage.cleanupStorage(owner)).toMatchObject({ removed: 1 });
    await assertRestored(owner);
  });

  it("uploads v6 to WebDAV over HTTP and restores after the local copy is lost", async () => {
    await capture();
    const files = new Map<string, Buffer>();
    const server = createServer(async (req, res) => {
      const key = req.url!;
      if (req.method === "PROPFIND") { res.writeHead(207).end(); return; }
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        files.set(key, Buffer.concat(chunks));
        res.writeHead(201, { etag: '"fixture"' }).end();
        return;
      }
      const payload = files.get(key);
      if (req.method === "GET" && payload) res.writeHead(200, { "content-length": payload.length }).end(payload);
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test WebDAV address");
      await db.applicationSettings.update({ where: { id: "singleton" }, data: {
        webdavEnabled: true, webdavUrl: `http://127.0.0.1:${address.port}`, webdavRemoteDirectory: "backups",
      } });
      const record = await backups.createOperationalBackup(owner, "manual");
      expect(record.remoteCopies).toEqual([expect.objectContaining({ provider: "webdav", status: "success" })]);
      const local = await backups.backupRecordFile(record.id);
      await rm(local.filePath);
      await db.backupRecord.update({ where: { id: record.id }, data: { filename: null } });
      await db.savedItem.deleteMany({ where: { userId: owner } });
      expect(await restores.restoreRemoteBackup(owner, record.id, "webdav")).toMatchObject({ ok: true });
      await assertRestored(owner);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
