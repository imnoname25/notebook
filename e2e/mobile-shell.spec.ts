import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("mobile shell keeps a compact safe-area-aware header", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);

  for (const [width, height] of [[360, 800], [390, 844], [412, 915], [430, 932]] as const) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      const mobile = page.getByTestId("mobile-app-header");
      await expect(mobile).toBeVisible();
      await expect(page.getByTestId("desktop-app-header")).toBeHidden();
      const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(metrics.content).toBeLessThanOrEqual(metrics.viewport);
      for (const control of await mobile.getByRole("button").all()) {
        const box = await control.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(48);
        expect(box?.height).toBeGreaterThanOrEqual(48);
      }
      await expect(mobile.getByRole("button", { name: "Открыть навигацию", exact: true })).toBeVisible();
      await expect(mobile.getByRole("button", { name: "Поиск", exact: true })).toBeVisible();
      await expect(mobile.getByRole("button", { name: "Ещё", exact: true })).toBeVisible();
      await expect(mobile.getByRole("button", { name: "Настройки", exact: true })).toHaveCount(0);
      await expect(mobile.getByRole("button", { name: "Выйти", exact: true })).toHaveCount(0);
    });
  }

  await page.evaluate(() => document.documentElement.style.setProperty("--safe-area-inset-top", "24px"));
  const top = await page.getByTestId("mobile-app-header").evaluate((header) => header.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(24);

  await page.getByTestId("mobile-app-header").getByRole("button", { name: "Ещё", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Меню приложения", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Уведомления", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Настройки", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Переключить тему", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Выйти на всех устройствах", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.getByTestId("mobile-app-header")).toBeHidden();
  await expect(page.getByTestId("desktop-app-header")).toBeVisible();
});

test("mobile Back follows editor, pages, notebooks and overlay levels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const suffix = Date.now();
  const notebook = await page.request.post("/api/notebooks", { data: { title: `Mobile ${suffix}` } }).then((response) => response.json());
  const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, parentId: null, title: `Section ${suffix}` } }).then((response) => response.json());
  await page.request.post("/api/pages", { data: { sectionId: section.section.id, title: `Page ${suffix}` } });
  await page.reload();

  await page.getByTitle(`Section ${suffix}`).click();
  await expect(page.locator('[data-mobile-screen="pages"]')).toBeVisible();
  await page.getByTitle(`Page ${suffix}`).click();
  await expect(page.locator('[data-mobile-screen="editor"]')).toBeVisible();

  await expect.poll(() => page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("HANDLED");
  await expect(page.locator('[data-mobile-screen="pages"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("HANDLED");
  await expect(page.locator('[data-mobile-screen="navigation"]')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("UNHANDLED");

  await page.getByTestId("mobile-app-header").getByRole("button").last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("HANDLED");
  await expect(page.getByRole("dialog")).toBeHidden();
});
