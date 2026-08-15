import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
async function login(page: Page) { await page.goto("/"); await page.getByLabel("Email").fill("admin@example.test"); await page.getByLabel("Пароль").fill("correct horse battery staple"); await page.getByRole("button", { name: "Войти", exact: true }).click(); await expect(page).toHaveURL(/\/app$/); }

test("notebook export with attachment can be previewed and imported", async ({ page }, testInfo) => {
  await login(page);
  const notebook = await page.request.post("/api/notebooks", { data: { title: "Portable E2E" } }).then((response) => response.json());
  const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, parentId: null, title: "Imported section" } }).then((response) => response.json());
  const created = await page.request.post("/api/pages", { data: { sectionId: section.section.id, title: "Portable image page" } }).then((response) => response.json());
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const uploaded = await page.request.post("/api/uploads", { multipart: { pageId: created.page.id, file: { name: "portable.png", mimeType: "image/png", buffer: png } } }).then((response) => response.json());
  await page.request.patch(`/api/pages/${created.page.id}`, { data: { expectedRevision: 0, snapshotReason: "manual", title: "Portable image page", content: [{ type: "paragraph", content: [{ type: "text", text: "Portable attachment content", styles: {} }] }, { type: "image", props: { url: uploaded.url } }] } });
  const download = await page.request.get(`/api/data/export/notebook/${notebook.notebook.id}`); expect(download.ok()).toBeTruthy(); const archivePath = testInfo.outputPath("portable.zip"); const archiveBytes = await download.body(); await import("node:fs/promises").then(({ writeFile }) => writeFile(archivePath, archiveBytes));
  await page.reload(); await page.getByRole("button", { name: "Настройки данных" }).click(); await page.getByLabel("Файл импорта").setInputFiles(archivePath); await page.getByRole("button", { name: "Проверить импорт" }).click(); await expect(page.getByText(/1 стр.*1 влож/)).toBeVisible(); await page.getByRole("button", { name: "Импортировать", exact: true }).click(); await expect(page.getByText("Импорт завершён")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Закрыть" }).click(); await expect(page.getByText("Portable E2E (импорт)", { exact: true })).toBeVisible(); await page.getByText("Portable E2E (импорт)", { exact: true }).click(); await page.getByText("Imported section", { exact: true }).click(); await page.getByText("Portable image page", { exact: true }).click(); await expect(page.locator('.bn-editor[contenteditable="true"]')).toContainText("Portable attachment content"); await expect(page.locator(".bn-editor img")).toBeVisible();
});

test("internal page link navigates by stable page ID and browser Back returns", async ({ page }) => {
  await login(page); const notebooks = await page.request.get("/api/notebooks").then((response) => response.json()); const notebook = notebooks.notebooks[0]; const section = notebook.sections[0];
  const target = await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Internal target" } }).then((response) => response.json()); const source = await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Internal source" } }).then((response) => response.json());
  await page.request.patch(`/api/pages/${source.page.id}`, { data: { expectedRevision: 0, title: "Internal source", content: [{ type: "paragraph", content: [{ type: "link", href: `/pages/${target.page.id}`, content: [{ type: "text", text: "Open target", styles: {} }] }] }] } });
  await page.goto(`/pages/${source.page.id}`); await page.locator('.bn-editor a[href^="/pages/"]').click(); await expect(page).toHaveURL(new RegExp(`/pages/${target.page.id}$`)); await expect(page.getByPlaceholder("Название страницы")).toHaveValue("Internal target"); await page.goBack(); await expect(page).toHaveURL(new RegExp(`/pages/${source.page.id}$`)); await expect(page.getByPlaceholder("Название страницы")).toHaveValue("Internal source");
});

test("mobile sequential navigation, search and Back remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page); const firstNotebook = page.locator("[data-notebook-title]").first(); await firstNotebook.getByRole("button").filter({ hasText: /.+/ }).first().click(); const section = page.locator("aside").getByRole("button").filter({ hasText: /Серверы|Перенос|Section/ }).first(); await section.click(); await page.getByRole("button", { name: "Новая страница" }).click(); await expect(page.getByPlaceholder("Название страницы")).toBeVisible(); await page.getByRole("button", { name: "Поиск" }).click(); await expect(page.getByRole("dialog", { name: "Глобальный поиск" })).toBeVisible(); await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Страницы" }).click(); await expect(page.getByRole("button", { name: "Новая страница" })).toBeVisible();
});

test("backup restore replaces content but keeps current admin", async ({ page }, testInfo) => {
  await login(page); const backup = await page.request.get("/api/data/backup"); expect(backup.ok()).toBeTruthy(); const backupPath = testInfo.outputPath("backup.zip"); const bytes = await backup.body(); await import("node:fs/promises").then(({ writeFile }) => writeFile(backupPath, bytes)); await page.request.post("/api/notebooks", { data: { title: "Remove after restore" } });
  const restored = await page.request.post("/api/data/restore", { headers: { "content-type": "application/zip", "x-notebook-confirmation": "RESTORE" }, data: bytes }); expect(restored.ok()).toBeTruthy(); const notebooks = await page.request.get("/api/notebooks").then((response) => response.json()); expect(notebooks.notebooks.map((item: { title: string }) => item.title)).not.toContain("Remove after restore"); await page.reload(); await expect(page).toHaveURL(/\/app$/);
});
