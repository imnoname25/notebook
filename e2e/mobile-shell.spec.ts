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

  for (const width of [360, 390, 412]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 860 });
      const mobile = page.getByTestId("mobile-app-header");
      await expect(mobile).toBeVisible();
      await expect(page.getByTestId("desktop-app-header")).toBeHidden();
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
