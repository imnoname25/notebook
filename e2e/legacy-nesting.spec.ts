import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
const legacy = [{ id: "legacy-parent", type: "paragraph", content: "Старый родитель", children: [
  { id: "legacy-one", type: "paragraph", content: [{ type: "text", text: "Первая строка {текст}", styles: { bold: true } }] },
  { id: "legacy-two", type: "paragraph", content: "Вторая строка (текст)" },
  { id: "legacy-three", type: "paragraph", content: "Третья строка", children: [{ id: "legacy-deep", type: "paragraph", content: "Вложенная строка" }] },
  { id: "legacy-bullet", type: "bulletListItem", content: "Пункт списка" },
  { id: "legacy-number", type: "numberedListItem", content: "Нумерованный пункт" },
] }, { id: "modern-flat", type: "paragraph", content: [{ type: "text", text: "Новый обычный абзац", styles: {} }], children: [] }, { id: "quote", type: "quote", content: "Настоящая цитата" }];
for (const theme of ["studio-graphite", "studio-atelier"]) test(`${theme}: legacy paragraph nesting keeps data and functional markers`, async ({ page }, info) => {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Legacy test" } : credentials })).ok()).toBe(true);
  const entity = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", { data: { title: "Legacy fixture" } }).then(r => r.json()));
  const { section } = z.object({ section: entity }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Comparison" } }).then(r => r.json()));
  const { page: note } = z.object({ page: entity.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Legacy comparison" } }).then(r => r.json()));
  expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content: legacy } })).ok()).toBe(true);
  const saved = await page.request.get(`/api/pages/${note.id}`).then(r => r.json());
  const patches: string[] = [];page.on("request", r => { if (r.method() === "PATCH") patches.push(r.url()); });
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });await page.goto(`/pages/${note.id}`);
    const canvas = page.getByTestId("notebook-editor-canvas");await expect(canvas).toContainText("Вложенная строка");
    const markers = await canvas.evaluate(root => {
      const get = (id: string) => { const node = root.querySelector(`[data-id="${id}"]`);if (!node) throw new Error("Missing fixture");const s = getComputedStyle(node, "::before");return { content: s.content, display: s.display, border: s.borderLeftWidth, type: node.querySelector("[data-content-type]")?.getAttribute("data-content-type") }; };
      const bullet = root.querySelector('[data-content-type="bulletListItem"]')!;
      return { first: get("legacy-one"), deep: get("legacy-deep"), modern: get("modern-flat"), bullet: getComputedStyle(bullet, "::before").content, quoteBorder: getComputedStyle(root.querySelector("blockquote")!).borderLeftWidth };
    });
    await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`) });await writeFile(info.outputPath(`${theme}-${width}.json`), JSON.stringify(markers, null, 2));
    expect(markers.first.content).toBe("none");expect(markers.deep.content).toBe("none");expect(markers.first.display).toBe("none");expect(markers.modern.content).toBe("none");expect(markers.quoteBorder).toBe("2px");expect(markers.bullet).not.toBe("none");expect(markers.bullet).not.toBe('""');
    await expect(canvas.locator('[data-id="legacy-one"] strong')).toContainText("{текст}");
    await expect(canvas.locator('[data-content-type="numberedListItem"]')).toContainText("Нумерованный пункт");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(patches).toEqual([]);expect(await page.request.get(`/api/pages/${note.id}`).then(r => r.json())).toEqual(saved);
});
