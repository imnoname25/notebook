import { expect, test } from "@playwright/test";
import { z } from "zod";

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: search result scrolls to its snippet without saving highlights`, async ({ page }, info) => {
    const suffix = theme === "studio-graphite" ? "Графит" : "Ателье";
    const title = `ЗаголовокМаяк${suffix}`, needle = `Кварц8291${suffix}`;
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Exact search test" } : credentials })).ok()).toBe(true);
    const id = z.object({ id: z.string() });
    const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Exact search" } }).then(r => r.json()));
    const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Контроль" } }).then(r => r.json()));
    const { page: note } = z.object({ page: id.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title } }).then(r => r.json()));
    const content = Array.from({ length: 100 }, (_, index) => ({ type: "paragraph", content: [{ type: "text", text: index === 99 ? `Контрольный конец ${needle}` : `Синтетический абзац ${index}`, styles: {} }] }));
    expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content } })).ok()).toBe(true);
    const before = await page.request.get(`/api/pages/${note.id}`).then(r => r.json());
    const patches: string[] = [];page.on("request", request => { if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/pages/${note.id}`) patches.push(request.url()); });
    await page.addInitScript(t => localStorage.setItem("theme", t), theme);
    await page.setViewportSize({ width: 1440, height: 900 });await page.goto(`/pages/${note.id}`);
    await expect(page.locator(".bn-editor")).toBeVisible();
    const open = async (query: string, advanced = false) => {
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(query);
      const quick = page.getByRole("region", { name: "Быстрый поиск документов" });
      await expect(quick.getByRole("option").filter({ hasText: title })).toBeVisible();
      if (advanced) {
        await quick.getByRole("button", { name: /^(Расширенный поиск|Все результаты)$/ }).click();
        await page.getByRole("region", { name: "Глобальный поиск" }).locator(".search-result").filter({ hasText: title }).click();
      } else await quick.getByRole("option").filter({ hasText: title }).click();
    };
    const nav = page.getByRole("region", { name: "Совпадения в документе" });
    await open(needle);await expect(nav).toContainText("1 из 1");
    const match = page.locator(".bn-editor .notebook-search-current").first();
    await expect(match).toHaveText(needle);
    await expect.poll(async () => { const a = await match.boundingBox(), b = await page.getByTestId("notebook-editor-canvas").boundingBox();return Boolean(a && b && a.y >= b.y && a.y + a.height <= b.y + b.height); }).toBe(true);
    await page.screenshot({ path: info.outputPath(`${theme}-exact-end.png`) });
    await nav.getByRole("button", { name: "Закрыть совпадения" }).click();await expect(page.locator(".notebook-search-match")).toHaveCount(0);
    await open(title);await expect(page.locator(".notebook-title-search-mirror mark")).toHaveText(title);
    await nav.getByRole("button", { name: "Закрыть совпадения" }).click();
    await open(needle, true);await expect(nav).toContainText("1 из 1");
    await expect(page.locator(`#document-tab-${note.id}`)).toHaveCount(1);
    for (const width of [393, 840]) { await page.setViewportSize({ width, height: 900 });expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); }
    expect(patches).toEqual([]);
    const after = await page.request.get(`/api/pages/${note.id}`).then(r => r.json());expect(after).toEqual(before);
  });
}
