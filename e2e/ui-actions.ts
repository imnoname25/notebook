import { expect, type Page } from "@playwright/test";

export async function openSettings(page: Page) {
  const mobile = page.getByTestId("mobile-app-header");
  if (await mobile.isVisible()) {
    await mobile.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("dialog", { name: "Меню приложения", exact: true })
      .getByRole("button", { name: "Настройки", exact: true }).click();
  } else {
    await page.getByTestId("desktop-app-header").getByRole("button", { name: /^Профиль:/ }).click();
    await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
  }
  const settings = page.getByRole("dialog", { name: "Настройки", exact: true });
  await expect(settings).toBeVisible();
  return settings;
}

export async function openDataSettings(page: Page) {
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Хранилище", exact: true }).click();
  await settings.getByRole("button", { name: "Открыть управление данными", exact: true }).click();
  await expect(settings).toBeHidden();
  const data = page.getByRole("dialog", { name: "Настройки · Данные", exact: true });
  await expect(data).toBeVisible();
  return data;
}
