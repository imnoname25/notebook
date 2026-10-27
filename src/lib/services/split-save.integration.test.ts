import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("two document save and version boundaries", () => {
  let db: typeof import("@/lib/db").db;let pages: typeof import("./page-service");let versions: typeof import("./page-version-service");
  let userId: string;let a: string;let b: string;
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));pages = await import("./page-service");versions = await import("./page-version-service");
    userId = (await db.user.create({ data: { email: `${randomUUID()}@split.test`, name: "Split test", passwordHash: "unused-test-hash" } })).id;
    const notebook = await db.notebook.create({ data: { userId, title: "Workspace" } });const section = await db.section.create({ data: { notebookId: notebook.id, title: "Documents" } });
    a = (await db.page.create({ data: { sectionId: section.id, title: "A", content: [] } })).id;b = (await db.page.create({ data: { sectionId: section.id, title: "B", content: [] } })).id;
  });
  afterAll(async () => { if (db) { if (userId) await db.user.delete({ where: { id: userId } });await db.$disconnect(); } });
  it("saves both documents concurrently and rejects a stale revision independently", async () => {
    const paragraph = (text: string) => [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }];
    const [first, second] = await Promise.all([pages.savePage(userId, a, { expectedRevision: 0, content: paragraph("Alpha unique") }), pages.savePage(userId, b, { expectedRevision: 0, content: paragraph("Beta unique") })]);
    await expect(pages.savePage(userId, a, { expectedRevision: 0, content: paragraph("stale") })).rejects.toMatchObject({ status: 409 });
    const updatedB = await pages.savePage(userId, b, { expectedRevision: second.revision, content: paragraph("Beta second") });
    expect(JSON.stringify((await db.page.findUniqueOrThrow({ where: { id: a } })).content)).toContain("Alpha unique");expect(JSON.stringify(updatedB.content)).not.toContain("Alpha");
    const old = await db.pageVersion.findFirstOrThrow({ where: { pageId: a }, orderBy: { createdAt: "asc" } });
    await expect(versions.restorePageVersion(userId, b, old.id, updatedB.revision)).rejects.toMatchObject({ status: 404 });
    await versions.restorePageVersion(userId, a, old.id, first.revision);
    expect((await db.page.findUniqueOrThrow({ where: { id: b } })).revision).toBe(updatedB.revision);
  });
});
