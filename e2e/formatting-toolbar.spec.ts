import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { setTestTheme } from "./theme-fixture";
import { openSettings } from "./ui-actions";
import { STUDIO_THEMES } from "../src/lib/themes";

test.use({ actionTimeout: 15_000 });

const entity = z.object({ id: z.string() });
const noteSchema = entity.extend({ title: z.string(), revision: z.number(), content: z.array(z.unknown()) });
const text = (value: string) => [{ type: "text", text: value, styles: {} }];
async function fixture(page: Page) {
  const password = "correct horse battery staple";
  expect((await page.request.post("/api/auth/login", { data: { email: "admin@example.test", password } })).ok()).toBe(true);
  const account = { email: `toolbar-${Date.now()}@example.test`, password };
  expect((await page.request.post("/api/admin/users", { data: { ...account, name: "Synthetic toolbar", role: "USER", mustChangePassword: false } })).ok()).toBe(true);
  await page.request.post("/api/auth/logout");
  expect((await page.request.post("/api/auth/login", { data: account })).ok()).toBe(true);
  const { notebook } = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", { data: { title: "Инструменты редактора" } }).then(r => r.json()));
  const { section } = z.object({ section: entity }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Проверка" } }).then(r => r.json()));
  const notes = [];
  for (const title of ["Форматирование документа", "Независимый документ"]) {
    const { page: created } = z.object({ page: noteSchema }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title } }).then(r => r.json()));
    expect((await page.request.patch(`/api/pages/${created.id}`, { data: { expectedRevision: created.revision, content: [
      { id: "first", type: "paragraph", content: text("Выделенный русский текст") },
      { id: "second", type: "paragraph", content: text("Второй блок") },
      { id: "wide", type: "table", content: { type: "tableContent", headerRows: 1, columnWidths: [320, 320, 320], rows: [{ cells: [text("Имя"), text("Значение"), text("Описание")] }, { cells: [text("Синтетическое имя"), text("https://example.test/technical/path"), text("Длинное значение")] }] } },
    ] } })).ok()).toBe(true);
    notes.push(z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${created.id}`).then(r => r.json())).page);
  }
  return { first: notes[0]!, second: notes[1]! };
}
async function open(page: Page, id: string) {
  await page.goto(`/pages/${id}`);
  await expect(page.locator(`[data-page-id="${id}"] .bn-editor`)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByRole("toolbar", { name: "Форматирование документа", exact: true })).toBeVisible();
}
async function selectFirst(page: Page) {
  await page.locator('[data-id="first"] .bn-inline-content').first().click();
  await page.keyboard.press("Home");await page.keyboard.press("Shift+End");
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Выделенный русский текст");
}
async function saved(page: Page, id: string, predicate: (note: z.infer<typeof noteSchema>) => boolean) {
  await expect.poll(async () => predicate(z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${id}`).then(r => r.json())).page)).toBe(true);
}

for (const theme of ["studio-graphite", "studio-atelier"] as const) test(`${theme}: persistent commands preserve selection, native history and Split ownership`, async ({ page }) => {
  test.setTimeout(180_000);
  const { first, second } = await fixture(page);
  await setTestTheme(page, theme);await page.setViewportSize({ width: 1920, height: 1080 });await open(page, first.id);
  const toolbar = page.getByRole("toolbar", { name: "Форматирование документа", exact: true });
  const writes: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(request.url()).pathname)) writes.push(new URL(request.url()).pathname); });
  await selectFirst(page);
  await expect(page.locator(".bn-formatting-toolbar")).toBeVisible();
  await toolbar.locator('[data-test="bold"]').hover();
  expect(writes).toEqual([]);
  await toolbar.locator('[data-test="bold"]').click();
  await expect(page.locator('[data-id="first"] strong')).toHaveText("Выделенный русский текст");
  await expect(toolbar.locator('[data-test="bold"]')).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.locator('[data-id="first"] strong')).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator('[data-id="first"] strong')).toHaveCount(1);
  for (const level of [1, 2, 3]) {
    await toolbar.getByLabel("Формат блока").selectOption(`h${level}`);
    await expect(page.locator(`[data-id="first"] h${level}`)).toBeVisible();
  }
  await toolbar.getByLabel("Формат блока").selectOption("paragraph");
  await toolbar.getByRole("button", { name: "Списки", exact: true }).click();
  await page.getByRole("menuitem", { name: "Маркированный список", exact: true }).click();
  await expect(page.locator('[data-id="first"] [data-content-type="bulletListItem"]')).toBeVisible();
  await toolbar.getByLabel("Формат блока").selectOption("paragraph");
  await selectFirst(page);
  await toolbar.locator('[data-test="colors"]').click();
  await page.locator('[data-test="text-color-blue"]').click();
  await saved(page, first.id, note => JSON.stringify(note.content).includes('"textColor":"blue"'));
  await page.keyboard.press("Escape");
  await toolbar.locator('[data-test="colors"]').click();
  await page.locator('[data-test="background-color-yellow"]').click();
  await saved(page, first.id, note => JSON.stringify(note.content).includes('"backgroundColor":"yellow"'));
  await page.keyboard.press("Escape");
  await selectFirst(page);await toolbar.getByRole("button", { name: "Вставить ссылку", exact: true }).click();
  await page.getByRole("textbox", { name: "Адрес", exact: true }).fill("https://example.test/reference");
  await page.getByRole("button", { name: "Применить ссылку", exact: true }).click();
  await expect(page.locator('[data-id="first"] a')).toHaveAttribute("href", "https://example.test/reference");
  await expect(page.locator('[data-id="first"] a')).toHaveText("Выделенный русский текст");
  await saved(page, first.id, note => JSON.stringify(note.content).includes("https://example.test/reference"));
  await page.reload();await expect(page.locator('[data-id="first"] a')).toBeVisible();
  await page.locator('[data-id="wide"] td').first().click();
  await toolbar.getByRole("button", { name: "Таблица", exact: true }).click();
  await page.getByRole("menuitem", { name: "Добавить строку", exact: true }).click();
  await expect(page.locator('[data-id="wide"] tr')).toHaveCount(3);
  await toolbar.getByRole("button", { name: "Таблица", exact: true }).click();
  await page.getByRole("menuitem", { name: "Добавить столбец", exact: true }).click();
  await expect(page.locator('[data-id="wide"] tr').first().locator("th,td")).toHaveCount(4);
  await toolbar.getByRole("button", { name: "Вставить", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Изображение", exact: true }).click();
  await (await chooser).setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=", "base64") });
  await expect(page.locator('[data-content-type="image"] img')).toBeVisible();
  await saved(page, first.id, note => JSON.stringify(note.content).includes('"type":"image"'));
  await page.locator('[data-id="second"] .bn-inline-content').click();
  await toolbar.getByRole("button", { name: "Вставить", exact: true }).click();
  await page.getByRole("menuitem", { name: "Таблица", exact: true }).click();
  await expect(page.locator(".bn-editor table")).toHaveCount(2);
  await saved(page, first.id, note => note.content.filter(value => typeof value === "object" && value !== null && "type" in value && value.type === "table").length === 2);


  const unchanged = z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${second.id}`).then(r => r.json())).page;
  await page.getByRole("button", { name: "Split View", exact: true }).click();
  await page.locator(`[data-page-title="${second.title}"] [data-page-select]`).click();
  await expect(page.getByRole("toolbar", { name: "Форматирование документа", exact: true })).toHaveCount(2);
  const right = page.locator('.workspace-editor-slot[data-pane="right"]');
  await right.locator('[data-id="second"] .bn-inline-content').click();await page.keyboard.press("End");
  await right.getByRole("toolbar", { name: "Форматирование документа" }).getByLabel("Формат блока").selectOption("h2");
  await expect(right.locator('[data-id="second"] h2')).toBeVisible();
  await saved(page, second.id, note => note.revision > unchanged.revision);
  await expect(page.locator('.workspace-editor-slot[data-pane="left"] [data-id="second"] [data-content-type="paragraph"]')).toBeVisible();
});

for (const theme of STUDIO_THEMES) test(`${theme}: toolbar layout, preference reload, table context and theme screenshots`, async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const { first, second } = await fixture(page);await setTestTheme(page, theme);
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });await open(page, first.id);
  await page.screenshot({ path: info.outputPath(`${theme}-toolbar-desktop.png`), animations: "disabled" });
  const settings = await openSettings(page);await settings.getByRole("button", { name: "Редактор", exact: true }).click();
  await settings.getByLabel("Панель форматирования", { exact: true }).selectOption("compact");
  await expect(settings.getByText("Режим панели сохранён в аккаунте", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.reload();await expect(page.locator(".editor-formatting-toolbar")).toHaveAttribute("data-toolbar-mode", "compact");
  await page.screenshot({ path: info.outputPath(`${theme}-toolbar-compact.png`), animations: "disabled" });
  await page.setViewportSize({ width: 1920, height: 1080 });await page.getByRole("button", { name: "Split View", exact: true }).click();
  await page.locator(`[data-page-title="${second.title}"] [data-page-select]`).click();
  await expect(page.locator(".editor-formatting-toolbar")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath(`${theme}-toolbar-split.png`), animations: "disabled" });
  for (const width of [360, 840]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, hasTouch: true, isMobile: true, viewport: { width, height: 900 } });
    try {
      await context.addCookies(await page.context().cookies());const touch = await context.newPage();
      touch.on("pageerror", error => errors.push(error.message));
      touch.on("request", request => { if (request.method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
      await open(touch, first.id);
      expect(await touch.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await touch.screenshot({ path: info.outputPath(`${theme}-toolbar-${width}.png`), animations: "disabled" });
      await touch.locator('[data-id="wide"] td').first().tap();
      if (width === 360) {
        await touch.getByRole("button", { name: "Другие инструменты", exact: true }).tap();
        await touch.getByRole("group", { name: "Дополнительное форматирование", exact: true }).getByRole("button", { name: "Таблица", exact: true }).tap();
      } else await touch.getByRole("toolbar", { name: "Форматирование документа" }).getByRole("button", { name: "Таблица", exact: true }).tap();
      await expect(touch.getByRole("menuitem", { name: "Добавить строку", exact: true })).toBeVisible();
      await touch.screenshot({ path: info.outputPath(`${theme}-table-context-${width}.png`), animations: "disabled" });
      await touch.keyboard.press("Escape");
    } finally { await context.close(); }
  }
  expect(writes).toEqual([]);expect(errors).toEqual([]);
});


test("touch toolbar retains editor focus, protects composition and adapts without Page writes", async ({ page, browser }) => {
  const { first } = await fixture(page);await setTestTheme(page, "midnight-ink");
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, hasTouch: true, isMobile: true, viewport: { width: 360, height: 900 } });
  try {
    await context.addCookies(await page.context().cookies());const touch = await context.newPage();
    await open(touch, first.id);
    const toolbar = touch.getByRole("toolbar", { name: "Форматирование документа" });
    const line = touch.locator('[data-id="first"] .bn-inline-content');
    await line.tap();await touch.keyboard.press("Home");await touch.keyboard.press("Shift+End");
    await toolbar.locator('[data-test="bold"]').tap();
    await expect(line.locator("strong")).toHaveText("Выделенный русский текст");
    expect(await touch.locator(".bn-editor").evaluate(node => node.contains(document.activeElement))).toBe(true);
    await saved(touch, first.id, note => JSON.stringify(note.content).includes('"bold":true'));
    const writes: string[] = [];
    touch.on("request", request => { if (request.method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
    await line.dispatchEvent("compositionstart", { data: "" });
    await toolbar.locator('[data-test="italic"]').tap();
    await expect(line.locator("em")).toHaveCount(0);
    await line.dispatchEvent("compositionend", { data: "" });
    for (const [width, height] of [[840, 900], [360, 500], [360, 900]]) {
      await touch.setViewportSize({ width: width!, height: height! });
      await expect(toolbar).toBeVisible();
      expect(await touch.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
    }
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});
