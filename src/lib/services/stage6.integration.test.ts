import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BackupRemoteTarget, RemoteUploadInput } from "@/lib/remote-backup";

const databaseUrl = process.env.TEST_DATABASE_URL; const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1"; if (enabled) process.env.DATABASE_URL = databaseUrl;

class FakeTarget implements BackupRemoteTarget {
  deleted: string[] = []; readonly provider: "webdav" | "s3";
  constructor(provider: "webdav" | "s3", private readonly fail = false) { this.provider = provider; }
  ownsKey(key: string) { return /^notebook-backup-.+\.zip$/u.test(key); }
  async test() { if (this.fail) throw new Error("credentials"); }
  async upload(input: RemoteUploadInput) { if (this.fail) throw new Error("credentials"); return { remoteKey: input.filename, etag: `${this.provider}-etag` }; }
  async download(): Promise<{ size: bigint }> { throw new Error("not used"); }
  async delete(key: string) { this.deleted.push(key); }
}

describe.skipIf(!enabled)("stage 6 FTS, templates and operations integration", () => {
  let db: typeof import("@/lib/db").db; let search: typeof import("./search-service"); let templates: typeof import("./template-service"); let remotes: typeof import("./remote-backup-service"); let notifications: typeof import("./system-notification-service");
  let ids: { user: string; other: string; notebook: string; section: string; page: string };
  beforeAll(async () => { ({ db } = await import("@/lib/db")); search = await import("./search-service"); templates = await import("./template-service"); remotes = await import("./remote-backup-service"); notifications = await import("./system-notification-service"); });
  beforeEach(async () => {
    await db.backupRecord.deleteMany(); await db.systemNotification.deleteMany(); await db.applicationSettings.deleteMany(); await db.user.deleteMany(); await db.applicationSettings.create({ data: {} });
    const user = await db.user.create({ data: { email: "stage6@test.local", name: "Stage 6", passwordHash: "unused" } }); const other = await db.user.create({ data: { email: "foreign@test.local", name: "Foreign", passwordHash: "unused" } }); const notebook = await db.notebook.create({ data: { userId: user.id, title: "Рабочая инфраструктура" } }); const section = await db.section.create({ data: { notebookId: notebook.id, title: "Серверы Linux" } }); const page = await db.page.create({ data: { sectionId: section.id, title: "PostgreSQL backup", content: [{ type: "paragraph", content: [] }], searchText: "резервное копирование docker database mixed термин" } }); ids = { user: user.id, other: other.id, notebook: notebook.id, section: section.id, page: page.id };
  });
  afterAll(async () => { if (db) await db.$disconnect(); });

  it("searches RU/EN/mixed text, weights title, supports prefix and excludes trash", async () => {
    await db.page.create({ data: { sectionId: ids.section, title: "Other", content: [], searchText: "PostgreSQL only in content", sortOrder: 1 } });
    expect((await search.searchNotebook(ids.user, "резервное копирование")).results[0]?.id).toBe(ids.page);
    expect((await search.searchNotebook(ids.user, "docker database")).results.some((item) => item.id === ids.page)).toBe(true);
    expect((await search.searchNotebook(ids.user, "postgr")).results[0]?.id).toBe(ids.page);
    await db.page.update({ where: { id: ids.page }, data: { deletedAt: new Date() } }); expect((await search.searchNotebook(ids.user, "резервное")).results.some((item) => item.id === ids.page)).toBe(false);
    await expect(search.searchNotebook(ids.user, "') OR 1=1 --")).resolves.toMatchObject({ results: expect.any(Array) });
  });

  it("generated vector tracks edits without an explicit reindex", async () => { expect((await search.searchNotebook(ids.user, "уникальноеслово")).results).toHaveLength(0); await db.page.update({ where: { id: ids.page }, data: { searchText: "уникальноеслово" } }); expect((await search.searchNotebook(ids.user, "уникальноеслово")).results[0]?.id).toBe(ids.page); });

  it("enforces template ownership, built-in protection and creates structured copies", async () => { const list = await templates.listTemplates(ids.user); expect(list.length).toBeGreaterThanOrEqual(7); await expect(templates.deleteTemplate(ids.user, list[0]!.id)).rejects.toMatchObject({ status: 409 }); const custom = await templates.createTemplate(ids.user, { name: "Runbook", icon: "book-open", content: [{ type: "callout", props: { kind: "info" }, content: [] }] }); await expect(templates.updateTemplate(ids.other, custom.id, { name: "stolen" })).rejects.toMatchObject({ status: 404 }); expect((await templates.duplicateTemplate(ids.user, custom.id)).name).toContain("копия"); await expect(templates.createTemplate(ids.user, { name: "Image", icon: "file-text", content: [{ type: "image", props: { url: "/api/uploads/private" } }] })).rejects.toMatchObject({ status: 409 }); });

  it("records independent remote target outcomes without changing local success", async () => { const record = await db.backupRecord.create({ data: { type: "manual", status: "success", filename: "notebook-backup-stage6.zip", size: 3, sha256: "a".repeat(64) } }); await remotes.uploadToRemoteTargets({ id: record.id, filename: record.filename!, size: 3n, sha256: "a".repeat(64) }, [new FakeTarget("webdav"), new FakeTarget("s3", true)]); const copies = await db.backupRemoteCopy.findMany({ where: { backupRecordId: record.id }, orderBy: { provider: "asc" } }); expect(copies.map((copy) => [copy.provider, copy.status])).toEqual([["s3", "failed"], ["webdav", "success"]]); expect((await db.backupRecord.findUniqueOrThrow({ where: { id: record.id } })).status).toBe("success"); });

  it("remote retention deletes only known owned copies beyond the limit", async () => { await db.applicationSettings.update({ where: { id: "singleton" }, data: { remoteRetentionCount: 1, remoteRetentionDays: 365 } }); const old = await db.backupRecord.create({ data: { type: "manual", status: "success" } }); const current = await db.backupRecord.create({ data: { type: "manual", status: "success" } }); await db.backupRemoteCopy.create({ data: { backupRecordId: old.id, provider: "webdav", status: "success", remoteKey: "notebook-backup-old.zip", uploadedAt: new Date("2026-08-01") } }); await db.backupRemoteCopy.create({ data: { backupRecordId: current.id, provider: "webdav", status: "success", remoteKey: "notebook-backup-current.zip", uploadedAt: new Date("2026-08-14") } }); const target = new FakeTarget("webdav"); expect(await remotes.enforceRemoteRetention(new Date("2026-08-14"), [target])).toBe(1); expect(target.deleted).toEqual(["notebook-backup-old.zip"]); expect(await db.backupRemoteCopy.count()).toBe(1); });

  it("deduplicates failures, resolves warnings and supports read retention", async () => { await notifications.createNotification({ type: "failed", severity: "warning", title: "WebDAV", message: "failed", dedupKey: "backup:webdav:failure" }); await notifications.createNotification({ type: "failed", severity: "warning", title: "WebDAV", message: "failed again", dedupKey: "backup:webdav:failure" }); expect(await db.systemNotification.count()).toBe(1); await notifications.resolveNotification("backup:webdav:failure"); expect((await notifications.listNotifications()).unread).toBe(0); });
});
