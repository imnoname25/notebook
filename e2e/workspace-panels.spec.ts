import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

async function setup(page: Page, theme: string) {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Workspace test" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: `Рабочие документы и инфраструктура ${theme}` } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: `Длинное название раздела ${theme}` } }).then(r => r.json()));
  return Promise.all(["Workspace first", "Workspace second"].map(async title => z.object({ page: id.extend({ title: z.string() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title } }).then(r => r.json())).page));
}

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: resize, persistence, focus, mobile isolation and safe last close`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const [first, second] = await setup(page, theme);
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/pages/${first!.id}`);
    const title = page.getByLabel("Название страницы", { exact: true });
    await expect(title).toHaveValue(first!.title);
    const sidebar = page.getByRole("separator", { name: "Ширина панели блокнотов", exact: true });
    const list = page.getByRole("separator", { name: "Ширина списка документов", exact: true });
    await expect(sidebar).toBeVisible();
    await page.locator(".bn-editor").evaluate(node => { node.dataset.resizeIdentity = "retained"; });
    const initial = Number(await sidebar.getAttribute("aria-valuenow"));
    const box = (await sidebar.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 104, box.y + 120, { steps: 12 });
    await page.mouse.up();
    await expect(sidebar).toHaveAttribute("aria-valuenow", String(initial + 100));
    await expect(page.locator(".bn-editor")).toHaveAttribute("data-resize-identity", "retained");
    await page.reload();
    await expect(title).toHaveValue(first!.title);
    await expect(sidebar).toHaveAttribute("aria-valuenow", String(initial + 100));
    await sidebar.focus(); await page.keyboard.press("End");
    await list.focus(); await page.keyboard.press("End");
    for (const width of [1280, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(async () => (await page.locator('[data-mobile-screen="editor"]').boundingBox())!.width).toBeGreaterThanOrEqual(480);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Режим фокуса", exact: true }).click();
    await expect(sidebar).toHaveCount(0);
    await page.getByRole("button", { name: "Выйти из режима фокуса", exact: true }).click();
    await expect(sidebar).toHaveAttribute("aria-valuenow", "420");
    for (const width of [393, 840]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(sidebar).toHaveCount(0);
      await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Навигация", exact: true });
      expect(Math.round((await drawer.boundingBox())!.width)).toBe(Math.min(352, width - 32));
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await sidebar.dblclick();
    await expect(sidebar).toHaveAttribute("aria-valuenow", "230");
    await page.screenshot({ path: info.outputPath(`${theme}-resizable.png`) });
    await page.locator(`[data-page-title="${second!.title}"] button[title]`).click({ modifiers: ["Control"] });
    await expect(title).toHaveValue(second!.title);
    await page.locator(".bn-inline-content").first().click();
    await page.keyboard.type("Saved while closing");
    await page.locator(".document-tabs-strip").getByRole("button", { name: `Закрыть вкладку: ${second!.title}`, exact: true }).click();
    await expect(title).toHaveValue(first!.title);
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${second!.id}`).then(r => r.json()))).toContain("Saved while closing");
    await page.locator(".document-tabs-strip").getByRole("button", { name: `Закрыть вкладку: ${first!.title}`, exact: true }).click();
    await expect(page.locator(".bn-editor")).toHaveCount(0);
    await expect(page.locator(".notebook-editor-pane:visible")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
