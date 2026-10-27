import { expect, test } from "@playwright/test";
import { z } from "zod";

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: quick search uses real content results without leaving the editor`, async ({ page }) => {
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Search test" } : credentials })).ok()).toBe(true);
    const id = z.object({ id: z.string() });
    const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Поиск32" } }).then(r => r.json()));
    const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Контроль" } }).then(r => r.json()));
    const { page: note } = z.object({ page: id.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "ЗаголовокИскра7310" } }).then(r => r.json()));
    expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content: [{ type: "paragraph", content: [{ type: "text", text: "ТелоКварц8291 резервирование", styles: {} }] }] } })).ok()).toBe(true);
    await page.addInitScript(t => localStorage.setItem("theme", t), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/pages/${note.id}`);
    await expect(page.locator(".bn-editor")).toContainText("ТелоКварц8291");
    const originalUrl = page.url();
    // Advanced favorites must never leak into global quick search.
    await page.locator(".notebook-sidebar").getByRole("button", { name: "Избранное", exact: true }).click();
    await page.getByTestId("desktop-app-header").getByRole("button", { name: "Notebook", exact: true }).click();
    await page.locator(".bn-editor").evaluate(e => e.setAttribute("data-search-test", "retained"));
    await page.keyboard.press("Control+k");
    const field = page.getByRole("combobox", { name: "Быстрый поиск", exact: true });
    const panel = page.getByRole("region", { name: "Быстрый поиск документов" });
    await expect(field).toBeFocused();
    for (const q of ["ЗаголовокИскра7310", "ТелоКварц8291", "телокварц", "резерв"]) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/search" && new URL(r.url()).searchParams.get("q") === q);
      await field.fill(q);
      expect((await response).ok()).toBe(true);
      await expect(panel.getByRole("option").filter({ hasText: "ЗаголовокИскра7310" })).toBeVisible();
    }
    expect(page.url()).toBe(originalUrl);
    await expect(page.locator(".bn-editor")).toHaveAttribute("data-search-test", "retained");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    // The note remains usable when search fails; errors are not empty results.
    const fail = (route: import("@playwright/test").Route) => route.fulfill({ status: 503, json: { error: "Synthetic search failure" } });
    await page.route("**/api/search?**", fail);
    await page.keyboard.press("Control+k"); await field.fill("ОшибкаТест");
    await expect(panel).toContainText("Synthetic search failure");
    await expect(panel).not.toContainText("Ничего не найдено");
    await page.unroute("**/api/search?**", fail);
    await field.fill("ТелоКварц8291");
    await expect(panel.getByRole("option").first()).toContainText("ЗаголовокИскра7310");
    await field.press("ArrowDown"); await field.press("Enter");
    await expect(panel).toHaveCount(0);
    await expect(page.getByLabel("Название страницы", { exact: true })).toHaveValue("ЗаголовокИскра7310");
    for (const width of [360, 393, 840, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.keyboard.press("Control+k");
      await expect(panel).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      expect(page.url()).toBe(originalUrl);
    }
    await page.keyboard.press("Control+Shift+p");
    await expect(page.getByRole("dialog", { name: "Командная палитра" })).toBeVisible();
  });
}
