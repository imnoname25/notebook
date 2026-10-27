import { expect, test } from "@playwright/test";
import { z } from "zod";

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: sticker resize persists without changing content or mobile geometry`, async ({ page }) => {
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Polish test" } : credentials })).ok()).toBe(true);
    const { note } = z.object({ note: z.object({ id: z.string() }) }).parse(await page.request.post("/api/quick-notes", { data: { title: "Размер стикера", body: "Текст\n- [ ] Контроль", color: "amber" } }).then(r => r.json()));
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app?view=stickers");
    const card = page.locator(`[data-sticker-id="${note.id}"]`);
    const handle = card.getByRole("button", { name: "Изменить размер стикера", exact: true });
    const rect = (await handle.boundingBox())!;
    await page.mouse.move(rect.x + 14, rect.y + 14);await page.mouse.down();
    await page.mouse.move(rect.x + 134, rect.y + 104, { steps: 20 });await page.mouse.up();
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(440);
    await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBe(430);
    await page.reload();
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(440);
    await card.getByRole("checkbox", { name: "Контроль", exact: true }).check();
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/quick-notes/${note.id}`).then(r => r.json()))).toContain("- [x] Контроль");
    await handle.focus();await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(450);
    for (const width of [360, 393, 840]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(handle).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(450);
    await handle.dblclick();
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(320);
    await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBe(340);
    const header = page.getByTestId("desktop-app-header");
    await header.getByRole("button", { name: /^Профиль:/ }).click();
    await expect(page.getByRole("menuitem", { name: "Настройки", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Выйти", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("region", { name: "Быстрый поиск документов" })).toBeVisible();
    await page.keyboard.press("Escape");await page.keyboard.press("Control+Shift+p");
    await expect(page.getByRole("dialog", { name: "Командная палитра" })).toBeVisible();
  });

  test(`${theme}: row dragging preserves sibling scope and keyboard access`, async ({ page }) => {
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Tree test" } : credentials })).ok()).toBe(true);
    const entity = z.object({ id: z.string() });
    const books: string[] = [];
    for (const title of ["Длинный русский блокнот для проверки дерева", "Соседний блокнот"]) {
      const { notebook } = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", { data: { title } }).then(r => r.json()));books.push(notebook.id);
    }
    const sections: string[] = [];
    for (const title of ["Первый раздел с очень длинным названием", "Второй раздел"]) {
      const { section } = z.object({ section: entity }).parse(await page.request.post("/api/sections", { data: { notebookId: books[0], title } }).then(r => r.json()));sections.push(section.id);
    }
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await page.setViewportSize({ width: 1440, height: 900 });await page.goto("/app");
    const row = page.locator('[data-notebook-title="Длинный русский блокнот для проверки дерева"]');
    await row.getByRole("button", { name: "Длинный русский блокнот для проверки дерева", exact: true }).click();
    const select = row.locator('[data-nav-select][title="Первый раздел с очень длинным названием"]');
    await expect(select).toBeVisible();
    await select.focus();await page.keyboard.press("Space");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="status"]').filter({ hasText: `droppable area ${sections[1]}` })).toBeVisible();
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === "/api/reorder/sections" && r.request().method() === "POST");
    await page.keyboard.press("Space");expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(row.locator('[data-nav-row="section"]').first().locator('[data-nav-select]')).toHaveAttribute("title", "Второй раздел");
    await expect(row.getByRole("button", { name: /Перетащить (блокнот|раздел)/ })).toHaveCount(0);
    const toggle = row.locator('[data-nav-toggle]');await toggle.click();await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();await expect(select).toBeVisible();
  });
}
