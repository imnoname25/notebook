import { expect, test } from "@playwright/test";
import { z } from "zod";
import { Client } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createZipArchive, extractZipSafely } from "../src/lib/archive";
const id = z.object({ id: z.string() });
const note = id.extend({ sectionId: z.string(), title: z.string(), content: z.array(z.record(z.string(), z.unknown())) });
for (const theme of ["studio-graphite", "studio-atelier"]) test(`${theme}: real ZIP restore, template links, new block IDs and safe code`, async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Template source" } : credentials })).ok()).toBe(true);
  // A portable archive fixture must not inherit uploads/documents from earlier feature tests.
  const sourceEmail = `template-source-${theme}-${Date.now()}@example.test`;
  expect((await page.request.post("/api/admin/users", { data: { name: "Isolated template source", email: sourceEmail, password: credentials.password, role: "ADMIN", mustChangePassword: false } })).ok()).toBe(true);
  expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);
  expect((await page.request.post("/api/auth/login", { data: { email: sourceEmail, password: credentials.password } })).ok()).toBe(true);
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Portable source" } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Portable section" } }).then(r => r.json()));
  const { page: target } = z.object({ page: note }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Одинаковое название" } }).then(r => r.json()));
  expect((await page.request.post("/api/pages", { data: { sectionId: section.id, title: target.title } })).ok()).toBe(true);
  const link = { type: "pageLink", props: { pageId: target.id, text: "Сохранённый alias", alias: true } };
  const templateContent = [{ id: "template-parent", type: "callout", props: { kind: "info" }, content: [link], children: [{ id: "template-child", type: "paragraph", content: [link] }] }, { id: "template-table", type: "table", content: { type: "tableContent", rows: [{ cells: [[link], [{ type: "text", text: "Ячейка", styles: {} }]] }] } }, { id: "template-code", type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: '<script>window.templateExecuted = true</script> data: blob: javascript:', styles: {} }] }];
  const name = `Round-trip ${theme}`;
  const templateResponse = await page.request.post("/api/templates", { data: { name, icon: "file-text", content: templateContent } });expect(templateResponse.status()).toBe(201);
  const { template } = z.object({ template: id }).parse(await templateResponse.json());
  const backup = await page.request.get("/api/data/backup");expect(backup.ok()).toBe(true);const bytes = await backup.body();
  const destinationEmail = `restore-${Date.now()}@example.test`;
  expect((await page.request.post("/api/admin/users", { data: { name: "Restore destination", email: destinationEmail, password: credentials.password, role: "ADMIN", mustChangePassword: false } })).ok()).toBe(true);
  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });const other = await otherContext.newPage();
  try {
    expect((await other.request.post("/api/auth/login", { data: { email: destinationEmail, password: credentials.password } })).ok()).toBe(true);
    expect((await other.request.get(`/api/templates/${template.id}/export`)).status()).toBe(404);
    expect((await other.request.post("/api/templates", { data: { name: "Foreign target", icon: "file-text", content: templateContent } })).status()).toBe(404);
    const restored = await other.request.post("/api/data/restore", { headers: { "content-type": "application/zip", "x-notebook-confirmation": "RESTORE" }, data: bytes });expect(restored.status()).toBe(200);expect(await restored.json()).toMatchObject({ warnings: [] });
    const catalog = z.object({ templates: z.array(id.extend({ name: z.string(), content: z.array(z.record(z.string(), z.unknown())) })) }).parse(await other.request.get("/api/templates").then(r => r.json()));
    const restoredTemplate = catalog.templates.find(t => t.name === name)!;expect(restoredTemplate).toBeTruthy();
    const newTarget = z.object({ content: z.array(z.object({ props: z.object({ pageId: z.string(), text: z.string(), alias: z.boolean() }) }).passthrough()) }).parse({ content: [((restoredTemplate.content[0]!.content as unknown[])[0])] }).content[0]!.props;
    expect(newTarget.pageId).not.toBe(target.id);expect(newTarget.text).toBe("Сохранённый alias");expect(newTarget.alias).toBe(true);
    const { page: newTargetPage } = z.object({ page: note }).parse(await other.request.get(`/api/pages/${newTarget.pageId}`).then(r => r.json()));
    expect(newTargetPage.title).toBe(target.title);
    const knowledge = z.object({ backlinks: z.array(id) });expect(knowledge.parse(await other.request.get(`/api/pages/${newTarget.pageId}/knowledge`).then(r => r.json())).backlinks).toEqual([]);
    const create = async () => { const response = await other.request.post("/api/pages", { data: { sectionId: newTargetPage.sectionId, templateId: restoredTemplate.id } });expect(response.status()).toBe(201);return z.object({ page: note }).parse(await response.json()).page; };
    const created = await create(), copy = await create();
    const blockIds = (blocks: Record<string, unknown>[]): string[] => blocks.flatMap(block => [String(block.id), ...blockIds((block.children ?? []) as Record<string, unknown>[])]);
    const all = [...blockIds(created.content), ...blockIds(copy.content)];expect(new Set(all).size).toBe(all.length);expect(all).not.toContain("template-child");
    expect(knowledge.parse(await other.request.get(`/api/pages/${newTarget.pageId}/knowledge`).then(r => r.json())).backlinks.map(b => b.id)).toEqual(expect.arrayContaining([created.id, copy.id]));
    await other.addInitScript(theme => localStorage.setItem("theme", theme), theme);await other.setViewportSize({ width: 1440, height: 1000 });await other.goto(`/pages/${created.id}`);
    await expect(other.locator(".notebook-page-link")).toHaveCount(3);await expect(other.locator(".notebook-page-link").first()).toHaveText("Сохранённый alias");
    await expect(other.locator('[data-content-type="codeBlock"]')).toContainText("data: blob: javascript:");expect(await other.evaluate(() => "templateExecuted" in window)).toBe(false);
    await other.screenshot({ path: info.outputPath(`${theme}-restored.png`), animations: "disabled" });
    await other.locator(".notebook-page-link").first().click();await expect(other.getByLabel("Название страницы", { exact: true })).toHaveValue(target.title);
    for (const width of [840, 360]) { await other.setViewportSize({ width, height: 900 });await other.goto(`/pages/${created.id}`);await expect(other.locator(".notebook-page-link")).toHaveCount(3);expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await other.screenshot({ path: info.outputPath(`${theme}-restored-${width}.png`), animations: "disabled" }); }
    // Legacy fixture travels over real HTTP; raw IDs must become unavailable, including a default (non-alias) label.
    const archive = info.outputPath("export.zip");await import("node:fs/promises").then(fs => fs.writeFile(archive, bytes));const extracted = info.outputPath("extracted");await extractZipSafely(archive, extracted);
    const manifest = JSON.parse(await readFile(path.join(extracted, "manifest.json"), "utf8")) as Record<string, unknown>;manifest.version = 4;
    const data = JSON.parse(await readFile(path.join(extracted, "backup.json"), "utf8")) as { templates: { name: string; content: unknown[] }[] };
    data.templates = [{ name: "Legacy", content: [{ type: "paragraph", content: [{ type: "pageLink", props: { pageId: target.id, text: "Старое отображаемое название", alias: false } }] }], ...{ description: null, icon: "file-text", sortOrder: 0 } }];
    const legacyPath = info.outputPath("legacy.zip");await createZipArchive(legacyPath, async zip => { zip.append(JSON.stringify(manifest), { name: "manifest.json" });zip.append(JSON.stringify(data), { name: "backup.json" }); });
    const legacy = await other.request.post("/api/data/restore", { headers: { "content-type": "application/zip", "x-notebook-confirmation": "RESTORE" }, data: await readFile(legacyPath) });expect(legacy.status()).toBe(200);expect(z.object({ warnings: z.array(z.string()) }).parse(await legacy.json()).warnings[0]).toContain("старый формат");
    const legacyTemplate = z.object({ templates: z.array(id.extend({ name: z.string() })) }).parse(await other.request.get("/api/templates").then(r => r.json())).templates.find(t => t.name === "Legacy")!;
    const restoredTree = z.object({ notebooks: z.array(z.object({ sections: z.array(id) })) }).parse(await other.request.get("/api/notebooks").then(r => r.json()));
    const legacyPage = z.object({ page: note }).parse(await other.request.post("/api/pages", { data: { sectionId: restoredTree.notebooks[0]!.sections[0]!.id, templateId: legacyTemplate.id } }).then(r => r.json())).page;
    await other.goto(`/pages/${legacyPage.id}`);await expect(other.locator(".notebook-page-link")).toHaveText("Старое отображаемое название");await expect(other.locator(".notebook-page-link")).toHaveAttribute("data-unavailable", "true");
    await other.locator(".notebook-page-link").click();await expect(other).toHaveURL(`/pages/${legacyPage.id}`);
    // Validation failure after restored pages were inserted must retain the safety archive and roll the transaction back.
    const safetyDirectory = path.join(process.env.UPLOAD_DIR!, ".safety-backups");const safetyBefore = new Set(await readdir(safetyDirectory));
    data.templates[0]!.content = [{ type: "alien" }];const brokenPath = info.outputPath("invalid.zip");await createZipArchive(brokenPath, async zip => { zip.append(JSON.stringify(manifest), { name: "manifest.json" });zip.append(JSON.stringify(data), { name: "backup.json" }); });
    const before = await other.request.get("/api/notebooks").then(r => r.json());const failed = await other.request.post("/api/data/restore", { headers: { "content-type": "application/zip", "x-notebook-confirmation": "RESTORE" }, data: await readFile(brokenPath) });expect(failed.status()).toBe(500);expect(await other.request.get("/api/notebooks").then(r => r.json())).toEqual(before);
    const safety = (await readdir(safetyDirectory)).filter(name => name.endsWith(".zip") && !safetyBefore.has(name));expect(safety.length).toBeGreaterThan(0);
    // Inspect only the isolated test database: the source owner must survive all destination restores.
    const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });await client.connect();try { expect((await client.query('SELECT id FROM "Page" WHERE id=$1', [target.id])).rowCount).toBe(1); } finally { await client.end(); }
  } finally { await otherContext.close(); }
});
