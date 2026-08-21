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

test("first user can write, search, restore and reorder notes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Создание администратора" })).toBeVisible();
  await page.getByLabel("Имя").fill("E2E Admin");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Создать и войти" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await answerPrompt(page, "Работа", () => page.getByRole("button", { name: "Добавить блокнот" }).click());
  await answerPrompt(page, "Серверы", () => page.getByRole("button", { name: "Новый раздел" }).click());
  await page.getByRole("button", { name: "Новая страница" }).click();

  const title = "Настройка Unraid";
  const noteText = "Проверить резервное копирование контейнеров";
  await page.getByPlaceholder("Название страницы").fill(title);
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await editor.click();
  await page.keyboard.type(noteText);
  await expect(page.getByText("Сохранение...")).toBeVisible();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue(title);
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText(noteText);
  await page.getByRole("button", { name: `Избранное: ${title}` }).click();

  await page.keyboard.press("Control+K");
  const search = page.getByPlaceholder("Поиск или быстрый переход…");
  await search.fill(title);
  const searchDialog = page.getByRole("dialog", { name: "Быстрый переход" });
  await expect(searchDialog.getByText(title, { exact: true })).toBeVisible();
  await searchDialog.getByText(title, { exact: true }).click();
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue(title);

  await page.getByRole("button", { name: `Действия страницы ${title}` }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Переместить в корзину" }).click();
  await page.getByRole("button", { name: "Корзина" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Восстановить" }).click();
  await expect(page.getByRole("heading", { name: title })).not.toBeVisible();
  await page.getByRole("button", { name: "Вернуться к блокнотам" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Новая страница" }).click();
  await page.getByPlaceholder("Название страницы").fill("Вторая страница");
  await page.keyboard.press("Control+S");
  await expect(page.getByText("Сохранение...")).toBeVisible();
  await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  const reorderResponse = page.waitForResponse((response) => response.url().endsWith("/api/reorder/pages") && response.request().method() === "POST");
  const handle = page.getByRole("button", { name: "Перетащить страницу Вторая страница" });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await reorderResponse;
  await page.reload();
  await expect.poll(() => page.locator("[data-page-title]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-page-title")))).toEqual(["Вторая страница", title]);
});

test("page version can be previewed and restored without a stale autosave overwrite", async ({ page }) => {
  await login(page);
  await page.getByText("Серверы", { exact: true }).click();
  await page.getByRole("button", { name: "Новая страница" }).click();
  const title = "История E2E";
  await page.getByPlaceholder("Название страницы").fill(title);
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await editor.click(); await page.keyboard.type("Первая редакция");
  await page.keyboard.press("Control+S"); await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });
  await editor.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("Вторая редакция");
  await page.keyboard.press("Control+S"); await expect(page.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: `Действия страницы ${title}` }).click();
  await page.getByRole("button", { name: "История версий" }).click();
  const history = page.getByRole("dialog", { name: new RegExp(`История версий.*${title}`) });
  await history.locator("aside button").first().click();
  await expect(history.locator('.bn-editor[contenteditable="true"]')).toContainText("Первая редакция");
  page.once("dialog", (dialog) => dialog.accept());
  await history.getByRole("button", { name: "Восстановить эту версию" }).click();
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText("Первая редакция");
  await page.reload(); await page.getByText(title, { exact: true }).click();
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText("Первая редакция");
});

test("page move updates breadcrumbs and persists its destination", async ({ page }) => {
  await login(page);
  await answerPrompt(page, "Перенос", () => page.getByRole("button", { name: "Новый раздел" }).click());
  await page.getByText("Серверы", { exact: true }).click();
  await page.getByText("История E2E", { exact: true }).click();
  await page.getByRole("button", { name: "Действия страницы История E2E" }).click();
  await page.getByRole("button", { name: "Переместить", exact: true }).click();
  await page.getByRole("button", { name: "Работа / Перенос" }).click();
  await expect(page.getByRole("navigation", { name: "Хлебные крошки" })).toContainText("Работа/Перенос/История E2E");
  await page.reload(); await page.getByText("Перенос", { exact: true }).click();
  await expect(page.getByText("История E2E", { exact: true })).toBeVisible();
});

test("notebook appearance survives reload", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Действия блокнота Работа" }).click();
  await page.getByRole("button", { name: "Настроить блокнот" }).click();
  await page.getByRole("button", { name: "Фиолетовый" }).click();
  await page.getByRole("button", { name: "Дом" }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
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
  await expect(page.getByRole("dialog", { name: "Быстрый переход" })).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText("Страница перемещена в корзину");
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByPlaceholder("Название страницы")).toHaveValue(`Outline ${suffix}`);
  await page.getByRole("button", { name: `Daily ${suffix}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Daily ${suffix}` })).toBeVisible();
  await expect(page.getByText("Недавние", { exact: true })).toBeVisible();
});
