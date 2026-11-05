import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("legacy content preview and search integration", () => {
  let db: typeof import("@/lib/db").db;
  let pages: typeof import("./page-service");
  let search: typeof import("./search-service");
  let ids: { user: string; page: string };
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    pages = await import("./page-service");search = await import("./search-service");
  });
  beforeEach(async () => {
    await db.user.deleteMany();
    const user = await db.user.create({ data: { email: "preview@example.test", name: "Synthetic preview", passwordHash: "unused" } });
    const notebook = await db.notebook.create({ data: { userId: user.id, title: "Synthetic notebook" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Synthetic section" } });
    const page = await pages.createPage(user.id, { sectionId: section.id, title: "Compatibility fixture" });
    ids = { user: user.id, page: page.id };
  });
  it("preserves shorthand JSON while indexing its text through the ordinary save lifecycle", async () => {
    const content = [{ id: "legacy", type: "paragraph", props: { backgroundColor: "transparent" }, content: "Уникальноепревью #legacyfixture", children: [{ id: "nested", type: "paragraph", content: "Вложенный текст" }] }];
    const saved = await pages.savePage(ids.user, ids.page, { content, expectedRevision: 0 });
    expect(saved.content).toEqual(content);
    expect(saved.searchText).toBe("Уникальноепревью #legacyfixture Вложенный текст");
    const found = await search.searchNotebook(ids.user, "уникальноепрев");
    expect(found.results.map(result => result.id)).toContain(ids.page);
    expect(await db.pageTag.count({ where: { pageId: ids.page } })).toBe(1);
    await expect(pages.savePage(ids.user, ids.page, { content: [], expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
    expect((await db.page.findUniqueOrThrow({ where: { id: ids.page } })).content).toEqual(content);
  });
});
