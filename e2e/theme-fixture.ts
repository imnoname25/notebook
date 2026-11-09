import { expect, type Page } from "@playwright/test";
import { DEFAULT_APPEARANCE } from "../src/lib/appearance-preferences";

/** Theme fixtures use the same account authority as a real settings change. */
export async function setTestTheme(page: Page, theme: string) {
  const response = await page.request.patch("/api/account/preferences", { data: { appearance: { ...DEFAULT_APPEARANCE, theme } } });
  expect(response.ok()).toBe(true);
  expect((await response.json()).settings.appearance.theme).toBe(theme);
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
}
