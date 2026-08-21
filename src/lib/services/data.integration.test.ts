import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATA_FORMAT_VERSION } from "@/lib/data-format";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("portable data and attachment integration", () => {
  let db: typeof import("@/lib/db").db;
  let exports: typeof import("./export-service");
  let imports: typeof import("./import-service");
  let attachments: typeof import("./attachment-service");
  let uploadDirectory = "";
  let ids: {
    user: string;
    other: string;
    notebook: string;
    section: string;
    page: string;
    upload: string;
  };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  beforeAll(async () => {
    uploadDirectory = await mkdtemp(
      path.join(tmpdir(), "notebook-integration-"),
    );
    process.env.UPLOAD_DIR = uploadDirectory;
    ({ db } = await import("@/lib/db"));
    exports = await import("./export-service");
    imports = await import("./import-service");
    attachments = await import("./attachment-service");
  });
  beforeEach(async () => {
    await db.user.deleteMany();
    await rm(uploadDirectory, { recursive: true, force: true });
    await mkdir(uploadDirectory);
    const user = await db.user.create({
      data: {
        email: "portable@test.local",
        name: "Portable",
        passwordHash: "unused",
      },
    });
    const other = await db.user.create({
      data: {
        email: "other@test.local",
        name: "Other",
        passwordHash: "unused",
      },
    });
    const notebook = await db.notebook.create({
      data: { userId: user.id, title: "Export" },
    });
    const section = await db.section.create({
      data: { notebookId: notebook.id, title: "Section" },
    });
    const page = await db.page.create({
      data: {
        sectionId: section.id,
        title: "Portable page",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Searchable export", styles: {} }],
          },
        ],
      },
    });
    const upload = await db.upload.create({
      data: {
        userId: user.id,
        pageId: page.id,
        storageName: `${user.id}/image.png`,
        originalName: "image.png",
        mimeType: "image/png",
        size: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      },
    });
    await mkdir(path.join(uploadDirectory, user.id));
    await writeFile(path.join(uploadDirectory, upload.storageName), png);
    await db.page.update({
      where: { id: page.id },
      data: {
        content: [
          { type: "image", props: { url: `/api/uploads/${upload.id}` } },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Searchable export", styles: {} }],
          },
        ],
        color: "blue",
        backgroundType: "image",
        backgroundColor: "blue",
        backgroundPattern: "grid",
        backgroundUploadId: upload.id,
        backgroundPosition: "bottom",
        backgroundOverlay: "strong",
        appearancePreset: "focus",
      },
    });
    ids = {
      user: user.id,
      other: other.id,
      notebook: notebook.id,
      section: section.id,
      page: page.id,
      upload: upload.id,
    };
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
    if (uploadDirectory)
      await rm(uploadDirectory, { recursive: true, force: true });
  });

  it("exports portable page JSON with attachment data and enforces ownership", async () => {
    const result = await exports.exportPageJson(ids.user, ids.page);
    expect(result.manifest.version).toBe(DATA_FORMAT_VERSION);
    expect(result.page).toMatchObject({
      color: "blue",
      backgroundType: "image",
      backgroundPattern: "grid",
      backgroundPosition: "bottom",
      backgroundOverlay: "strong",
      appearancePreset: "focus",
      backgroundAttachmentKey: "attachment-1",
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.dataBase64).toBe(png.toString("base64"));
    expect(JSON.stringify(result)).not.toContain(ids.user);
    await expect(
      exports.exportPageJson(ids.other, ids.page),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("imports a page with new IDs, remapped attachment and generated searchText", async () => {
    const payload = await exports.exportPageJson(ids.user, ids.page);
    const prepared = await imports.prepareImport(
      new Request("http://local/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    try {
      const result = await imports.commitImport(
        ids.user,
        prepared,
        ids.section,
      );
      const page = await db.page.findUniqueOrThrow({
        where: { id: result.pageId },
      });
      expect(page.id).not.toBe(ids.page);
      expect(page.searchText).toContain("Searchable export");
      expect(page).toMatchObject({
        color: "blue",
        backgroundType: "image",
        backgroundPattern: "grid",
        backgroundPosition: "bottom",
        backgroundOverlay: "strong",
        appearancePreset: "focus",
      });
      const importedUpload = await db.upload.findFirstOrThrow({
        where: { pageId: page.id },
      });
      expect(page.backgroundUploadId).toBe(importedUpload.id);
      expect(JSON.stringify(page.content)).toContain(
        `/api/uploads/${importedUpload.id}`,
      );
    } finally {
      await imports.disposePreparedImport(prepared);
    }
  });
  it("normal export excludes trash/history while backup includes them and unused attachments", async () => {
    await db.pageVersion.create({
      data: {
        pageId: ids.page,
        title: "Old",
        content: [
          { type: "image", props: { url: `/api/uploads/${ids.upload}` } },
        ],
        contentHash: "old",
        reason: "manual",
      },
    });
    await db.page.update({
      where: { id: ids.page },
      data: {
        deletedAt: new Date(),
        deletionGroupId: "group",
        isDeletionRoot: true,
      },
    });
    const unused = await db.upload.create({
      data: {
        userId: ids.user,
        storageName: `${ids.user}/unused.png`,
        originalName: "unused.png",
        mimeType: "image/png",
        size: png.length,
      },
    });
    await writeFile(path.join(uploadDirectory, unused.storageName), png);
    const normal = await exports.buildPortableExport(ids.user, {
      includeDeleted: false,
      includeHistory: false,
      backup: false,
    });
    expect(normal.data.notebooks[0]?.sections[0]?.pages).toHaveLength(0);
    const backup = await exports.buildPortableExport(ids.user, {
      includeDeleted: true,
      includeHistory: true,
      backup: true,
    });
    expect(
      backup.data.notebooks[0]?.sections[0]?.pages[0]?.versions,
    ).toHaveLength(1);
    expect(backup.data.attachments).toHaveLength(2);
    expect(JSON.stringify(backup)).not.toContain("passwordHash");
    expect(JSON.stringify(backup)).not.toContain("tokenHash");
  });
  it("history references prevent cleanup and audit detects missing/orphan blobs", async () => {
    await db.page.update({
      where: { id: ids.page },
      data: { content: [{ type: "paragraph", content: [] }] },
    });
    await db.pageVersion.create({
      data: {
        pageId: ids.page,
        title: "History",
        content: [
          { type: "image", props: { url: `/api/uploads/${ids.upload}` } },
        ],
        contentHash: "history",
        reason: "manual",
      },
    });
    await writeFile(path.join(uploadDirectory, ids.user, "orphan.png"), png);
    const missing = await db.upload.create({
      data: {
        userId: ids.user,
        storageName: `${ids.user}/missing.png`,
        originalName: "missing.png",
        mimeType: "image/png",
        size: png.length,
      },
    });
    const audit = await attachments.auditStorage(ids.user);
    expect(audit.unusedAttachments.map((item) => item.id)).not.toContain(
      ids.upload,
    );
    expect(audit.missingFiles.map((item) => item.id)).toContain(missing.id);
    expect(audit.orphanFiles).toHaveLength(1);
  });
  it("failed page import removes staged files and leaves no DB records", async () => {
    const payload = await exports.exportPageJson(ids.user, ids.page);
    const prepared = await imports.prepareImport(
      new Request("http://local/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const before = await readdir(path.join(uploadDirectory, ids.user));
    try {
      await expect(
        imports.commitImport(ids.user, prepared, randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
      expect(await readdir(path.join(uploadDirectory, ids.user))).toHaveLength(
        before.length,
      );
    } finally {
      await imports.disposePreparedImport(prepared);
    }
  });
  it("restores backup content, trash and versions without sessions", async () => {
    await db.pageVersion.create({
      data: {
        pageId: ids.page,
        title: "Old",
        content: [{ type: "paragraph", content: [] }],
        contentHash: "old",
        reason: "manual",
      },
    });
    await db.page.update({
      where: { id: ids.page },
      data: {
        deletedAt: new Date(),
        deletionGroupId: "trash",
        isDeletionRoot: true,
      },
    });
    const directory = await mkdtemp(
      path.join(tmpdir(), "notebook-backup-test-"),
    );
    const archive = path.join(directory, "backup.zip");
    await exports.writePortableArchive(ids.user, archive, {
      includeDeleted: true,
      includeHistory: true,
      backup: true,
    });
    await db.notebook.create({
      data: { userId: ids.user, title: "Remove me" },
    });
    const prepared = await imports.prepareImport(
      new Request("http://local/restore", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: await readFile(archive),
      }),
      "backup",
    );
    try {
      await imports.restoreBackupData(ids.user, prepared);
      expect(await db.notebook.count({ where: { userId: ids.user } })).toBe(1);
      expect(
        await db.page.count({
          where: {
            section: { notebook: { userId: ids.user } },
            deletedAt: { not: null },
          },
        }),
      ).toBe(1);
      expect(
        await db.pageVersion.count({
          where: { page: { section: { notebook: { userId: ids.user } } } },
        }),
      ).toBe(1);
      expect(await db.session.count({ where: { userId: ids.user } })).toBe(0);
    } finally {
      await imports.disposePreparedImport(prepared);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
