import { expect, type Page } from "@playwright/test";
export const tableControls = (page: Page) => page.locator(".notebook-table-menu[role=menu]");
export async function openTableControls(page: Page, touch = false) {
  const menu = tableControls(page);
  if (!await menu.isVisible()) {
    if (touch) {
      await page.getByRole("button", { name: "Действия выбранного блока", exact: true }).tap();
      await page.getByRole("menuitem", { name: "Таблица", exact: true }).tap();
    } else await page.keyboard.press("Alt+Shift+t");
  }
  await expect(menu).toBeVisible();return menu;
}
export async function tableAction(page: Page, name: string, touch = false) {
  const menu = await openTableControls(page, touch);
  const role = ["Строка заголовков", "Столбец заголовков"].includes(name) ? "menuitemcheckbox" : "menuitem";
  const item = menu.getByRole(role, { name, exact: true });
  if (touch) await item.tap();else await item.click();
  if (role === "menuitem") { await expect(menu).not.toBeVisible();await expect(page.locator(".bn-editor:focus")).toHaveCount(1); }
}
