import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { STUDIO_THEMES } from "../src/lib/themes";
import { setTestTheme } from "./theme-fixture";
import { openSettings } from "./ui-actions";

const entity = z.object({ id: z.string() });
const documentSchema = entity.extend({ title: z.string(), revision: z.number(), content: z.array(z.unknown()) });
const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
const inline = (text: string) => [{ type: "text", text, styles: {} }];
async function fixture(page: Page, suffix: string) {
  expect((await page.request.post("/api/auth/login", { data: credentials })).ok()).toBe(true);
  const administratorPreferences = await page.request.get("/api/account/preferences").then(r => r.json());
  const account = { email: `theme-${suffix}-${Date.now()}@example.test`, password: credentials.password };
  expect((await page.request.post("/api/admin/users", { data: { ...account, name: "Synthetic typography", role: "USER", mustChangePassword: false } })).ok()).toBe(true);
  expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);
  expect((await page.request.post("/api/auth/login", { data: account })).ok()).toBe(true);
  const { notebook } = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", { data: { title: "Проверка оформления" } }).then(r => r.json()));
  const { section } = z.object({ section: entity }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Кириллица и документы" } }).then(r => r.json()));
  const { page: created } = z.object({ page: documentSchema }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: `Техническая заметка ${suffix}` } }).then(r => r.json()));
  const content = [
    { id: "theme-heading", type: "heading", props: { level: 2 }, content: inline("Система и наблюдения") },
    ...Array.from({ length: 15 }, (_, index) => ({ id: `theme-p-${index}`, type: "paragraph", content: inline(`Тестовая строка ${index + 1}. Ёжик, шрифт и спокойное чтение длинного документа.`) })),
    { id: "theme-quote", type: "quote", content: inline("Текст цитаты сохраняет структуру и форматирование.") },
    { id: "theme-list", type: "bulletListItem", content: inline("Вложенные данные"), children: [{ id: "theme-nested", type: "bulletListItem", content: inline("Дочерний пункт") }] },
    { id: "theme-code", type: "codeBlock", props: { language: "javascript" }, content: inline("const example = 'Кириллица';\nconsole.log(example);") },
    { id: "theme-table", type: "table", content: { type: "tableContent", columnWidths: [260, 280, 320], rows: [{ cells: [inline("Название"), inline("Значение"), inline("Описание")] }, { cells: [inline("Длинное тестовое название"), inline("Synthetic value"), inline("https://example.test/long/technical/path")] }] } },
  ];
  expect((await page.request.patch(`/api/pages/${created.id}`, { data: { expectedRevision: created.revision, content } })).ok()).toBe(true);
  const { page: second } = z.object({ page: documentSchema }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Соседняя заметка" } }).then(r => r.json()));
  expect((await page.request.post("/api/quick-notes", { data: { title: "Тестовый стикер", body: "Обычный текст\n- [ ] Проверить оформление", color: "amber" } })).ok()).toBe(true);
  const get = async () => z.object({ page: documentSchema }).parse(await page.request.get(`/api/pages/${created.id}`).then(r => r.json())).page;
  return { note: await get(), second, get, administratorPreferences };
}
async function openDocument(page: Page, id: string) {
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === `/api/pages/${id}` && response.request().method() === "GET" && response.ok());
  await page.goto(`/pages/${id}`);await loaded;
  await expect(page.locator(`[data-page-id="${id}"] .bn-editor`)).toHaveAttribute("contenteditable", "true");
}
async function appearance(page: Page) {
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Оформление", exact: true }).click();
  await expect(dialog.getByText("Оформление сохранено в аккаунте", { exact: true })).toBeVisible();
  return dialog;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width);
}

for (const theme of STUDIO_THEMES) test(`${theme}: real workspace palettes, fonts, Single/Split and adaptive views`, async ({ page }, info) => {
  test.setTimeout(180_000);
  const { note, second, get } = await fixture(page, theme);
  await setTestTheme(page, theme);
  const errors: string[] = [], outsideFonts: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.resourceType() === "font" && new URL(request.url()).origin !== new URL(test.info().project.use.baseURL!).origin) outsideFonts.push(request.url());
    if (request.method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDocument(page, note.id);
  await expect(page.locator("html")).toHaveClass(theme);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".notebook-editor .shiki").first()).toBeAttached();
  const documentColor = await page.locator(".bn-editor").evaluate(node => getComputedStyle(node).color);
  await expect(page.locator('[data-content-type="codeBlock"]')).toHaveCSS("color", documentColor);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${theme}-single-1440.png`), animations: "disabled" });
  await page.locator(`[data-page-title="${note.title}"]`).getByRole("button", { name: `Действия страницы ${note.title}`, exact: true }).click();
  await page.getByRole("button", { name: "История версий", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /История/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${theme}-history.png`), animations: "disabled" });
  await page.getByRole("button", { name: "Закрыть историю", exact: true }).click();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(note.title);
  await expect(page.getByRole("region", { name: "Быстрый поиск документов", exact: true })).toContainText(note.title);
  await page.screenshot({ path: info.outputPath(`${theme}-search.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Split View", exact: true }).click();
  await page.locator(`[data-page-title="${second.title}"] [data-page-select]`).click();
  await expect(page.locator(".workspace-editors")).toHaveAttribute("data-two", "true");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${theme}-split-1920.png`), animations: "disabled" });
  await page.locator('.workspace-editor-slot[data-pane="left"] .bn-editor').focus();
  await expect(page.locator('.workspace-editor-slot[data-pane="left"]')).toHaveAttribute("data-active", "true");
  for (const [width, height, label] of [[360, 800, "outer"], [840, 960, "inner"], [900, 480, "landscape"]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.workspace-editor-slot[data-active="true"] .bn-editor')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`${theme}-${label}.png`), animations: "disabled" });
  }
  const dialog = await appearance(page);
  await expect(dialog.locator('[data-theme-choice]')).toHaveCount(10);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${theme}-settings.png`), animations: "disabled" });
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  for (const destination of ["today", "stickers"]) {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === (destination === "today" ? "/api/today" : "/api/quick-notes") && response.ok());
    await page.goto(`/app?view=${destination}`);
    await loaded;
    await expect(page.locator("html")).toHaveClass(theme);
    if (destination === "today") await expect(page.locator(".notebook-today")).toBeVisible();
    else await expect(page.getByRole("region", { name: "Рабочая область стикеров", exact: true })).toContainText("Тестовый стикер");
    await expect(page.getByTestId("mobile-app-header")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`${theme}-${destination}.png`), animations: "disabled" });
  }
  expect(await get()).toEqual(note);
  expect(writes).toEqual([]);expect(outsideFonts).toEqual([]);expect(errors).toEqual([]);
});

test("independent typography persists, synchronizes, retries and preserves document selection", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { note, get, administratorPreferences } = await fixture(page, "preferences");
  await setTestTheme(page, "paper-coffee");
  await page.setViewportSize({ width: 1440, height: 900 });await openDocument(page, note.id);
  const documentWrites: string[] = [];
  page.on("request", request => {
    if (request.method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(request.url()).pathname)) documentWrites.push(request.url());
  });
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await editor.locator('[data-id="theme-p-0"] .bn-inline-content').click();
  await page.keyboard.press("Home");await page.keyboard.press("Shift+End");
  const selection = await page.evaluate(() => getSelection()?.toString());expect(selection).toBeTruthy();
  const panelWidth = (await page.locator(".notebook-sidebar").boundingBox())!.width;
  const dialog = await appearance(page);
  await dialog.getByLabel("Шрифт интерфейса", { exact: true }).selectOption("inter");
  await dialog.getByLabel("Шрифт редактора", { exact: true }).selectOption("jetbrains-mono");
  await dialog.getByLabel("Размер в пикселях", { exact: true }).fill("21");
  await dialog.getByLabel("Межстрочный интервал", { exact: true }).selectOption("relaxed");
  await expect(dialog.getByText("Оформление сохранено в аккаунте", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => ({ ui: document.documentElement.style.getPropertyValue("--notebook-ui-font"), editor: document.documentElement.style.getPropertyValue("--notebook-editor-font") }));
  expect(before.ui).not.toBe(before.editor);
  let releaseThemeWrite!: () => void;
  const themeWriteGate = new Promise<void>(resolve => { releaseThemeWrite = resolve; });
  await page.route("**/api/account/preferences", async route => {
    if (route.request().method() === "PATCH") await themeWriteGate;
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Midnight Ink", exact: true }).click();
  await expect(page.locator("html")).toHaveClass("midnight-ink");
  await expect(dialog.getByText("Сохранение оформления…", { exact: true })).toBeVisible();
  releaseThemeWrite();
  await expect(dialog.getByText("Оформление сохранено в аккаунте", { exact: true })).toBeVisible();
  await page.unroute("**/api/account/preferences");
  expect(await page.evaluate(() => ({ ui: document.documentElement.style.getPropertyValue("--notebook-ui-font"), editor: document.documentElement.style.getPropertyValue("--notebook-editor-font") }))).toEqual(before);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await editor.focus();await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(selection);
  expect((await page.locator(".notebook-sidebar").boundingBox())!.width).toBe(panelWidth);
  await expect(editor).toHaveCSS("font-size", "21px");await expect(editor).toHaveCSS("line-height", "40.95px");
  await page.reload();await expect(editor).toHaveCSS("font-size", "21px");
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await context.addCookies(await page.context().cookies());const second = await context.newPage();
    await openDocument(second, note.id);await expect(second.locator(".bn-editor")).toHaveCSS("font-size", "21px");
    expect((await second.request.patch("/api/account/preferences", { data: { appearance: { uiFont: "source-sans-3" } } })).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--notebook-ui-font"))).not.toBe(before.ui);
  } finally { await context.close(); }
  const settings = await appearance(page);
  await page.route("**/api/account/preferences", route => route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue());
  await settings.getByLabel("Шрифт редактора", { exact: true }).selectOption("literata");
  await expect(settings.getByText("Оформление не синхронизировано", { exact: true })).toBeVisible();
  await page.unroute("**/api/account/preferences");
  await settings.getByRole("button", { name: "Повторить синхронизацию", exact: true }).click();
  await expect(settings.getByText("Оформление сохранено в аккаунте", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Сбросить типографику к теме", exact: true }).click();
  await expect(settings.getByLabel("Шрифт редактора", { exact: true })).toHaveValue("theme");
  await expect(settings.getByText("Оформление сохранено в аккаунте", { exact: true })).toBeVisible();
  expect(await get()).toEqual(note);
  expect(documentWrites).toEqual([]);
  expect((await page.request.patch("/api/account/preferences", { data: { appearance: { uiFont: "url(https://example.test)" } } })).status()).toBe(400);
  expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);
  expect((await page.request.post("/api/auth/login", { data: credentials })).ok()).toBe(true);
  await page.goto("/app");
  const restored = await page.request.get("/api/account/preferences").then(r => r.json());
  expect(restored.settings.appearance).toEqual(administratorPreferences.settings.appearance);
  expect((await page.request.get(`/api/pages/${note.id}`)).status()).toBe(404);
});

test("unknown browser theme falls back to system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "retired-theme"));
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass("light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("system");
});
