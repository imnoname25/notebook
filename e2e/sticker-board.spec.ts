import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("sticker board creates multiple cards without leaving the board", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Стикеры", exact: true }).first().click();
  await expect(page.getByTestId("sticker-board")).toBeVisible();
  const before = await page.getByTestId("sticker-card").count();

  for (const body of ["Стикер A", "Стикер B", "Стикер C"]) {
    await page.getByRole("button", { name: "Новый стикер", exact: true }).first().click();
    const card = page.getByTestId("sticker-card").last();
    await card.getByPlaceholder("Что важно не забыть?").fill(body);
    await card.getByPlaceholder("Что важно не забыть?").blur();
  }

  await expect(page.getByTestId("sticker-card")).toHaveCount(before + 3);
  await page.reload();
  await page.getByRole("button", { name: "Стикеры", exact: true }).first().click();
  await expect(page.getByTestId("sticker-card")).toHaveCount(before + 3);
});
