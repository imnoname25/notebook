import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("quick capture converts to a tagged page and mobile Back closes its sheet", async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const notebook = await page.request.post("/api/notebooks", { data: { title: `Daily ${suffix}` } }).then((response) => response.json());
  const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, parentId: null, title: `Inbox ${suffix}` } }).then((response) => response.json());
  const note = await page.request.post("/api/quick-notes", { data: { title: `VPN #daily-${suffix}`, body: "Проверить подключение", color: "blue" } }).then((response) => response.json());
  const converted = await page.request.post(`/api/quick-notes/${note.note.id}/convert`, { data: { sectionId: section.section.id } }).then((response) => response.json());

  await page.goto(`/pages/${converted.page.id}`);
  await page.getByRole("button", { name: new RegExp(`#daily-${suffix}`) }).click();
  const tagView = page.getByRole("dialog", { name: new RegExp(`#daily-${suffix}`) });
  await expect(tagView).toBeVisible();
  await expect(tagView).toContainText(`VPN #daily-${suffix}`);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("mobile-app-header").getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("button", { name: "Стикеры", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Новый стикер" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("HANDLED");
  await expect(page.getByRole("dialog", { name: "Новый стикер" })).toBeHidden();
});
