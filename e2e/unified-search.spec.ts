import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

async function prepare(page: Page) {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Search test" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Search workspace" } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Infrastructure" } }).then(r => r.json()));
  const { page: note } = z.object({ page: id.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Network runbook" } }).then(r => r.json()));
  expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, isFavorite: true, content: [{ type: "paragraph", content: [{ type: "text", text: "Docker backup #network", styles: {} }] }] } })).ok()).toBe(true);
  return { notebook, section, note };
}

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: unified search, history, filters, autosave and responsive layout`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const { notebook, section, note } = await prepare(page);
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/pages/${note.id}`);
    const title = page.getByLabel("Название страницы", { exact: true });
    await expect(title).toHaveValue("Network runbook");
    const failSave = (route: import("@playwright/test").Route) => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Synthetic save failure" } }) : route.continue();
    await page.route(`**/api/pages/${note.id}`, failSave);
    await page.locator(".bn-inline-content").first().click();
    await page.keyboard.press("End"); await page.keyboard.type(" pending search save");
    await page.keyboard.press("Control+k"); await page.getByRole("button", { name: /^(Расширенный поиск|Все результаты)$/ }).click();
    const view = page.getByRole("region", { name: "Глобальный поиск" });
    const input = page.getByRole("searchbox", { name: "Поиск по заголовкам и содержимому" });
    const result = view.locator(".search-result").filter({ hasText: "Network runbook" });
    await expect(page.getByRole("button", { name: "Повторить сохранение", exact: true })).toBeVisible();
    await expect(view).toHaveCount(0);
    await expect(page.locator(".bn-editor")).toContainText("pending search save");
    await page.unroute(`**/api/pages/${note.id}`, failSave);
    await page.getByRole("button", { name: "Повторить сохранение", exact: true }).click();
    await page.keyboard.press("Control+k"); await page.getByRole("button", { name: /^(Расширенный поиск|Все результаты)$/ }).click();
    await expect(input).toBeFocused(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#workspace-page-list-panel")).toHaveCount(0);
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${note.id}`).then(r => r.json()))).toContain("pending search save");
    await input.fill("Network"); await expect(result).toBeVisible(); await input.press("Enter");
    await expect(title).toHaveValue("Network runbook");
    await page.goBack(); await expect(input).toHaveValue("Network");
    await page.goForward(); await expect(title).toHaveValue("Network runbook");
    await page.goBack(); await page.getByRole("button", { name: "Вернуться из поиска" }).click();
    for (const [label, screen] of [["Сегодня", "today"], ["Стикеры", "stickers"]]) {
      await page.locator(".notebook-sidebar").getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator(".notebook-app-shell")).toHaveAttribute("data-workspace-screen", screen!);
      await page.keyboard.press("Control+k"); await page.getByRole("button", { name: /^(Расширенный поиск|Все результаты)$/ }).click(); await expect(view).toBeVisible();
      await page.getByRole("button", { name: "Вернуться из поиска" }).click();
      await expect(page.locator(".notebook-app-shell")).toHaveAttribute("data-workspace-screen", screen!);
    }
    await page.keyboard.press("Control+k"); await page.getByRole("button", { name: /^(Расширенный поиск|Все результаты)$/ }).click();
    await page.getByRole("button", { name: "Фильтры поиска", exact: true }).click();
    await page.getByLabel("Блокнот", { exact: true }).selectOption(notebook.id);
    await page.getByLabel("Раздел", { exact: true }).selectOption(section.id);
    await page.getByLabel("Тег", { exact: true }).fill("network");
    await expect(result).toBeVisible();
    await page.getByLabel("Изменено с", { exact: true }).fill("2099-01-01");
    await expect(view).toContainText("Ничего не найдено");
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await input.fill(""); await expect(view.locator(".search-result")).toHaveCount(0);
    await input.fill("no-matches-for-this-query"); await expect(view).toContainText("Ничего не найдено");
    await input.fill("Network"); await expect(result).toBeVisible();
    let releaseOld!: () => void;
    let requestStarted!: () => void;
    let requestFinished!: () => void;
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    const finished = new Promise<void>(resolve => { requestFinished = resolve; });
    const oldResponse = new Promise<void>(resolve => { releaseOld = resolve; });
    const staleRoute = async (route: import("@playwright/test").Route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "slow") { await route.continue(); return; }
      requestStarted(); await oldResponse;
      try { await route.fulfill({ json: { results: [{ type: "page", id: note.id, title: "STALE", titleParts: [{ text: "STALE", highlight: false }], notebookId: notebook.id, notebookTitle: "Test" }], nextOffset: null } }); }
      catch { /* Expected when the obsolete request was cancelled. */ }
      finally { requestFinished(); }
    };
    await page.route("**/api/search?**", staleRoute);
    await input.fill("slow"); await started;
    await input.fill("Network"); await expect(result).toBeVisible();
    releaseOld(); await finished;
    await expect(view).not.toContainText("STALE");
    await page.unroute("**/api/search?**", staleRoute);
    await page.reload(); await expect(input).toHaveValue("Network"); await expect(result).toBeVisible();
    await page.keyboard.press("Control+Shift+p");
    await expect(page.getByRole("dialog", { name: "Командная палитра" })).toBeVisible();
    await page.keyboard.press("Escape");
    for (const width of [1280, 1440, 1920, 393, 840]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(view).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.getByRole("separator")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${theme}-search-${width}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
