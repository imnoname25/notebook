import { expect, test } from "@playwright/test";
import { z } from "zod";

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: checklist editing, card toggles, persistence and portable import`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Checklist test" } : credentials })).ok()).toBe(true);
    const body = "Intro\n- [ ] One\n- [x] Two\n\nSecond list\n- [ ] Three";
    const { note } = z.object({ note: z.object({ id: z.string() }) }).parse(await page.request.post("/api/quick-notes", { data: { title: "Checklist E2E", body, color: "amber" } }).then(r => r.json()));
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });await page.goto("/app?view=stickers");
    const card = page.locator(`[data-testid="sticker-card"][data-sticker-id="${note.id}"]`);
    await expect(card.getByRole("checkbox")).toHaveCount(3);
    await card.getByRole("checkbox", { name: "One", exact: true }).click();
    await card.getByRole("checkbox", { name: "Two", exact: true }).click();
    await card.getByRole("button", { name: /^Переместить стикер/ }).click();
    await card.getByRole("textbox", { name: "Название стикера", exact: true }).fill("Updated checklist");
    const line = card.getByRole("textbox", { name: "Текст пункта", exact: true }).first();
    await line.fill("One edited");await line.press("End");await line.press("Enter");await page.keyboard.type("Next item");await page.keyboard.press("Enter");await page.keyboard.press("Backspace");
    await expect(card.getByRole("checkbox")).toHaveCount(4);
    await expect.poll(async () => (await page.request.get(`/api/quick-notes/${note.id}`).then(r => r.json()) as { note: { body: string } }).note.body).toContain("Next item");
    await page.reload();await expect(card.getByRole("textbox", { name: "Текст пункта", exact: true }).first()).toHaveValue("One edited");
    await page.locator(".notebook-sidebar").getByRole("button", { name: "Сегодня", exact: true }).click();
    const today = page.locator(`[data-testid="today-sticker"][data-sticker-id="${note.id}"]`);
    await today.getByRole("checkbox", { name: "One edited", exact: true }).click();
    await expect(page.locator(".notebook-app-shell")).toHaveAttribute("data-workspace-screen", "today");
    await today.getByRole("checkbox", { name: "One edited", exact: true }).focus();await page.keyboard.press("Space");
    await page.keyboard.press("Control+Shift+n");const capture = page.getByRole("dialog");
    await capture.getByRole("button", { name: "Чек-лист", exact: true }).click();
    await capture.getByRole("textbox", { name: "Текст пункта", exact: true }).fill("Capture task");await page.keyboard.press("Control+Enter");await expect(capture).toHaveCount(0);
    await page.locator(".notebook-sidebar").getByRole("button", { name: "Стикеры", exact: true }).click();
    for (const width of [1440, 393, 840]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`) });
    }
    const before = await page.request.get(`/api/quick-notes/${note.id}`).then(r => r.json()) as { note: { body: string } };
    expect((await page.request.patch(`/api/quick-notes/${note.id}`, { data: { body: "overwrite", expectedBody: "stale" } })).status()).toBe(409);
    const exported = await page.request.get("/api/data/export/all");expect(exported.ok()).toBe(true);
    const imported = await page.request.post("/api/data/import", { data: await exported.body(), headers: { "content-type": "application/zip" } });expect(imported.status()).toBe(201);
    const after = await page.request.get("/api/quick-notes").then(r => r.json()) as { notes: { body: string }[] };
    expect(after.notes.filter(item => item.body === before.note.body).length).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });
}
