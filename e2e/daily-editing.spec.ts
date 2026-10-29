import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
const noteSchema = z.object({ id: z.string(), title: z.string(), revision: z.number(), content: z.array(z.record(z.string(), z.unknown())) });
const text = (text: string) => [{ type: "text", text, styles: {} }];
async function setup(page: Page) {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Daily editing test" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Daily editing" } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Synthetic documents" } }).then(r => r.json()));
  async function create(title: string, content: unknown[]) {
    const { page: note } = z.object({ page: noteSchema }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title } }).then(r => r.json()));
    const updated = await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content } });expect(updated.ok()).toBe(true);
    return z.object({ page: noteSchema }).parse(await updated.json()).page;
  }
  const a = await create(`Типографика${Date.now()}`, [...[1, 2, 3, 4, 5, 6].map(level => ({ id: `daily-h${level}`, type: "heading", props: { level }, content: text(`Уровень ${level}: длинный русский заголовок для проверки переноса в рабочей области документа`) })), { type: "columns", props: { count: 2 }, children: [{ type: "columnPanel", children: [{ id: "nested-h1", type: "heading", props: { level: 1 }, content: text("Вложенный заголовок") }] }, { type: "columnPanel", children: [{ type: "paragraph", content: text("Вторая колонка") }] }] }, { type: "paragraph", content: [] }]);
  const b = await create("Команды", [{ id: "daily-input", type: "paragraph", content: [] }]);
  const c = await create(`ЦельСсылки${Date.now()}`, [{ id: "right-input", type: "paragraph", content: [] }]);
  return { a, b, c, create };
}
for (const theme of ["studio-graphite", "studio-atelier"]) test(`${theme}: headings, native slash, presets, touch and independent Split commands`, async ({ page, browser }, info) => {
  test.setTimeout(240_000);page.setDefaultTimeout(10_000);
  const { a, b, c, create } = await setup(page);const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  const metrics: unknown[] = [];
  for (const width of [1920, 1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });await page.goto(`/pages/${a.id}`);
    const h1 = page.locator('[data-id="daily-h1"] > .bn-block > [data-content-type="heading"]');await expect(h1).toBeVisible();await expect(h1).not.toHaveAttribute("data-level");
    await expect.poll(() => h1.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(width === 1024 ? 24 : 28);
    const sizes = await page.locator('[data-id^="daily-h"] > .bn-block > [data-content-type="heading"]').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
    expect(sizes).toHaveLength(6);expect(sizes[0]).toBeLessThanOrEqual(28);expect(sizes[0]).toBeGreaterThanOrEqual(24);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]!);
    await expect.poll(() => page.locator('[data-id="nested-h1"] [data-content-type="heading"]').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(24);const nested = await page.locator('[data-id="nested-h1"] [data-content-type="heading"]').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);metrics.push({ width, sizes, nested });
    await page.screenshot({ path: info.outputPath(`${theme}-headings-${width}.png`), animations: "disabled" });
  }
  await page.evaluate(() => document.documentElement.style.fontSize = "125%");
  await expect.poll(() => page.locator('[data-id="daily-h1"] [data-content-type="heading"]').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);await page.evaluate(() => document.documentElement.style.fontSize = "");
  await page.setViewportSize({ width: 1920, height: 900 });await page.goto(`/pages/${b.id}`);
  const input = page.locator('[data-id="daily-input"] .bn-inline-content');await input.click();await page.keyboard.type("/");
  const menu = page.locator('.notebook-slash-popover [role="listbox"]');await expect(menu.getByRole("option")).toHaveCount(46);
  expect(await menu.locator(".bn-suggestion-menu-label").allTextContents()).toEqual(["Текст и заголовки", "Списки", "Информационные блоки", "Структура", "Медиа и ссылки", "Дополнительно"]);
  const contrast = await menu.getByRole("option").first().evaluate(node => {
    const canvas = document.createElement("canvas");canvas.width = canvas.height = 1;const context = canvas.getContext("2d")!;
    const luminance = (color: string) => { context.fillStyle = color;context.fillRect(0, 0, 1, 1);const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => { const c = value / 255;return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722; };
    const style = getComputedStyle(node), a = luminance(style.color), b = luminance(style.backgroundColor);return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });expect(contrast).toBeGreaterThanOrEqual(4.5);metrics.push({ selectedMenuContrast: contrast });
  await page.keyboard.press("ArrowDown");await expect(menu.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");await page.keyboard.press("ArrowUp");await page.keyboard.press("PageDown");await expect(menu.getByRole("option").last()).toHaveAttribute("aria-selected", "true");await page.keyboard.press("PageUp");await expect(menu.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath(`${theme}-slash.png`), animations: "disabled" });await page.keyboard.press("Escape");await expect(menu).not.toBeVisible();await expect(input).toHaveText("/");await page.keyboard.press("Backspace");
  await page.keyboard.type("/цит");await expect(menu.getByRole("option")).toHaveCount(1);await expect(menu.getByRole("option").first()).toContainText("Цитата");
  await input.dispatchEvent("compositionstart", { data: "" });await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });await expect(input).toHaveText("/цит");await expect(page.locator('[data-content-type="paragraph"]')).toHaveCount(1);await expect(page.locator('[data-content-type="quote"]')).toHaveCount(0);await input.dispatchEvent("compositionend", { data: "" });
  await page.keyboard.press("Enter");await page.keyboard.type("ЦитатаТекст");await expect(page.locator('[data-content-type="quote"]')).toContainText("ЦитатаТекст");await page.keyboard.press("Control+z");await page.keyboard.press("Control+y");await expect(page.locator('[data-content-type="quote"]')).toContainText("ЦитатаТекст");
  await page.keyboard.type(" /важ");await menu.getByRole("option", { name: "Важно", exact: true }).click();
  const important = page.locator(".notebook-callout").first();await expect(important.getByLabel("Заголовок callout")).toHaveValue("Важно");await expect(important.getByLabel("Тип callout")).toHaveValue("warning");
  await important.locator(".notebook-callout-content").click();await page.keyboard.type("Важный текст /идея");await menu.getByRole("option", { name: "Идея", exact: true }).click();
  await expect(page.locator(".notebook-callout").last().getByLabel("Заголовок callout")).toHaveValue("Идея");await expect(page.locator(".notebook-callout").last().getByLabel("Тип callout")).toHaveValue("note");
  await important.getByLabel("Заголовок callout").focus();await page.keyboard.press("Tab");await expect(important.getByLabel("Тип callout")).toBeFocused();expect(await important.getByLabel("Тип callout").evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();await page.reload();await expect(page.locator(".notebook-callout")).toHaveCount(2);
  const presetState = z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${b.id}`).then(r => r.json())).page;
  expect((await page.request.patch(`/api/pages/${b.id}`, { data: { expectedRevision: presetState.revision, snapshotReason: "manual" } })).ok()).toBe(true);
  const version = z.object({ versions: z.array(z.object({ id: z.string() })) }).parse(await page.request.get(`/api/pages/${b.id}/versions?limit=1`).then(r => r.json())).versions[0]!;
  expect((await page.request.patch(`/api/pages/${b.id}`, { data: { expectedRevision: presetState.revision, title: "Temporary historical change" } })).ok()).toBe(true);
  expect((await page.request.post(`/api/pages/${b.id}/versions/${version.id}/restore`, { data: { expectedRevision: presetState.revision + 1 } })).ok()).toBe(true);
  expect(z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${b.id}`).then(r => r.json())).page.content).toEqual(presetState.content);
  const exported = await page.request.get(`/api/data/export/page/${b.id}?format=json`);expect(exported.ok()).toBe(true);const exportedText = await exported.text();expect(exportedText).toContain("Важно");expect(exportedText).toContain("Идея");await page.reload();await expect(page.locator(".notebook-callout")).toHaveCount(2);
  const prior = await page.request.get(`/api/pages/${b.id}`).then(r => r.json());
  const left = page.locator('.workspace-editor-slot[data-pane="left"]');await left.getByRole("button", { name: "Split View", exact: true }).click();await page.keyboard.press("Control+k");await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(c.title);await page.getByRole("region", { name: "Быстрый поиск документов" }).getByRole("option").filter({ hasText: c.title }).click();
  const right = page.locator('.workspace-editor-slot[data-pane="right"]');await right.locator('[data-id="right-input"] .bn-inline-content').click();await page.keyboard.type("/код");await menu.getByRole("option", { name: /^Блок кода/ }).click();await page.keyboard.type("/цит");await expect(menu).not.toBeVisible();await expect(right.locator('[data-content-type="codeBlock"]')).toContainText("/цит");
  await right.getByLabel("Язык кода", { exact: true }).focus();await page.keyboard.press("Tab");await expect(right.locator(".notebook-code-copy")).toBeFocused();expect(await right.locator(".notebook-code-copy").evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");await page.keyboard.press("Tab");await expect(right.locator(".notebook-code-wrap")).toBeFocused();await page.keyboard.press("Shift+Tab");await expect(right.locator(".notebook-code-copy")).toBeFocused();await page.keyboard.press("Shift+Tab");await expect(right.getByLabel("Язык кода", { exact: true })).toBeFocused();
  expect(await page.request.get(`/api/pages/${b.id}`).then(r => r.json())).toEqual(prior);
  await expect(right.getByText("Сохранено", { exact: true })).toBeVisible();
  await left.getByLabel("Название страницы", { exact: true }).click();await page.keyboard.press("Control+k");await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(a.title);await page.getByRole("region", { name: "Быстрый поиск документов" }).getByRole("option").filter({ hasText: a.title }).click();
  await expect.poll(() => left.locator('[data-id="daily-h1"] [data-content-type="heading"]').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(24);
  const divider = page.getByRole("separator", { name: "Ширина панелей документов", exact: true });await divider.focus();for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(() => left.locator('[data-id="daily-h1"] [data-content-type="heading"]').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(24);
  await page.screenshot({ path: info.outputPath(`${theme}-split.png`), animations: "disabled" });
  const linking = await create("Inline guards", [{ id: "code-input", type: "paragraph", content: [{ type: "text", text: "КодовыйТекст", styles: { code: true } }] }, { id: "link-input", type: "paragraph", content: [] }]);await page.goto(`/pages/${linking.id}`);const linkInput = page.locator('[data-id="link-input"] .bn-inline-content');await page.locator('[data-id="code-input"] code').click({ position: { x: 4, y: 8 } });await page.keyboard.type("/цит");await expect(menu).not.toBeVisible();await expect(page.locator('[data-id="code-input"] code')).toContainText("/цит");await linkInput.click();await page.keyboard.type(`[[${c.title}`);await expect(page.getByRole("option").filter({ hasText: c.title })).toBeVisible();await expect(page.locator('[role="listbox"]:visible')).toHaveCount(1);await page.keyboard.press("Escape");await expect(linkInput).toContainText(`[[${c.title}`);
  await page.keyboard.type(" /ссыл");await menu.getByRole("option", { name: "Ссылка на страницу", exact: true }).click();await page.getByLabel("Найти страницу для ссылки", { exact: true }).fill(c.title);await page.getByRole("listitem").filter({ hasText: c.title }).click();await expect(linkInput.locator(".notebook-page-link")).toHaveText(c.title);
  for (const width of [360, 840]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true, baseURL: "http://127.0.0.1:3100" });await context.addCookies(await page.context().cookies());const touch = await context.newPage();touch.setDefaultTimeout(10_000);await touch.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    try {
      await touch.goto(`/pages/${a.id}`);await expect(touch.locator('[data-id="daily-h1"] [data-content-type="heading"]')).toBeVisible();await expect.poll(() => touch.locator('[data-id="daily-h1"] [data-content-type="heading"]').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(24);
      await touch.screenshot({ path: info.outputPath(`${theme}-touch-headings-${width}.png`), animations: "disabled" });
      const mobile = await create(`Touch commands ${width}`, [{ id: "touch-input", type: "paragraph", content: [] }]);await touch.goto(`/pages/${mobile.id}`);await touch.locator('[data-id="touch-input"] .bn-inline-content').tap();await expect(touch.locator(".bn-editor")).toBeFocused();await touch.keyboard.type("/");const touchMenu = touch.locator('.notebook-slash-popover [role="listbox"]');await expect(touchMenu.getByRole("option")).toHaveCount(46);
      const bounds = await touchMenu.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);expect(bounds!.height).toBeLessThanOrEqual(384);
      expect(await touchMenu.getByRole("option").first().evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await touch.screenshot({ path: info.outputPath(`${theme}-touch-menu-${width}.png`), animations: "disabled" });await touch.setViewportSize({ width, height: 500 });await expect.poll(async () => { const rect = await touchMenu.boundingBox();return rect ? rect.y + rect.height <= 500 : false; }).toBe(true);await touch.setViewportSize({ width, height: 900 });await touch.keyboard.type("таб");await touchMenu.getByRole("option", { name: "Таблица", exact: true }).tap();await expect(touch.locator(".bn-editor table")).toBeVisible();await expect(touch.getByText("Сохранено", { exact: true })).toBeVisible();await touch.reload();await expect(touch.locator(".bn-editor table")).toBeVisible();expect(await touch.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await context.close(); }
  }
  await info.attach("heading-metrics", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });expect(errors).toEqual([]);
});
