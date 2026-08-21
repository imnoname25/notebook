import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = databaseUrl;

describe.skipIf(!enabled)("page link integration", () => {
  let db: typeof import("@/lib/db").db;
  let links: typeof import("./page-link-service");
  let ids: { user: string; other: string; source: string; target: string; otherPage: string };
  beforeAll(async () => { ({ db } = await import("@/lib/db")); links = await import("./page-link-service"); });
  beforeEach(async () => {
    await db.user.deleteMany();
    const user = await db.user.create({ data: { email: "links@test.local", name: "Links", passwordHash: "unused" } });
    const other = await db.user.create({ data: { email: "other-links@test.local", name: "Other", passwordHash: "unused" } });
    const notebook = await db.notebook.create({ data: { userId: user.id, title: "Owned" } });
    const section = await db.section.create({ data: { notebookId: notebook.id, title: "Section" } });
    const foreignNotebook = await db.notebook.create({ data: { userId: other.id, title: "Foreign" } });
    const foreignSection = await db.section.create({ data: { notebookId: foreignNotebook.id, title: "Foreign" } });
    const content = [{ type: "paragraph", content: [] }];
    const source = await db.page.create({ data: { sectionId: section.id, title: "Source", content } });
    const target = await db.page.create({ data: { sectionId: section.id, title: "Target", content } });
    const otherPage = await db.page.create({ data: { sectionId: foreignSection.id, title: "Secret", content } });
    ids = { user: user.id, other: other.id, source: source.id, target: target.id, otherPage: otherPage.id };
  });

  it("indexes only owned targets and exposes backlinks only to the owner", async () => {
    await db.$transaction((tx) => links.syncPageLinks(tx, ids.user, ids.source, [{ href: `/pages/${ids.target}` }, { href: `/pages/${ids.otherPage}` }]));
    expect(await db.pageLink.findMany()).toEqual([expect.objectContaining({ sourcePageId: ids.source, targetPageId: ids.target })]);
    const knowledge = await links.getPageKnowledge(ids.user, ids.target);
    expect(knowledge.backlinks.map(({ id }) => id)).toEqual([ids.source]);
    await expect(links.getPageKnowledge(ids.other, ids.target)).rejects.toMatchObject({ status: 404 });
  });
});
