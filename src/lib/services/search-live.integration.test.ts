import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { EMPTY_SEARCH, searchParams } from "@/lib/workspace-search";

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("native PostgreSQL live search regression", () => {
  let db: typeof import("@/lib/db").db;
  let search: typeof import("./search-service").searchNotebook;
  let userId: string;let otherId: string;let notebookId: string;let pageId: string;
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));({ searchNotebook: search } = await import("./search-service"));
    const marker = randomUUID();
    userId = (await db.user.create({ data: { email: `${marker}@search.test`, name: "Search regression", passwordHash: "unused-test-hash" } })).id;
    otherId = (await db.user.create({ data: { email: `other-${marker}@search.test`, name: "Other", passwordHash: "unused-test-hash" } })).id;
    notebookId = (await db.notebook.create({ data: { userId, title: "Контроль поиска" } })).id;
    const section = await db.section.create({ data: { notebookId, title: "Контролируемые заметки" } });
    const page = await db.page.create({ data: { sectionId: section.id, title: "ЗаголовокИскра7310", content: [] } });pageId = page.id;
    // Exercise the real save/index lifecycle, not a hand-written searchText fixture.
    const { savePage } = await import("./page-service");
    await savePage(userId, pageId, { expectedRevision: 0, content: [{ type: "paragraph", content: [{ type: "text", text: "ТелоКварц8291 резервирование PostgreSQL #контроль", styles: {} }] }] });
    await db.page.createMany({ data: Array.from({ length: 31 }, (_, index) => ({ sectionId: section.id, title: `PaginationToken3281 ${index}`, content: [], searchText: "Synthetic controlled pagination" })) });
  });
  afterAll(async () => { if (db) { await db.user.deleteMany({ where: { id: { in: [userId, otherId].filter(Boolean) } } });await db.$disconnect(); } });
  it.each(["ЗаголовокИскра7310", "заголовокискра", "Искра7310", "ТелоКварц8291", "телокварц", "резерв", "postgr"])("finds title/content/Russian/prefix term %s", async query => {
    expect((await search(userId, query)).results.some(result => result.id === pageId)).toBe(true);
  });
  it("does not lose matching notes when every optional filter is empty", async () => {
    const value = { ...EMPTY_SEARCH, q: "ТелоКварц8291" };
    expect(searchParams(value).toString()).toBe(`q=${encodeURIComponent(value.q)}`);
    expect((await search(userId, value.q, 25, 0, value)).results.some(result => result.id === pageId)).toBe(true);
    // Reproduces 3.1's hidden-filter failure; quick search must never inherit it.
    expect((await search(userId, value.q, 25, 0, { ...value, group: "favorites" })).results).toEqual([]);
  });
  it("respects explicit advanced filters, tag ownership and foreign accounts", async () => {
    expect((await search(userId, "телокварц", 25, 0, { tag: "контроль", notebookId })).results.some(result => result.id === pageId)).toBe(true);
    expect((await search(userId, "телокварц", 25, 0, { tag: "другой" })).results).toEqual([]);
    expect((await search(otherId, "телокварц", 25, 0, { notebookId })).results).toEqual([]);
    expect((await search(userId, "телокварц", 25, 0, { dateFrom: "2099-01-01" })).results).toEqual([]);
  });
  it("paginates bounded results without duplicating or hiding matching pages", async () => {
    const first = await search(userId, "PaginationToken3281");const next = await search(userId, "PaginationToken3281", 25, first.nextOffset!);
    expect(first.results).toHaveLength(25);expect(next.results).toHaveLength(6);
    expect(new Set([...first.results, ...next.results].map(result => result.id)).size).toBe(31);
  });
  it("keeps quoted/operator searches and parameterized hostile filters safe", async () => {
    expect((await search(userId, '"резервирование PostgreSQL"')).results.some(result => result.id === pageId)).toBe(true);
    expect((await search(userId, "телокварц", 25, 0, { notebookId: "') OR 1=1 --" })).results).toEqual([]);
  });
});
