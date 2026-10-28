import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("document history concurrent writers", () => {
  let db: typeof import("@/lib/db").db;let pages: typeof import("./page-service");let versions: typeof import("./page-version-service");let userId: string;let sectionId: string;
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));pages = await import("./page-service");versions = await import("./page-version-service");
    userId = (await db.user.create({ data: { email: `${randomUUID()}@history.test`, name: "Synthetic history", passwordHash: "unused" } })).id;
    const notebook = await db.notebook.create({ data: { userId, title: "History" } });sectionId = (await db.section.create({ data: { notebookId: notebook.id, title: "Documents" } })).id;
  });
  afterAll(async () => { if (db) { if (userId) await db.user.delete({ where: { id: userId } });await db.$disconnect(); } });
  it("only one simultaneous writer can consume a revision", async () => {
    const page = await db.page.create({ data: { sectionId, title: "Concurrent", content: [] } });
    await expect(pages.savePage(userId, page.id, { content: [] })).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => pages.savePage(userId, page.id, { expectedRevision: 0, title: `Writer ${index}` })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected").every(result => result.status === "rejected" && result.reason.status === 409)).toBe(true);
    expect((await db.page.findUniqueOrThrow({ where: { id: page.id } })).revision).toBe(1);
  });
  it("two mutually linked documents can save concurrently without foreign-key lock deadlocks", async () => {
    const a = await db.page.create({ data: { sectionId, title: "Linked A", content: [] } });const b = await db.page.create({ data: { sectionId, title: "Linked B", content: [] } });
    const content = (pageId: string) => [{ id: "linked-text", type: "paragraph", content: [{ type: "pageLink", props: { pageId, text: "Related", alias: false } }] }];
    await Promise.all([pages.savePage(userId, a.id, { expectedRevision: 0, content: content(b.id) }), pages.savePage(userId, b.id, { expectedRevision: 0, content: content(a.id) })]);
    expect(await db.pageLink.count({ where: { sourcePageId: { in: [a.id, b.id] } } })).toBe(2);
  });
  it("restore and autosave cannot both overwrite the same base; protective and restored snapshots survive", async () => {
    const page = await db.page.create({ data: { sectionId, title: "Original", content: [] } });
    await pages.savePage(userId, page.id, { expectedRevision: 0, title: "Current" });
    const version = await db.pageVersion.findFirstOrThrow({ where: { pageId: page.id } });
    const results = await Promise.allSettled([versions.restorePageVersion(userId, page.id, version.id, 1), pages.savePage(userId, page.id, { expectedRevision: 1, title: "Other tab" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const current = await db.page.findUniqueOrThrow({ where: { id: page.id } });
    const restored = await versions.restorePageVersion(userId, page.id, version.id, current.revision);
    expect(restored.title).toBe("Original");
    const snapshots = await db.pageVersion.findMany({ where: { pageId: page.id } });
    expect(snapshots.some(snapshot => snapshot.title === current.title)).toBe(true);
    expect(snapshots.some(snapshot => snapshot.title === "Original")).toBe(true);
    await expect(versions.restorePageVersion("foreign-user", page.id, version.id, restored.revision)).rejects.toMatchObject({ status: 404 });
    await expect(versions.getPageVersion("foreign-user", page.id, version.id)).rejects.toMatchObject({ status: 404 });
  });
  it("retention prioritizes restoration boundaries over imported future timestamps without exceeding the count", async () => {
    const page = await db.page.create({ data: { sectionId, title: "Retention", content: [] } });
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) ids.push((await db.pageVersion.create({ data: { pageId: page.id, title: `State ${index}`, content: [], searchText: "", contentHash: String(index), reason: "manual", createdAt: new Date(Date.now() + index * 86_400_000) } })).id);
    await db.$transaction(tx => versions.enforcePageVersionRetention(tx, page.id, new Date(), { intervalMs: 0, maxAgeMs: 30 * 86_400_000, maxCount: 2 }, ids.slice(0, 2)));
    expect((await db.pageVersion.findMany({ where: { pageId: page.id } })).map(item => item.id).sort()).toEqual(ids.slice(0, 2).sort());
  });
  it("rolls back page, snapshots and backlinks together if link indexing fails after the page write", async () => {
    const target = await db.page.create({ data: { sectionId, title: "Link target", content: [] } });
    const page = await db.page.create({ data: { sectionId, title: "Link source", content: [{ id: "linked", type: "paragraph", content: [{ type: "pageLink", props: { pageId: target.id, text: "Alias", alias: true } }] }] } });
    await pages.savePage(userId, page.id, { expectedRevision: 0, title: "New without links", content: [] });
    const version = await db.pageVersion.findFirstOrThrow({ where: { pageId: page.id } });const count = await db.pageVersion.count({ where: { pageId: page.id } });
    await db.$executeRaw`CREATE FUNCTION notebook_history43_reject_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic link index failure'; END; $$`;
    await db.$executeRaw`CREATE TRIGGER notebook_history43_reject_link BEFORE INSERT ON "PageLink" FOR EACH ROW EXECUTE FUNCTION notebook_history43_reject_link()`;
    try {
      await expect(versions.restorePageVersion(userId, page.id, version.id, 1)).rejects.toThrow();
      expect(await db.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({ revision: 1, title: "New without links", content: [] });
      expect(await db.pageVersion.count({ where: { pageId: page.id } })).toBe(count);expect(await db.pageLink.count({ where: { sourcePageId: page.id } })).toBe(0);
    } finally { await db.$executeRaw`DROP TRIGGER notebook_history43_reject_link ON "PageLink"`;await db.$executeRaw`DROP FUNCTION notebook_history43_reject_link()`; }
  });
  it("refuses restoration if the protective snapshot fails and rolls back all writes", async () => {
    const page = await db.page.create({ data: { sectionId, title: "Original for failure", content: [] } });
    await pages.savePage(userId, page.id, { expectedRevision: 0, title: "__history43_reject_snapshot__" });
    const version = await db.pageVersion.findFirstOrThrow({ where: { pageId: page.id } });const count = await db.pageVersion.count({ where: { pageId: page.id } });
    // Dedicated TEST database only: inject a real PostgreSQL failure, without mocking transactions.
    await db.$executeRaw`CREATE FUNCTION notebook_history43_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title = '__history43_reject_snapshot__' AND NEW.reason = 'before_restore' THEN RAISE EXCEPTION 'Synthetic protective snapshot failure'; END IF; RETURN NEW; END; $$`;
    await db.$executeRaw`CREATE TRIGGER notebook_history43_reject BEFORE INSERT ON "PageVersion" FOR EACH ROW EXECUTE FUNCTION notebook_history43_reject()`;
    try {
      await expect(versions.restorePageVersion(userId, page.id, version.id, 1)).rejects.toThrow();
      expect(await db.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({ revision: 1, title: "__history43_reject_snapshot__" });
      expect(await db.pageVersion.count({ where: { pageId: page.id } })).toBe(count);
    } finally { await db.$executeRaw`DROP TRIGGER notebook_history43_reject ON "PageVersion"`;await db.$executeRaw`DROP FUNCTION notebook_history43_reject()`; }
  });
});
