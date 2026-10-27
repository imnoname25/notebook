import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("sticker board creates multiple cards without leaving the board", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Стикеры", exact: true }).first().click();
  await expect(page.getByTestId("sticker-board")).toBeVisible();
  const before = await page.getByTestId("sticker-card").count();

  for (const body of ["Стикер A", "Стикер B", "Стикер C"]) {
    await page.getByRole("button", { name: "Новый стикер", exact: true }).first().click();
    const card = page.getByTestId("sticker-card").last();
    await card.getByPlaceholder("Что важно не забыть?").fill(body);
    await card.getByPlaceholder("Что важно не забыть?").blur();
  }

  await expect(page.getByTestId("sticker-card")).toHaveCount(before + 3);
  await page.reload();
  await page.getByRole("button", { name: "Стикеры", exact: true }).first().click();
  await expect(page.getByTestId("sticker-card")).toHaveCount(before + 3);
});

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: freeform canvas is isolated from Today and mobile`, async ({ page }, info) => {
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Canvas test" } : credentials })).ok()).toBe(true);
    const ids: string[] = [];
    for (const title of ["Первая карточка", "Вторая карточка"]) {
      const { note } = z.object({ note: z.object({ id: z.string() }) }).parse(await page.request.post("/api/quick-notes", { data: { title, body: `Текст\n- [ ] ${"ДлиннаяРусскаяСтрока".repeat(30)}\n- [ ] https://example.test/${"longvalue".repeat(30)}`, color: "amber" } }).then(r => r.json()));ids.push(note.id);
    }
    await page.addInitScript(t => localStorage.setItem("theme", t), theme);
    await page.setViewportSize({ width: 1440, height: 900 });await page.goto("/app?view=stickers");
    const first = page.locator(`[data-testid="sticker-card"][data-sticker-id="${ids[0]}"]`), second = page.locator(`[data-testid="sticker-card"][data-sticker-id="${ids[1]}"]`);
    await expect(page.locator('.sticker-freeform-canvas[data-ready="true"]')).toBeVisible();
    const stored = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith("notebook:sticker-board:v4:")).map(key => [key, localStorage.getItem(key)])));
    const resize = first.getByRole("button", { name: "Изменить размер стикера", exact: true });await resize.focus();
    await page.keyboard.press("Shift+ArrowRight");await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBe(360);
    const row = first.getByRole("textbox", { name: "Текст пункта", exact: true }).first();await row.focus();await row.evaluate(node => (node as HTMLTextAreaElement).setSelectionRange(7, 7));
    const handle = (await resize.boundingBox())!;await page.mouse.move(handle.x + 14, handle.y + 14);await page.mouse.down();await page.mouse.move(handle.x + 94, handle.y + 74, { steps: 15 });await page.mouse.up();
    await expect(row).toBeFocused();expect(await row.evaluate(node => (node as HTMLTextAreaElement).selectionStart)).toBe(7);
    for (const field of await first.locator("textarea").all()) {
      const dimensions = await field.evaluate(node => ({ scroll: node.scrollHeight, height: node.clientHeight, width: node.clientWidth, scrollWidth: node.scrollWidth, overflow: getComputedStyle(node).overflowY }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.height + 2);expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 2);expect(dimensions.overflow).toBe("hidden");
    }
    await page.getByLabel("Показать стикер", { exact: true }).selectOption(ids[1]!);
    await second.locator(".sticker-move-handle").focus();for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowLeft");
    const before = await stored();await page.reload();await expect(page.locator('.sticker-freeform-canvas[data-ready="true"]')).toBeVisible();expect(await stored()).toEqual(before);
    await page.screenshot({ path: info.outputPath(`${theme}-canvas.png`) });
    await page.locator(".notebook-sidebar").getByRole("button", { name: "Сегодня", exact: true }).click();
    const today = page.locator(`[data-testid="today-sticker"][data-sticker-id="${ids[1]}"]`);await expect(today).toBeVisible();
    await expect(page.locator(".sticker-freeform-canvas")).toHaveCount(0);await expect(page.locator(".sticker-resize-handle")).toHaveCount(0);
    await today.getByRole("checkbox").first().check();
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/quick-notes/${ids[1]}`).then(r => r.json()))).toContain("- [x]");
    await page.locator(".notebook-sidebar").getByRole("button", { name: "Стикеры", exact: true }).click();await expect(second.getByRole("checkbox").first()).toBeChecked();expect(await stored()).toEqual(before);
    for (const width of [360, 840]) {
      await page.setViewportSize({ width, height: 900 });await expect(resize).toBeHidden();
      expect(await first.evaluate(node => getComputedStyle(node).position)).toBe("relative");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(await stored()).toEqual(before);
    }
    await page.setViewportSize({ width: 1440, height: 900 });expect(await stored()).toEqual(before);
    await page.getByRole("button", { name: "Упорядочить стикеры", exact: true }).click();
    await page.getByRole("button", { name: "Отменить упорядочивание", exact: true }).click();expect(await stored()).toEqual(before);
  });
}
