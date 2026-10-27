import { expect, test } from "@playwright/test";
import { z } from "zod";
for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: inline links, alias, adjacent pane and live backlinks`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Link test" } : credentials })).ok()).toBe(true);
    const id = z.object({ id: z.string() });
    const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Internal links" } }).then(r => r.json()));
    const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Documents" } }).then(r => r.json()));
    const notes = await Promise.all(["Источник", "РусскаяЦель"].map(async label => z.object({ page: id.extend({ title: z.string(), revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: `${label}${Date.now()}` } }).then(r => r.json())).page));
    const a = notes[0]!;const b = notes[1]!;
    expect((await page.request.patch(`/api/pages/${a.id}`, { data: { expectedRevision: a.revision, content: [{ type: "paragraph", content: [{ type: "text", text: "Synthetic source ", styles: {} }] }] } })).ok()).toBe(true);
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);await page.setViewportSize({ width: 1920, height: 1080 });await page.goto(`/pages/${a.id}`);
    const left = page.locator('.workspace-editor-slot[data-pane="left"]');const right = page.locator('.workspace-editor-slot[data-pane="right"]');
    const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
    await left.locator(".bn-inline-content").first().click({ position: { x: 2, y: 8 } });await page.keyboard.press("End");await page.keyboard.type(`[[${b.title}`);
    await expect(page.getByRole("option").filter({ hasText: b.title })).toBeVisible();await page.screenshot({ path: info.outputPath(`${theme}-picker.png`), animations: "disabled" });await page.keyboard.press("Enter");
    await expect(left.locator(".notebook-page-link")).toHaveText(b.title);await page.keyboard.type(" AliasСлово");await page.keyboard.press("Control+Shift+ArrowLeft");
    await page.getByRole("button", { name: "Ссылка на страницу", exact: true }).click();await page.getByLabel("Найти страницу для ссылки", { exact: true }).fill(b.title);
    await page.getByRole("listitem").filter({ hasText: b.title }).click();await expect(left.locator(".notebook-page-link")).toHaveCount(2);await expect(left.locator(".notebook-page-link").nth(1)).toHaveText("AliasСлово");
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${a.id}`).then(r => r.json()))).toContain('"alias":true');
    await expect(left.getByText("Сохранено", { exact: true })).toBeVisible();await left.locator(".bn-editor").focus();await page.keyboard.press("Control+a");await page.keyboard.press("Control+c");
    const { page: copy } = z.object({ page: id }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Clipboard destination" } }).then(r => r.json()));
    await page.goto(`/pages/${copy.id}`);await expect(left.locator(".bn-editor")).toBeVisible();await expect(left.locator(".notebook-page-link")).toHaveCount(0);
    await left.locator(".bn-editor").focus();await page.keyboard.press("Control+Home");await page.keyboard.press("Control+v");await expect(left.locator(".notebook-page-link")).toHaveCount(2);
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${copy.id}`).then(r => r.json()))).toContain('"alias":true');await expect(left.getByText("Сохранено", { exact: true })).toBeVisible();await page.goto(`/pages/${a.id}`);
    await page.reload();await expect(left.locator(".notebook-page-link")).toHaveCount(2);await left.getByRole("button", { name: "Split View", exact: true }).click();
    await left.locator(".notebook-page-link").first().click({ button: "right" });await page.getByRole("menuitem", { name: "Открыть в соседней панели", exact: true }).click();await expect(right.getByLabel("Название страницы", { exact: true })).toHaveValue(b.title);
    const backlinks = right.locator(".notebook-knowledge");await expect(backlinks).toContainText("На эту страницу ссылаются");await backlinks.locator("summary").click();await expect(backlinks.getByRole("button").filter({ hasText: a.title }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-backlinks.png`), animations: "disabled" });
    const patches: string[] = [];page.on("request", request => { if (request.method() === "PATCH" && request.url().includes(`/api/pages/${a.id}`)) patches.push(request.url()); });
    expect((await page.request.patch(`/api/pages/${b.id}`, { data: { expectedRevision: b.revision, title: "Актуальное название" } })).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));await expect(left.locator(".notebook-page-link").first()).toHaveText("Актуальное название");await expect(left.locator(".notebook-page-link").nth(1)).toHaveText("AliasСлово");expect(patches).toEqual([]);
    expect((await page.request.delete(`/api/pages/${b.id}`)).ok()).toBe(true);await page.evaluate(() => window.dispatchEvent(new Event("focus")));await expect(left.locator(".notebook-page-link").first()).toHaveAttribute("data-unavailable", "true");
    expect((await page.request.post("/api/trash/restore", { data: { type: "page", id: b.id } })).ok()).toBe(true);await page.evaluate(() => window.dispatchEvent(new Event("focus")));await expect(left.locator(".notebook-page-link").first()).toHaveAttribute("data-unavailable", "false");
    for (const width of [360, 840, 1440]) { await page.setViewportSize({ width, height: 900 });expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`), animations: "disabled" }); }
    expect(errors).toEqual([]);
  });
}
