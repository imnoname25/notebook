import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
const enabled = !!process.env.TEST_DATABASE_URL && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("template optimistic updates and native table history", () => {
  let db: typeof import("@/lib/db").db;let templates: typeof import("./template-service");let pages: typeof import("./page-service");let versions: typeof import("./page-version-service");let exports: typeof import("./export-service");let user: string;let other: string;let section: string;let directory: string;
  beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "notebook-templates-tables-"));process.env.UPLOAD_DIR = directory;({ db } = await import("@/lib/db"));templates = await import("./template-service");pages = await import("./page-service");versions = await import("./page-version-service");exports = await import("./export-service"); });
  beforeEach(async () => { await db.user.deleteMany();user = (await db.user.create({ data: { email: "template-c@test.local", name: "Source", passwordHash: "unused" } })).id;other = (await db.user.create({ data: { email: "other-c@test.local", name: "Other", passwordHash: "unused" } })).id;const notebook = await db.notebook.create({ data: { userId: user, title: "Notebook" } });section = (await db.section.create({ data: { notebookId: notebook.id, title: "Section" } })).id; });
  afterAll(async () => { if (db) await db.$disconnect();if (directory) await rm(directory, { recursive: true, force: true }); });
  it("allows exactly one concurrent update from the same template token", async () => {
    const template = await templates.createTemplate(user, { name: "Initial", icon: "file-text" });
    const result = await Promise.allSettled(["First", "Second"].map(name => templates.updateTemplate(user, template.id, { name, expectedUpdatedAt: template.updatedAt.toISOString() })));
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);const failure = result.find(r => r.status === "rejected") as PromiseRejectedResult;expect(failure.reason).toMatchObject({ status: 409 });
    const saved = (await db.pageTemplate.findUnique({ where: { id: template.id } }))!;expect(saved.updatedAt.getTime()).toBeGreaterThan(template.updatedAt.getTime());
    await expect(templates.updateTemplate(user, template.id, { name: "No token" })).rejects.toMatchObject({ status: 409 });
    await expect(templates.updateTemplate(other, template.id, { name: "Foreign", expectedUpdatedAt: saved.updatedAt.toISOString() })).rejects.toMatchObject({ status: 404 });
  });
  it("preserves native merged table, widths and page links through template, save, history and export", async () => {
    const target = await pages.createPage(user, { sectionId: section, title: "Target" });
    const content = [{ id: "table-source", type: "table", content: { type: "tableContent", columnWidths: [180, 220, 260], headerRows: 1, rows: [{ cells: [{ type: "tableCell", props: { colspan: 2, rowspan: 1, textAlignment: "left", textColor: "default", backgroundColor: "default" }, content: [{ type: "pageLink", props: { pageId: target.id, text: "Alias", alias: true } }] }, [{ type: "text", text: "Long URL https://example.test/path", styles: {} }]] }, { cells: [[], [], []] }] } }];
    const template = await templates.createTemplate(user, { name: "Table template", icon: "file-text", content });expect(await db.pageLink.count()).toBe(0);
    const created = await pages.createPage(user, { sectionId: section, templateId: template.id });expect(JSON.stringify(created.content)).not.toContain("table-source");expect(await db.pageLink.count({ where: { sourcePageId: created.id } })).toBe(1);
    await pages.savePage(user, created.id, { expectedRevision: created.revision, snapshotReason: "manual" });const history = await versions.listPageVersions(user, created.id, 1);const version = history.versions[0]!;
    const changed = await pages.savePage(user, created.id, { expectedRevision: created.revision, content: [{ type: "paragraph", content: [] }] });expect(await db.pageLink.count({ where: { sourcePageId: created.id } })).toBe(0);
    const restored = await versions.restorePageVersion(user, created.id, version.id, changed.revision);expect(restored.content).toEqual(created.content);expect(await db.pageLink.count({ where: { sourcePageId: created.id } })).toBe(1);
    const exported = await exports.buildPortableExport(user, { backup: true, includeHistory: true, includeDeleted: true });expect(exported.manifest.version).toBe(5);expect(JSON.stringify(exported.data.templates)).toContain("notebook-page://");expect(JSON.stringify(exported.data.templates)).toContain('"columnWidths":[180,220,260]');
  });
});
