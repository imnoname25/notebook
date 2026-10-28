import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
const noteSchema = z.object({ id: z.string(), title: z.string(), revision: z.number(), content: z.array(z.unknown()) }).passthrough();
async function setup(page: Page) {
  const status = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(status.needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: status.needsSetup ? { ...credentials, name: "Synthetic history" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: `History ${Date.now()}` } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Documents" } }).then(r => r.json()));
  const notes = await Promise.all([`History source ${Date.now()}`, `History target ${Date.now()}`].map(async title => z.object({ page: noteSchema }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title } }).then(r => r.json())).page));
  const [a, b] = notes;
  const paragraph = (id: string, text: string) => ({ id, type: "paragraph", content: [{ type: "text", text, styles: {} }], children: [] });
  const old = [paragraph("history-text", "Старая техническая инструкция"), { id: "history-group", type: "toggleListItem", content: "Группа", children: [paragraph("history-child", "Вложенный текст")] }, { id: "history-table", type: "table", content: { type: "tableContent", rows: [{ cells: ["Имя", "Ссылка", "Значение"] }, { cells: ["Synthetic name", "example.test", "Before"] }] } }, { id: "history-link", type: "paragraph", content: [{ type: "pageLink", props: { pageId: b!.id, text: "Своя подпись", alias: true } }] }];
  const current = [paragraph("history-text", "Новая техническая инструкция"), paragraph("history-added", "Новый блок"), { ...old[2], content: { type: "tableContent", rows: [{ cells: ["Имя", "Ссылка", "Значение"] }, { cells: ["Synthetic name", "example.test", "After"] }] } }];
  for (const [index, content] of [old, current].entries()) expect((await page.request.patch(`/api/pages/${a!.id}`, { data: { content, expectedRevision: index, snapshotReason: "manual" } })).ok()).toBe(true);
  const list = z.object({ versions: z.array(z.object({ id: z.string() })) }).parse(await page.request.get(`/api/pages/${a!.id}/versions`).then(r => r.json()));
  return { a: a!, b: b!, oldVersion: list.versions[0]!.id };
}
async function openHistory(page: Page, title: string) {
  await page.getByRole("button", { name: `Действия страницы ${title}`, exact: true }).click();await page.getByRole("button", { name: "История версий", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /История/ })).toBeVisible();
}
for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: structural diff, block recovery, restore and crash draft conflict`, async ({ page, context }, info) => {
    test.setTimeout(180_000);const { a, b, oldVersion } = await setup(page);const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));page.on("dialog", dialog => void dialog.accept());
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);await page.setViewportSize({ width: 1920, height: 1080 });await page.goto(`/pages/${a.id}`);
    const left = page.locator('.workspace-editor-slot[data-pane="left"]'), right = page.locator('.workspace-editor-slot[data-pane="right"]');await expect(left.locator(".bn-editor")).toBeVisible();
    await left.getByRole("button", { name: "Split View", exact: true }).click();await page.keyboard.press("Control+k");await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(b.title);await page.getByRole("region", { name: "Быстрый поиск документов" }).getByRole("option").filter({ hasText: b.title }).first().click();await expect(right.getByLabel("Название страницы", { exact: true })).toHaveValue(b.title);
    const patches: string[] = [];page.on("request", request => { if (request.method() === "PATCH") patches.push(request.url()); });
    await openHistory(page, a.title);await page.getByLabel("Исходная версия", { exact: true }).selectOption(oldVersion);await expect(page.locator('.history-diff-row[data-change="changed"]')).not.toHaveCount(0);expect(patches).toEqual([]);await expect(page.locator(".bn-editor")).toHaveCount(2);
    await page.screenshot({ path: info.outputPath(`${theme}-compare.png`), animations: "disabled" });
    for (const width of [1440, 840, 360]) { await page.setViewportSize({ width, height: 900 });await expect(page.locator('.history-diff-row[data-change="changed"]')).not.toHaveCount(0);expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({ path: info.outputPath(`${theme}-compare-${width}.png`), animations: "disabled" }); }await page.setViewportSize({ width: 1920, height: 1080 });
    const changed = page.locator(".history-diff-row").filter({ hasText: "Старая техническая инструкция" }).first();await changed.getByRole("button", { name: "Вернуть изменённый фрагмент", exact: true }).click();await expect(page.getByLabel("Версия для сравнения", { exact: true })).toHaveValue("draft");
    await page.getByRole("button", { name: "Закрыть историю", exact: true }).click();await expect(left.locator(".bn-editor")).toContainText("Старая техническая инструкция");
    await left.locator(".bn-editor").focus();await page.keyboard.press("Control+z");await expect(left.locator(".bn-editor")).toContainText("Новая техническая инструкция");await page.keyboard.press("Control+y");await expect(left.locator(".bn-editor")).toContainText("Старая техническая инструкция");await expect(left.getByText("Сохранено", { exact: true })).toBeVisible();
    await openHistory(page, a.title);await page.getByLabel("Исходная версия", { exact: true }).selectOption(oldVersion);await page.getByLabel("Версия для сравнения", { exact: true }).selectOption("saved");
    await page.locator(".history-diff-row").filter({ hasText: "Группа" }).first().getByRole("button", { name: "Восстановить в конец документа", exact: true }).click();
    await page.getByRole("button", { name: "Закрыть историю", exact: true }).click();await expect(left.locator(".bn-editor")).toContainText("Группа");await expect(left.getByText("Сохранено", { exact: true })).toBeVisible();
    // A whole historical table is replaced through the live editor and can also be copied without duplicate IDs.
    await openHistory(page, a.title);await page.getByLabel("Исходная версия", { exact: true }).selectOption(oldVersion);
    const tableRow = page.locator('.history-diff-row').filter({ hasText: "Before" }).first();
    await tableRow.getByRole("button", { name: "Восстановить блок", exact: true }).click();await page.getByRole("button", { name: "Закрыть историю", exact: true }).click();await expect(left.locator(".bn-editor table")).toContainText("Before");await expect(left.getByText("Сохранено", { exact: true })).toBeVisible();
    await openHistory(page, a.title);await page.getByLabel("Исходная версия", { exact: true }).selectOption(oldVersion);await page.locator('.history-diff-row').filter({ hasText: "Before" }).first().getByRole("button", { name: "Вставить копию в конец", exact: true }).click();await page.getByRole("button", { name: "Закрыть историю", exact: true }).click();await expect(left.locator(".bn-editor table")).toHaveCount(2);await expect(left.getByText("Сохранено", { exact: true })).toBeVisible();
    const copied = z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${a.id}`).then(r => r.json())).page;
    const ids: string[] = [];const walk = (items: unknown[]) => { for (const raw of items) { if (raw && typeof raw === "object") { const block = raw as { id?: string; children?: unknown[] };if (block.id) ids.push(block.id);if (block.children) walk(block.children); } } };walk(copied.content);expect(new Set(ids).size).toBe(ids.length);
    await openHistory(page, a.title);await page.getByLabel("Исходная версия", { exact: true }).selectOption(oldVersion);await page.getByRole("button", { name: "Восстановить эту версию", exact: true }).click();await expect(page.getByRole("dialog", { name: /История/ })).toHaveCount(0);await expect(left.locator(".notebook-page-link")).toHaveText("Своя подпись");await expect(right.getByLabel("Название страницы", { exact: true })).toHaveValue(b.title);
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${b.id}/knowledge`).then(r => r.json()))).toContain(a.id);
    const state = z.object({ page: noteSchema }).parse(await page.request.get(`/api/pages/${a.id}`).then(r => r.json())).page;
    const offline = (route: import("@playwright/test").Route) => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Synthetic offline" } }) : route.continue();
    await page.route(`**/api/pages/${a.id}`, offline);await left.locator('[data-id="history-text"] .bn-inline-content').first().click({ position: { x: 2, y: 8 } });await page.keyboard.press("End");await page.keyboard.type(" ЛокальныйЧерновик");await expect(left.getByRole("button", { name: "Повторить сохранение", exact: true })).toBeVisible();
    await page.waitForTimeout(400);const other = await context.newPage();expect((await other.request.patch(`/api/pages/${a.id}`, { data: { expectedRevision: state.revision, title: "Server newer title" } })).ok()).toBe(true);
    await left.getByRole("button", { name: "Сравнить с сервером", exact: true }).click();await expect(page.getByRole("region", { name: "Сравнение при ошибке сохранения" }).locator(".history-diff-row")).not.toHaveCount(0);await page.getByRole("button", { name: "Закрыть сравнение", exact: true }).click();
    // Full navigation simulates a lost JS editor instance. IndexedDB survives; no network save is mocked as successful.
    await page.unroute(`**/api/pages/${a.id}`, offline);await page.reload();await expect(page.getByText("Найден несохранённый черновик", { exact: true })).toBeVisible();await expect(page.getByRole("region", { name: "Локальный черновик" })).toContainText("Конфликт");
    await page.getByRole("button", { name: "Просмотреть изменения", exact: true }).click();await expect(page.locator(".recovery-notice .history-diff-row")).not.toHaveCount(0);
    for (const width of [1440, 840, 360]) { await page.setViewportSize({ width, height: 900 });await expect(page.locator(".recovery-notice .history-diff-row")).not.toHaveCount(0);expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({ path: info.outputPath(`${theme}-recovery-${width}.png`), animations: "disabled" }); }
    await page.getByRole("button", { name: "Восстановить черновик", exact: true }).click();await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${a.id}`).then(r => r.json()))).toContain("ЛокальныйЧерновик");await expect(page.getByText("Найден несохранённый черновик", { exact: true })).toHaveCount(0);
    await other.close();expect(errors).toEqual([]);
  });
}


test("real renderer crash preserves a draft; explicit discard does not repeat", async ({ page, context }) => {
  test.setTimeout(120_000);const { a } = await setup(page);await page.goto(`/pages/${a.id}`);page.on("dialog", dialog => void dialog.accept());
  const editor = page.locator(".bn-editor");await expect(editor).toBeVisible();
  await page.route(`**/api/pages/${a.id}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Synthetic offline" } }) : route.continue());
  await page.locator('[data-id="history-text"] .bn-inline-content').click();await page.keyboard.press("End");await page.keyboard.type(" CrashRecoveryMarker");
  await expect(page.getByRole("button", { name: "Повторить сохранение", exact: true })).toBeVisible();await page.waitForTimeout(400);
  const crashed = page.waitForEvent("crash");const cdp = await context.newCDPSession(page);void cdp.send("Page.crash").catch(() => undefined);await crashed;
  // The crashed target cannot run interception commands. Open another target in the same storage context.
  const reopened = await context.newPage();reopened.on("dialog", dialog => void dialog.accept());await reopened.goto(`/pages/${a.id}`);await expect(reopened.getByText("Найден несохранённый черновик", { exact: true })).toBeVisible();
  await reopened.getByRole("button", { name: "Просмотреть изменения", exact: true }).click();await expect(reopened.locator(".recovery-notice")).toContainText("CrashRecoveryMarker");
  await reopened.getByRole("button", { name: "Оставить серверную версию", exact: true }).click();await expect(reopened.getByText("Найден несохранённый черновик", { exact: true })).toHaveCount(0);
  await reopened.reload();await expect(reopened.locator(".bn-editor")).toBeVisible();await expect(reopened.getByText("Найден несохранённый черновик", { exact: true })).toHaveCount(0);expect(JSON.stringify(await reopened.request.get(`/api/pages/${a.id}`).then(r => r.json()))).not.toContain("CrashRecoveryMarker");await reopened.close();

});

test("history pagination, stale HTTP writers, foreign account and unchanged export format", async ({ page, browser }) => {
  test.setTimeout(120_000);const { a, oldVersion } = await setup(page);let revision = 2;
  for (let index = 0; index < 27; index++) { expect((await page.request.patch(`/api/pages/${a.id}`, { data: { title: `Timeline ${index}`, expectedRevision: revision++, snapshotReason: "manual" } })).ok()).toBe(true); }
  const list = await page.request.get(`/api/pages/${a.id}/versions?limit=25`).then(r => r.json());expect(list.versions).toHaveLength(25);expect(list.versions[0]).not.toHaveProperty("content");expect(list.nextCursor).toBeTruthy();
  const next = await page.request.get(`/api/pages/${a.id}/versions?limit=25&cursor=${list.nextCursor}`).then(r => r.json());expect(next.versions.length).toBeGreaterThan(0);expect(new Set([...list.versions, ...next.versions].map((item: { id: string }) => item.id)).size).toBe(29);
  const races = await Promise.all([page.request.patch(`/api/pages/${a.id}`, { data: { title: "HTTP writer A", expectedRevision: revision } }), page.request.patch(`/api/pages/${a.id}`, { data: { title: "HTTP writer B", expectedRevision: revision } })]);expect(races.map(response => response.status()).sort()).toEqual([200, 409]);
  const foreign = { email: `foreign-${Date.now()}@example.test`, password: "synthetic long password" };
  expect((await page.request.post("/api/admin/users", { data: { ...foreign, name: "Synthetic foreign user", mustChangePassword: false } })).ok()).toBe(true);
  const other = await browser.newContext();expect((await other.request.post("http://127.0.0.1:3100/api/auth/login", { data: foreign })).ok()).toBe(true);
  for (const suffix of ["versions", `versions/${oldVersion}`]) expect((await other.request.get(`http://127.0.0.1:3100/api/pages/${a.id}/${suffix}`)).status()).toBe(404);
  expect((await other.request.post(`http://127.0.0.1:3100/api/pages/${a.id}/versions/${oldVersion}/restore`, { data: { expectedRevision: revision + 1 } })).status()).toBe(404);await other.close();
  const backup = await page.request.get("/api/data/backup");expect(backup.ok()).toBe(true);expect(backup.headers()["content-type"]).toContain("zip");
});
