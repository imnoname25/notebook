import { expect, test } from "@playwright/test";

// Runs once after the dedicated database reset, before any feature test.
test("first administrator can complete setup through the real login UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Создание администратора" })).toBeVisible();
  await page.getByLabel("Имя", { exact: true }).fill("E2E Admin");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery staple");
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/setup" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Создать и войти", exact: true }).click();
  expect((await creation).status()).toBe(201);
  await page.waitForURL(/\/app$/);
  await expect(page).toHaveURL(/\/app$/);
  const status = await page.request.get("/api/auth/status");
  expect(status.ok()).toBe(true);
  expect(await status.json()).toMatchObject({ needsSetup: false });
});
