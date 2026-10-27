import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("Studio internal links lifecycle and ownership", () => {
  let db: typeof import("@/lib/db").db;let links: typeof import("./page-link-service");let pages: typeof import("./page-service");let trash: typeof import("./trash-service");let versions: typeof import("./page-version-service");let moves: typeof import("./move-service");let search: typeof import("./search-service");
  const users: string[] = [];let user: string;let other: string;let section: string;let destination: string;let a: string;let b: string;let secret: string;
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));links = await import("./page-link-service");pages = await import("./page-service");trash = await import("./trash-service");versions = await import("./page-version-service");moves = await import("./move-service");search = await import("./search-service");
    for (let i = 0; i < 2; i++) users.push((await db.user.create({ data: { email: `${randomUUID()}@link.test`, name: "Synthetic links", passwordHash: "unused" } })).id);
    [user, other] = users as [string, string];
    const book = await db.notebook.create({ data: { userId: user, title: "Owned" } });section = (await db.section.create({ data: { notebookId: book.id, title: "Original" } })).id;
    const nextBook = await db.notebook.create({ data: { userId: user, title: "Destination" } });destination = (await db.section.create({ data: { notebookId: nextBook.id, title: "Moved" } })).id;
    const foreign = await db.notebook.create({ data: { userId: other, title: "Private" } });const foreignSection = await db.section.create({ data: { notebookId: foreign.id, title: "Private" } });
    a = (await db.page.create({ data: { sectionId: section, title: "Source", content: [] } })).id;b = (await db.page.create({ data: { sectionId: section, title: "РусскийМаяк", content: [] } })).id;
    secret = (await db.page.create({ data: { sectionId: foreignSection.id, title: "Secret target", content: [] } })).id;
    await db.page.createMany({ data: Array.from({ length: 110 }, (_, index) => ({ sectionId: section, title: `РусскийМаяк duplicate ${index}`, content: [] })) });
  });
  afterAll(async () => { if (db) { await db.user.deleteMany({ where: { id: { in: users } } });await db.$disconnect(); } });
  it("indexes confirmed links, retains deleted targets and restores versions without crossing ownership", async () => {
    const inline = (id: string, alias = false) => ({ type: "pageLink", props: { pageId: id, text: alias ? "СвояМетка" : "РусскийМаяк", alias } });
    const content = [{ type: "paragraph", content: [inline(b), inline(b, true), inline(secret), { type: "link", href: "https://example.test/pages/external", content: "external" }] }];
    let source = await pages.savePage(user, a, { expectedRevision: 0, content });
    expect(await db.pageLink.findMany({ where: { sourcePageId: a } })).toEqual([expect.objectContaining({ targetPageId: b })]);
    expect((await links.getPageKnowledge(user, b)).backlinks.map(item => item.id)).toEqual([a]);
    await expect(links.getPageKnowledge(other, b)).rejects.toMatchObject({ status: 404 });expect(await links.getLinkTargets(user, [secret])).toEqual([]);
    expect((await links.getLinkTargets(user, undefined, "РУССКИЙмая")).length).toBe(15);
    const before = await db.page.findUniqueOrThrow({ where: { id: a } });await links.getLinkTargets(user, [b]);await links.getPageKnowledge(user, b);
    expect((await db.page.findUniqueOrThrow({ where: { id: a } })).revision).toBe(before.revision);
    await pages.savePage(user, b, { expectedRevision: 0, title: "Новое название" });await moves.movePage(user, b, destination);
    expect((await links.getLinkTargets(user, [b]))[0]).toMatchObject({ title: "Новое название", sectionTitle: "Moved" });expect((await db.page.findUniqueOrThrow({ where: { id: a } })).content).toEqual(before.content);
    await trash.softDeletePage(user, b);expect(await links.getLinkTargets(user, [b])).toEqual([]);
    source = await pages.savePage(user, a, { expectedRevision: source.revision, title: "Source updated while target deleted" });expect(await db.pageLink.count({ where: { sourcePageId: a, targetPageId: b } })).toBe(1);
    await trash.restoreTrashItem(user, "page", b);expect((await links.getPageKnowledge(user, b)).backlinks.map(item => item.id)).toEqual([a]);
    await expect(pages.savePage(user, a, { expectedRevision: 0, content: [] })).rejects.toMatchObject({ status: 409 });expect(await db.pageLink.count({ where: { sourcePageId: a } })).toBe(1);
    await db.$transaction(tx => versions.createPageSnapshot(tx, { ...source, searchText: source.searchText }, "manual"));
    const snapshot = await db.pageVersion.findFirstOrThrow({ where: { pageId: a }, orderBy: { createdAt: "desc" } });
    source = await pages.savePage(user, a, { expectedRevision: source.revision, content: [] });expect((await links.getPageKnowledge(user, b)).backlinks).toHaveLength(0);
    await versions.restorePageVersion(user, a, snapshot.id, source.revision);expect((await links.getPageKnowledge(user, b)).backlinks.map(item => item.id)).toEqual([a]);
    const results = await search.searchNotebook(user, "СвояМетка");expect(JSON.stringify(results)).toContain(a);
    const exports = await import("./export-service");const imports = await import("./import-service");
    const directory = await mkdtemp(path.join(tmpdir(), "notebook-links42-"));const archive = path.join(directory, "links.zip");
    try {
      await exports.writePortableArchive(user, archive, { includeDeleted: false, includeHistory: true, backup: false });
      const prepared = await imports.prepareImport(new Request("http://local/import", { method: "POST", headers: { "content-type": "application/zip" }, body: await readFile(archive) }));
      try { await imports.commitImport(user, prepared); } finally { await imports.disposePreparedImport(prepared); }
      const original = await db.page.findUniqueOrThrow({ where: { id: a } });
      const clone = await db.page.findFirstOrThrow({ where: { id: { not: a }, title: original.title, section: { notebook: { userId: user } } } });
      const clonedTarget = await db.page.findFirstOrThrow({ where: { id: { not: b }, title: "Новое название", section: { notebook: { userId: user } } } });
      expect(await db.pageLink.findMany({ where: { sourcePageId: clone.id } })).toEqual([expect.objectContaining({ targetPageId: clonedTarget.id })]);
      expect(JSON.stringify(clone.content)).toContain("СвояМетка");expect(JSON.stringify(clone.content)).not.toContain(b);
    } finally { await unlink(archive).catch(() => undefined);await rmdir(directory); }
    const json = await exports.exportPageJson(user, a);
    const preparedPage = await imports.prepareImport(new Request("http://local/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) }));
    try {
      const imported = await imports.commitImport(user, preparedPage, section);
      const copy = await db.page.findUniqueOrThrow({ where: { id: imported.pageId! } });
      expect(JSON.stringify(copy.content)).not.toContain("notebook-page://");expect(JSON.stringify(copy.content)).toContain("СвояМетка");
      expect(await db.pageLink.count({ where: { sourcePageId: copy.id } })).toBe(0);
    } finally { await imports.disposePreparedImport(preparedPage); }
    await db.page.delete({ where: { id: b } });expect(await links.getLinkTargets(user, [b])).toEqual([]);expect(JSON.stringify((await db.page.findUniqueOrThrow({ where: { id: a } })).content)).toContain(b);
  });
});
