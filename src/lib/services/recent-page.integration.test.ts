import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("recent page integration", () => {
  let db: typeof import("@/lib/db").db;
  let service: typeof import("./recent-page-service");
  let ids: { user: string; other: string; page: string };
  beforeAll(async () => { ({ db } = await import("@/lib/db")); service = await import("./recent-page-service"); });
  beforeEach(async () => {
    await db.user.deleteMany();
    const user = await db.user.create({ data: { email: "recent@test.local", name: "Recent", passwordHash: "unused" } });
    const other = await db.user.create({ data: { email: "other-recent@test.local", name: "Other", passwordHash: "unused" } });
    const notebook = await db.notebook.create({ data: { userId: user.id, title: "Notebook" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Section" } });
    const page = await db.page.create({ data: { sectionId: section.id, title: "Page", content: [] } });
    ids = { user: user.id, other: other.id, page: page.id };
  });
  it("creates, updates and scopes recent entries", async () => {
    const first = await service.recordRecentPage(ids.user, ids.page);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await service.recordRecentPage(ids.user, ids.page);
    expect(second.id).toBe(first.id);
    expect(second.lastOpenedAt.getTime()).toBeGreaterThanOrEqual(first.lastOpenedAt.getTime());
    expect(await service.listRecentPages(ids.user)).toHaveLength(1);
    expect(await service.listRecentPages(ids.other)).toHaveLength(0);
    await db.page.update({ where: { id: ids.page }, data: { deletedAt: new Date() } });
    expect(await service.listRecentPages(ids.user)).toHaveLength(0);
  });
});
