import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { internalPageIdsInContent } from "@/lib/portable-content";
import { createZipArchive } from "@/lib/archive";
import type { PreparedImport } from "./import-service";
const enabled = !!process.env.TEST_DATABASE_URL && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("template integrity: real PostgreSQL and ZIP", () => {
  let db: typeof import("@/lib/db").db;
  let exporter: typeof import("./export-service");let importer: typeof import("./import-service");let templates: typeof import("./template-service");let pages: typeof import("./page-service");
  let directory: string;let owner: string;let other: string;let section: string;let target: string;let content: Record<string, unknown>[];
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "notebook-template-integrity-"));process.env.UPLOAD_DIR = directory;
    ({ db } = await import("@/lib/db"));exporter = await import("./export-service");importer = await import("./import-service");templates = await import("./template-service");pages = await import("./page-service");
  });
  beforeEach(async () => {
    await db.user.deleteMany();
    owner = (await db.user.create({ data: { email: "template@test.local", passwordHash: "unused", name: "Source" } })).id;
    other = (await db.user.create({ data: { email: "restore@test.local", passwordHash: "unused", name: "Destination" } })).id;
    const notebook = await db.notebook.create({ data: { userId: owner, title: "Source notebook" } });
    section = (await db.section.create({ data: { notebookId: notebook.id, title: "Source section" } })).id;
    target = (await pages.createPage(owner, { sectionId: section, title: "Одинаковое название" })).id;
    await pages.createPage(owner, { sectionId: section, title: "Одинаковое название" });
    const link = { type: "pageLink", props: { pageId: target, text: "Точный alias", alias: true } };
    content = [{ id: "source-root", type: "callout", props: { kind: "info" }, content: [link], children: [{ id: "source-child", type: "table", content: { type: "tableContent", rows: [{ cells: [[link], [{ type: "link", href: `/pages/${target}#anchor`, content: [{ type: "text", text: "Native alias", styles: {} }] }]] }] } }] }, { id: "source-code", type: "codeBlock", content: [{ type: "text", text: '<script>window.unsafe = true</script> data: blob: javascript:', styles: {} }] }];
    await templates.createTemplate(owner, { name: "Portable template", icon: "file-text", content });
  });
  afterAll(async () => { if (db) await db.$disconnect();if (directory) await rm(directory, { recursive: true, force: true }); });
  async function zip(version?: number, invalid = false, missing = false, duplicate = false): Promise<PreparedImport> {
    const built = await exporter.buildPortableExport(owner, { backup: true, includeDeleted: true, includeHistory: true });
    if (version) { built.manifest.version = version as typeof built.manifest.version;built.data.templates![0]!.content = content as NonNullable<typeof built.data.templates>[number]["content"]; }
    if (invalid) built.data.templates!.push({ name: "Invalid", description: null, icon: "file-text", sortOrder: 10, content: [{ type: "alien" }] });
    if (missing) built.data.notebooks[0]!.sections[0]!.pages.shift();
    if (duplicate) built.data.notebooks[0]!.sections[0]!.pages.push(built.data.notebooks[0]!.sections[0]!.pages[0]!);
    const file = path.join(directory, `${randomUUID()}.zip`);
    await createZipArchive(file, async archive => { archive.append(JSON.stringify(built.manifest), { name: "manifest.json" });archive.append(JSON.stringify(built.data), { name: "backup.json" }); });
    const bytes = new Uint8Array(await readFile(file));
    return importer.prepareImport(new Request("http://test/restore", { method: "POST", headers: { "content-type": "application/zip" }, body: bytes }), "backup");
  }
  it("restores v5 targets by key, preserves aliases/nesting, then creates backlinks only for real pages", async () => {
    const prepared = await zip();
    try {
      expect(prepared.manifest!.version).toBe(5);expect(prepared.summary.warnings).toEqual([]);
      const portableKey = [...internalPageIdsInContent(content)][0]!;
      expect(JSON.stringify(prepared.data!.templates)).not.toContain(portableKey);
      await importer.restoreBackupData(other, prepared);
      const restored = (await db.pageTemplate.findFirst({ where: { userId: other, isBuiltIn: false } }))!;
      const newTargets = [...internalPageIdsInContent(restored.content)];expect(newTargets).toHaveLength(1);expect(newTargets[0]).not.toBe(target);
      expect(await db.page.findFirst({ where: { id: newTargets[0], section: { notebook: { userId: other } } } })).not.toBeNull();
      expect(await db.pageLink.count()).toBe(0);
      const destination = (await db.section.findFirst({ where: { notebook: { userId: other } } }))!;
      const a = await pages.createPage(other, { sectionId: destination.id, templateId: restored.id });
      const b = await pages.createPage(other, { sectionId: destination.id, templateId: restored.id });
      expect(await db.pageLink.count({ where: { targetPageId: newTargets[0] } })).toBe(2);
      expect(JSON.stringify(a.content)).toContain("Точный alias");expect(a.searchText).toContain("data:");
      const ids = (blocks: unknown[]): string[] => blocks.flatMap(raw => { const block = raw as { id: string; children?: unknown[] };return [block.id, ...ids(block.children ?? [])]; });
      const fresh = [...ids(a.content as unknown[]), ...ids(b.content as unknown[])];expect(new Set(fresh).size).toBe(fresh.length);expect(fresh).not.toContain("source-child");
      expect([...internalPageIdsInContent(a.content)]).toEqual(newTargets);
      expect(await db.page.count({ where: { section: { notebook: { userId: owner } } } })).toBe(2);
    } finally { await importer.disposePreparedImport(prepared); }
  });
  it.each([1, 2, 3, 4])("reads legacy v%i; never binds raw IDs to another owner's pages", async version => {
    const prepared = await zip(version);
    try {
      const result = await importer.restoreBackupData(other, prepared);expect(result.warnings![0]).toContain("старый формат");
      const restored = await db.pageTemplate.findFirst({ where: { userId: other, isBuiltIn: false } });
      if (version >= 2) { expect(JSON.stringify(restored!.content)).toContain("missing-");expect(JSON.stringify(restored!.content)).toContain("Точный alias"); }
      expect(await db.pageLink.count()).toBe(0);
    } finally { await importer.disposePreparedImport(prepared); }
  });
  it("rolls back pages, templates and derived indexes when template insertion fails after page restoration", async () => {
    const notebook = await db.notebook.create({ data: { userId: other, title: "Keep" } });
    const destination = await db.section.create({ data: { notebookId: notebook.id, title: "Keep" } });
    const keep = await pages.createPage(other, { sectionId: destination.id, title: "Keep page" });
    const saved = await pages.savePage(other, keep.id, { expectedRevision: keep.revision, content: [{ type: "paragraph", content: [{ type: "text", text: "#rollbacktag", styles: {} }] }] });
    const keepTemplate = await templates.createTemplate(other, { name: "Keep template", icon: "file-text" });
    const prepared = await zip(undefined, true);
    try {
      await expect(importer.restoreBackupData(other, prepared)).rejects.toThrow("не поддерживается");
      expect(await db.page.findUnique({ where: { id: keep.id } })).toEqual(saved);
      expect(await db.pageTemplate.findUnique({ where: { id: keepTemplate.id } })).not.toBeNull();
      expect(await db.page.count({ where: { section: { notebook: { userId: other } } } })).toBe(1);
      expect(await db.pageTag.count({ where: { pageId: keep.id } })).toBe(1);
      expect(await db.pageLink.count()).toBe(0);
    } finally { await importer.disposePreparedImport(prepared); }
  });
  it("marks v5 absent targets unavailable without binding to source-owned or same-title pages", async () => {
    const prepared = await zip(undefined, false, true);
    try {
      expect(prepared.summary.warnings![0]).toContain("цели отсутствуют");
      await importer.restoreBackupData(other, prepared);
      const restored = (await db.pageTemplate.findFirst({ where: { userId: other } }))!;
      expect([...internalPageIdsInContent(restored.content)].every(id => id.startsWith("missing-"))).toBe(true);
      const destination = (await db.section.findFirst({ where: { notebook: { userId: other } } }))!;
      const created = await pages.createPage(other, { sectionId: destination.id, templateId: restored.id });
      expect(JSON.stringify(created.content)).toContain("Точный alias");expect(await db.pageLink.count()).toBe(0);
    } finally { await importer.disposePreparedImport(prepared); }
  });
  it("rejects duplicate portable keys before any database writes", async () => {
    await expect(zip(undefined, false, false, true)).rejects.toMatchObject({ status: 400 });
    expect(await db.notebook.count({ where: { userId: other } })).toBe(0);
  });
  it("keeps an existing template usable after permanent target deletion without rebinding its alias", async () => {
    const template = (await db.pageTemplate.findFirst({ where: { userId: owner } }))!;
    await db.page.delete({ where: { id: target } });
    const created = await pages.createPage(owner, { sectionId: section, templateId: template.id });
    expect(JSON.stringify(created.content)).toContain("Точный alias");expect(JSON.stringify(created.content)).toContain(`missing-${target}`);
    expect(await db.pageLink.count()).toBe(0);
    // Creating a Page does not rewrite the stored template or other documents.
    expect((await db.pageTemplate.findUnique({ where: { id: template.id } }))!.content).toEqual(template.content);
  });
  it("blocks foreign template links and creation from foreign templates", async () => {
    await expect(templates.createTemplate(other, { name: "Foreign", icon: "file-text", content })).rejects.toMatchObject({ status: 404 });
    const template = (await db.pageTemplate.findFirst({ where: { userId: owner } }))!;
    await expect(templates.updateTemplate(other, template.id, { content })).rejects.toMatchObject({ status: 404 });
    await expect(pages.createPage(other, { sectionId: section, templateId: template.id })).rejects.toMatchObject({ status: 404 });
    const exported = await templates.templateExport(owner, template.id);
    expect(exported.version).toBe(2);expect(JSON.stringify(exported)).toContain("notebook-page://missing-");
  });
});
