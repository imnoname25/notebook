import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function answerPrompt(page: Page, value: string, action: () => Promise<void>) {
  page.once("dialog", (dialog) => dialog.accept(value));
  await action();
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function expandWorkNotebook(page: Page) {
  const pageId = new URL(page.url()).pathname.match(/^\/pages\/([^/]+)$/)?.[1];
  if (pageId) await expect(page.locator(`[data-page-id="${pageId}"] .bn-editor`)).toHaveAttribute("contenteditable", "true");
  const row = page.locator('[data-notebook-title="Работа"]');
  const toggle = row.locator('[data-nav-row="notebook"] [data-nav-toggle]');
  // Selecting is idempotent; a check-then-toggle races the restored expansion RAF.
  await row.getByRole("button", { name: "Работа", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Работа", exact: true })).toBeVisible();
  return row;
}

async function selectWorkSection(page: Page, title: string) {
  const row = await expandWorkNotebook(page);
  await row.getByTitle(title, { exact: true }).click();
}

test("user can write, search, restore and reorder notes", async ({ page }) => {
  // First-admin setup is an explicit project dependency, not file ordering.
  await login(page);

  await answerPrompt(page, "Работа", () => page.getByRole("button", { name: "Добавить блокнот" }).click());
  await answerPrompt(page, "Серверы", () => page.locator('[data-notebook-title="Работа"]').getByRole("button", { name: "Новый раздел", exact: true }).click());
  await page.locator(".notebook-page-list").getByLabel("Новая страница", { exact: true }).click();

  const title = "Настройка Unraid";
  const noteText = "Проверить резервное копирование контейнеров";
  await page.getByPlaceholder("Название страницы").fill(title);
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await editor.click();
  await page.keyboard.type(noteText);
  await expect(page.getByText("Сохранение…", { exact: true })).toBeVisible();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await page.locator(`[data-page-title="${title}"] [data-page-select]`).click();
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue(title);
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText(noteText);
  await page.getByRole("button", { name: `Избранное: ${title}` }).click();

  await page.keyboard.press("Control+K");
  const search = page.getByRole("combobox", { name: "Быстрый поиск", exact: true });
  await search.fill(title);
  const searchDialog = page.getByRole("region", { name: "Быстрый поиск документов" });
  await expect(searchDialog.getByText(title, { exact: true })).toBeVisible();
  await searchDialog.getByText(title, { exact: true }).click();
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue(title);

  await page.getByRole("button", { name: `Действия страницы ${title}` }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Переместить в корзину" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Страница перемещена в корзину" })).toBeVisible();
  await page.getByRole("button", { name: "Корзина" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).getByRole("button", { name: "Восстановить", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).not.toBeVisible();
  await page.getByRole("button", { name: "Вернуться к блокнотам" }).click();
  await expect(page.locator(`[data-page-title="${title}"]`)).toBeVisible();

  await page.locator(".notebook-page-list").getByLabel("Новая страница", { exact: true }).click();
  await page.getByPlaceholder("Название страницы").fill("Вторая страница");
  const titleSaved = page.waitForResponse(response => response.request().method() === "PATCH" && /\/api\/pages\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.keyboard.press("Control+S");
  expect((await titleSaved).ok()).toBe(true);
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  const reorderResponse = page.waitForResponse((response) => response.url().endsWith("/api/reorder/pages") && response.request().method() === "POST");
  const handle = page.locator('[data-page-title="Вторая страница"] [data-page-select]');
  await handle.focus();
  await expect(handle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(`[data-page-title="${title}"]`)).toHaveAttribute("data-drop-target", "true");
  await page.keyboard.press("Space");
  expect((await reorderResponse).ok()).toBe(true);
  await page.reload();
  await expect.poll(() => page.locator("[data-page-title]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-page-title")))).toEqual(["Вторая страница", title]);
});

test("page version can be previewed and restored without a stale autosave overwrite", async ({ page }) => {
  await login(page);
  await selectWorkSection(page, "Серверы");
  await page.locator(".notebook-page-list").getByLabel("Новая страница", { exact: true }).click();
  const title = "История E2E";
  await page.getByPlaceholder("Название страницы").fill(title);
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await editor.click(); await page.keyboard.type("Первая редакция");
  await page.keyboard.press("Control+S"); await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });
  await editor.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("Вторая редакция");
  await page.keyboard.press("Control+S"); await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: `Действия страницы ${title}` }).click();
  await page.getByRole("button", { name: "История версий" }).click();
  const history = page.getByRole("dialog", { name: `История · ${title}`, exact: true });
  await history.locator(".history-timeline button").nth(1).click();
  await expect(history.locator(".history-diff-row").filter({ hasText: "Первая редакция" })).not.toHaveCount(0);
  await expect(history.locator('[contenteditable="true"]')).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await history.getByRole("button", { name: "Восстановить эту версию" }).click();
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText("Первая редакция");
  await page.reload(); await page.locator(`[data-page-title="${title}"] [data-page-select]`).click();
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText("Первая редакция");
});

test("page move updates breadcrumbs and persists its destination", async ({ page }) => {
  await login(page);
  await expandWorkNotebook(page);
  const sectionCreated = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/sections");
  await answerPrompt(page, "Перенос", () => page.locator('[data-notebook-title="Работа"]').getByRole("button", { name: "Новый раздел", exact: true }).click());
  expect((await sectionCreated).ok()).toBe(true);
  await expect(page.locator(".notebook-page-list")).toContainText("Перенос");
  await selectWorkSection(page, "Серверы");
  await page.locator('[data-page-title="История E2E"] [data-page-select]').click();
  await page.getByRole("button", { name: "Действия страницы История E2E" }).click();
  await page.getByRole("button", { name: "Переместить", exact: true }).click();
  await page.getByRole("button", { name: "Работа / Перенос" }).click();
  await expect(page.getByRole("navigation", { name: "Хлебные крошки" })).toContainText("Работа");
  await expect(page.getByRole("navigation", { name: "Хлебные крошки" })).toContainText("Перенос");
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue("История E2E");
  await page.reload();
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Хлебные крошки" })).toContainText("Перенос");
  await expect(page.locator('[data-page-title="История E2E"]')).toBeVisible();
});

test("notebook appearance survives reload", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Действия блокнота Работа" }).click();
  await page.getByRole("button", { name: "Настроить блокнот" }).click();
  await page.getByRole("button", { name: "Фиолетовый" }).click();
  await page.getByRole("button", { name: "Дом" }).click();
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && /\/api\/notebooks\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByRole("button", { name: "Сохранить" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('[data-notebook-title="Работа"]')).toHaveAttribute("data-notebook-color", "violet");
  await page.reload();
  await expect(page.locator('[data-notebook-title="Работа"]')).toHaveAttribute("data-notebook-color", "violet");
  await expect(page.locator('[data-notebook-title="Работа"]')).toHaveAttribute("data-notebook-icon", "home");
});

test("overview, recent, outline, quick switcher and undo form one workflow", async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const notebook = await page.request.post("/api/notebooks", { data: { title: `Daily ${suffix}` } }).then((response) => response.json());
  const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, title: `Notes ${suffix}`, icon: "document" } }).then((response) => response.json());
  const created = await page.request.post("/api/pages", { data: { sectionId: section.section.id, title: `Outline ${suffix}` } }).then((response) => response.json());
  await page.request.patch(`/api/pages/${created.page.id}`, { data: { expectedRevision: 0, content: [{ id: "heading-one", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Главный заголовок", styles: {} }] }, { type: "paragraph", content: [{ type: "text", text: "Рабочая заметка", styles: {} }] }] } });
  await page.goto(`/pages/${created.page.id}`);
  await expect(page.getByRole("button", { name: "Оглавление" })).toBeVisible();
  await page.getByRole("button", { name: "Оглавление" }).click();
  await expect(page.getByRole("navigation", { name: "Оглавление" })).toContainText("Главный заголовок");
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("region", { name: "Быстрый поиск документов" })).toBeVisible();
  await expect(page.getByText(`Outline ${suffix}`, { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Оглавление" }).click();
  await expect(page.getByRole("dialog", { name: "Оглавление" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("HANDLED");
  await expect(page.getByRole("dialog", { name: "Оглавление" })).toBeHidden();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole("button", { name: new RegExp(`Действия страницы Outline ${suffix}`) }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Переместить в корзину" }).click();
  const undoNotice = page.getByRole("status").filter({ hasText: "Страница перемещена в корзину" });
  await expect(undoNotice).toBeVisible();
  await undoNotice.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue(`Outline ${suffix}`);
  await page.locator(".notebook-sidebar").getByRole("button", { name: `Daily ${suffix}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Daily ${suffix}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Недавние", exact: true })).toBeVisible();
});
