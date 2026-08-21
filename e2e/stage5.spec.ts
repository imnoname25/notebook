import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) { await page.goto("/"); await page.getByLabel("Email").fill("admin@example.test"); await page.getByLabel("Пароль").fill("correct horse battery staple"); await page.getByRole("button", { name: "Войти", exact: true }).click(); await expect(page).toHaveURL(/\/app$/); }

test("editor settings persist and remain usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page); await page.getByRole("button", { name: "Настройки", exact: true }).click(); await page.getByRole("button", { name: "Редактор", exact: true }).click(); await page.getByLabel("Ширина контента").selectOption("wide"); await page.getByLabel("Компактный режим").check(); await page.getByRole("button", { name: "Сохранить настройки" }).click(); await page.getByRole("button", { name: "Закрыть" }).click(); await page.reload(); await page.getByRole("button", { name: "Настройки", exact: true }).click(); await page.getByRole("button", { name: "Редактор", exact: true }).click(); await expect(page.getByLabel("Ширина контента")).toHaveValue("wide"); await expect(page.getByLabel("Компактный режим")).toBeChecked();
});

test("manual backup appears in settings and can be deleted", async ({ page }) => {
  await login(page); await page.getByRole("button", { name: "Настройки", exact: true }).click(); await page.getByRole("button", { name: "Резервные копии", exact: true }).click(); await page.getByRole("button", { name: "Создать резервную копию" }).click(); await expect(page.getByRole("link", { name: "Скачать backup" }).first()).toBeVisible({ timeout: 20_000 }); page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "Удалить backup" }).first().click();
});

test("custom callout and safe code language survive reload", async ({ page }) => {
  await login(page); const notebook = await page.request.post("/api/notebooks", { data: { title: "Editor polish" } }).then((response) => response.json()); const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, parentId: null, title: "Blocks" } }).then((response) => response.json()); const created = await page.request.post("/api/pages", { data: { sectionId: section.section.id, title: "Custom blocks" } }).then((response) => response.json()); await page.request.patch(`/api/pages/${created.page.id}`, { data: { expectedRevision: 0, title: "Custom blocks", content: [{ type: "callout", props: { kind: "warning", title: "Важно" }, content: [{ type: "text", text: "Проверьте backup", styles: {} }] }, { type: "codeBlock", props: { language: "typescript" }, content: "const ready = true" }] } }); await page.goto(`/pages/${created.page.id}`); await expect(page.locator(".notebook-callout")).toContainText("Проверьте backup"); await expect(page.locator('[data-content-type="codeBlock"]')).toContainText("const ready = true"); await page.reload(); await expect(page.locator(".notebook-callout")).toBeVisible();
});

test("tabs, collapse, TOC and block deep links preserve editor structure on mobile", async ({ page }) => {
  await login(page);
  const notebook = await page.request.post("/api/notebooks", { data: { title: "Editor 5" } }).then((response) => response.json());
  const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, parentId: null, title: "Layouts" } }).then((response) => response.json());
  const created = await page.request.post("/api/pages", { data: { sectionId: section.section.id, title: "Runbook" } }).then((response) => response.json());
  await page.request.patch(`/api/pages/${created.page.id}`, { data: { expectedRevision: 0, title: "Runbook", content: [
    { id: "toc", type: "tableOfContents", props: { title: "Оглавление", depth: 3 } },
    { id: "collapse", type: "toggleListItem", content: [{ type: "text", text: "VPN" }], children: [{ id: "collapse-heading", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Настройка VPN" }] }] },
    { id: "tabs", type: "tabs", children: [
      { id: "windows-panel", type: "tabPanel", props: { label: "Windows" }, children: [{ id: "windows-text", type: "paragraph", content: [{ type: "text", text: "PowerShell" }] }] },
      { id: "linux-panel", type: "tabPanel", props: { label: "Linux" }, children: [{ id: "linux-heading", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Docker compose" }] }] },
    ] },
    { id: "columns", type: "columns", props: { count: 2 }, children: [{ id: "left-column", type: "columnPanel", props: { label: "Left" }, children: [{ type: "paragraph", content: [{ type: "text", text: "Left column" }] }] }, { id: "right-column", type: "columnPanel", props: { label: "Right" }, children: [{ type: "paragraph", content: [{ type: "text", text: "Right column" }] }] }] },
    { id: "wide-table", type: "table", content: { type: "tableContent", rows: [{ cells: ["A very long cell value", "Second value", "Third value"] }] } },
  ] } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/pages/${created.page.id}#block=linux-heading`);
  await expect(page.getByRole("tab", { name: "Linux" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Docker compose", { exact: true })).toBeVisible();
  await expect(page.locator(".notebook-toc")).toContainText("Настройка VPN");
  await expect(page.locator('[data-content-type="table"] .tableWrapper')).toHaveCSS("overflow-x", "auto");
  await expect(page.locator('[data-content-type="columns"] + .bn-block-group')).toHaveCSS("grid-template-columns", /.+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
