import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("database ownership and mutation security", () => {
  let db: typeof import("@/lib/db").db;
  let versions: typeof import("./page-version-service");
  let moves: typeof import("./move-service");
  let pages: typeof import("./page-service");
  let sessions: typeof import("@/lib/auth/session");
  let vault: typeof import("./vault-service");
  let exports: typeof import("./export-service");
  let ids: {
    userA: string;
    userB: string;
    notebookA: string;
    notebookA2: string;
    notebookB: string;
    sectionA: string;
    sectionA2: string;
    sectionB: string;
    pageA: string;
    versionA: string;
    uploadA: string;
    uploadB: string;
  };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    versions = await import("./page-version-service");
    moves = await import("./move-service");
    pages = await import("./page-service");
    sessions = await import("@/lib/auth/session");
    vault = await import("./vault-service");
    exports = await import("./export-service");
  });
  beforeEach(async () => {
    await db.user.deleteMany();
    const userA = await db.user.create({
      data: { email: "a@security.test", name: "A", passwordHash: "unused" },
    });
    const userB = await db.user.create({
      data: { email: "b@security.test", name: "B", passwordHash: "unused" },
    });
    const notebookA = await db.notebook.create({
      data: { userId: userA.id, title: "A" },
    });
    const notebookA2 = await db.notebook.create({
      data: { userId: userA.id, title: "A2", sortOrder: 1 },
    });
    const notebookB = await db.notebook.create({
      data: { userId: userB.id, title: "B" },
    });
    const sectionA = await db.section.create({
      data: { notebookId: notebookA.id, title: "A" },
    });
    const sectionA2 = await db.section.create({
      data: { notebookId: notebookA2.id, title: "A2" },
    });
    const sectionB = await db.section.create({
      data: { notebookId: notebookB.id, title: "B" },
    });
    const pageA = await db.page.create({
      data: {
        sectionId: sectionA.id,
        title: "Original",
        content: [{ type: "paragraph", content: [] }],
      },
    });
    const uploadA = await db.upload.create({
      data: {
        userId: userA.id,
        pageId: pageA.id,
        storageName: `${userA.id}/a.png`,
        originalName: "a.png",
        mimeType: "image/png",
        size: 8,
      },
    });
    const uploadB = await db.upload.create({
      data: {
        userId: userB.id,
        storageName: `${userB.id}/b.png`,
        originalName: "b.png",
        mimeType: "image/png",
        size: 8,
      },
    });
    const versionA = await db.pageVersion.create({
      data: {
        pageId: pageA.id,
        title: "Original",
        content: [{ type: "paragraph", content: [] }],
        contentHash: "seed",
        reason: "manual",
      },
    });
    ids = {
      userA: userA.id,
      userB: userB.id,
      notebookA: notebookA.id,
      notebookA2: notebookA2.id,
      notebookB: notebookB.id,
      sectionA: sectionA.id,
      sectionA2: sectionA2.id,
      sectionB: sectionB.id,
      pageA: pageA.id,
      versionA: versionA.id,
      uploadA: uploadA.id,
      uploadB: uploadB.id,
    };
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  it("hides foreign history and prevents foreign restore/delete", async () => {
    await expect(
      versions.listPageVersions(ids.userB, ids.pageA, 25),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      versions.getPageVersion(ids.userB, ids.pageA, ids.versionA),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      versions.restorePageVersion(ids.userB, ids.pageA, ids.versionA, 0),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      versions.deletePageVersion(ids.userB, ids.pageA, ids.versionA),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects foreign and deleted move destinations", async () => {
    await expect(
      moves.movePage(ids.userA, ids.pageA, ids.sectionB),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      moves.moveSection(ids.userA, ids.sectionA, ids.notebookB),
    ).rejects.toMatchObject({ status: 404 });
    await db.section.update({
      where: { id: ids.sectionA2 },
      data: { deletedAt: new Date() },
    });
    await expect(
      moves.movePage(ids.userA, ids.pageA, ids.sectionA2),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("protects restored content from a stale autosave and snapshots current state", async () => {
    const edited = await pages.savePage(ids.userA, ids.pageA, {
      title: "Edited",
      expectedRevision: 0,
      snapshotReason: "manual",
    });
    await expect(
      pages.savePage(ids.userA, ids.pageA, {
        title: "Stale",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const restored = await versions.restorePageVersion(
      ids.userA,
      ids.pageA,
      ids.versionA,
      edited.revision,
    );
    expect(restored.title).toBe("Original");
    const currentSnapshot = await db.pageVersion.findFirst({
      where: { pageId: ids.pageA, title: "Edited", reason: "before_restore" },
    });
    expect(currentSnapshot).not.toBeNull();
  });

  it("persists owned appearance and rejects a foreign background", async () => {
    const styled = await pages.savePage(ids.userA, ids.pageA, {
      color: "cyan",
      backgroundType: "image",
      backgroundUploadId: ids.uploadA,
      backgroundPosition: "bottom",
      backgroundOverlay: "strong",
      appearancePreset: "ocean",
    });
    expect(styled).toMatchObject({
      color: "cyan",
      backgroundType: "image",
      backgroundUploadId: ids.uploadA,
      backgroundPosition: "bottom",
      backgroundOverlay: "strong",
      appearancePreset: "ocean",
    });
    await expect(
      pages.savePage(ids.userA, ids.pageA, {
        backgroundUploadId: ids.uploadB,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("moves within owned structures and recalculates order", async () => {
    await db.page.create({
      data: {
        sectionId: ids.sectionA,
        title: "Second",
        content: [],
        sortOrder: 4,
      },
    });
    await moves.movePage(ids.userA, ids.pageA, ids.sectionA2);
    expect(
      (await db.page.findUniqueOrThrow({ where: { id: ids.pageA } })).sectionId,
    ).toBe(ids.sectionA2);
    expect(
      (
        await db.page.findMany({
          where: { sectionId: ids.sectionA },
          orderBy: { sortOrder: "asc" },
        })
      ).map((page) => page.sortOrder),
    ).toEqual([0]);
    await moves.moveSection(ids.userA, ids.sectionA, ids.notebookA2);
    expect(
      (await db.section.findUniqueOrThrow({ where: { id: ids.sectionA } }))
        .notebookId,
    ).toBe(ids.notebookA2);
  });

  it("duplicates content and search state without favorite or history", async () => {
    await db.page.update({
      where: { id: ids.pageA },
      data: {
        isFavorite: true,
        searchText: "indexed text",
        icon: "⭐",
        color: "violet",
        backgroundType: "pattern",
        backgroundPattern: "dot-grid",
        appearancePreset: "focus",
      },
    });
    const duplicate = await moves.duplicatePage(ids.userA, ids.pageA);
    expect(duplicate.title).toBe("Original — копия");
    expect(duplicate.searchText).toBe("indexed text");
    expect(duplicate.isFavorite).toBe(false);
    expect(duplicate).toMatchObject({
      icon: "⭐",
      color: "violet",
      backgroundType: "pattern",
      backgroundPattern: "dot-grid",
      appearancePreset: "focus",
    });
    expect(
      await db.pageVersion.count({ where: { pageId: duplicate.id } }),
    ).toBe(0);
  });

  it("cleans expired sessions and revokes every current-user session", async () => {
    const now = new Date();
    await db.session.createMany({
      data: [
        {
          userId: ids.userA,
          tokenHash: "expired",
          createdAt: now,
          lastUsedAt: now,
          expiresAt: new Date(0),
          absoluteExpiresAt: new Date(now.getTime() + 1000),
        },
        {
          userId: ids.userA,
          tokenHash: "active",
          createdAt: now,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + 1000),
          absoluteExpiresAt: new Date(now.getTime() + 1000),
        },
      ],
    });
    await sessions.cleanupExpiredSessions(now);
    expect(await db.session.count({ where: { userId: ids.userA } })).toBe(1);
    await sessions.revokeAllUserSessions(ids.userA);
    expect(await db.session.count({ where: { userId: ids.userA } })).toBe(0);
  });

  it("isolates opaque Vault ciphertext and excludes it from normal Notebook export", async () => {
    const profile = {
      kdfAlgorithm: "argon2id" as const,
      kdfSalt: "A".repeat(24),
      kdfMemoryKiB: 65_536,
      kdfIterations: 3,
      kdfParallelism: 1,
      verifier: "B".repeat(32),
      encryptedKeyset: "C".repeat(64),
      encryptionVersion: 1 as const,
    };
    await vault.createVaultProfile(ids.userA, profile);
    await vault.createVaultProfile(ids.userB, {
      ...profile,
      kdfSalt: "D".repeat(24),
      verifier: "E".repeat(32),
    });
    const encryptedPayload = "VGhpcy1pcy1vcGFxdWUtY2lwaGVydGV4dA==";
    const item = await vault.createVaultItem(ids.userA, {
      itemType: "login",
      encryptedPayload,
      encryptionVersion: 1,
    });
    await expect(
      vault.updateVaultItem(ids.userB, item.id, {
        encryptedPayload: "R".repeat(32),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      JSON.stringify(
        await exports.buildPortableExport(ids.userA, {
          includeDeleted: false,
          includeHistory: false,
          backup: false,
        }),
      ),
    ).not.toContain(encryptedPayload);
  });
});
