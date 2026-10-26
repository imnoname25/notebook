import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
async function login(page: Page) {
  const status = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then((r) => r.json()));
  const response = await page.request.post(status.needsSetup ? "/api/auth/setup" : "/api/auth/login", {
    data: status.needsSetup ? { ...credentials, name: "Studio UI test" } : credentials,
  });
  expect(response.ok()).toBe(true);
}

for (const theme of ["studio-graphite", "studio-atelier"] as const) {
  test(`${theme}: responsive composition, persistence and pending autosave`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await login(page);
    const idResponse = z.object({ id: z.string() });
    const notebookResponse = await page.request.post("/api/notebooks", { data: { title: `Studio ${theme}` } });
    expect(notebookResponse.ok()).toBe(true);
    const { notebook } = z.object({ notebook: idResponse }).parse(await notebookResponse.json());
    const sectionResponse = await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Рабочие записи" } });
    expect(sectionResponse.ok()).toBe(true);
    const { section } = z.object({ section: idResponse }).parse(await sectionResponse.json());
    const create = async (title: string) => {
      const response = await page.request.post("/api/pages", { data: { sectionId: section.id, title } });
      expect(response.ok()).toBe(true);
      return z.object({ page: idResponse }).parse(await response.json()).page;
    };
    const first = await create("Домашний сервер");
    const second = await create("Настройка сети");
    await page.addInitScript(({ theme }) => { if (!localStorage.getItem("theme")) localStorage.setItem("theme", theme); }, { theme });
    await page.goto(`/pages/${first.id}`);
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [360, 800], [840, 960]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/pages/${first.id}`);
      await expect(page.locator(".bn-container")).toHaveAttribute("data-color-scheme", theme === "studio-graphite" ? "dark" : "light");
      await expect(page.locator(".notebook-page-title-input")).toHaveValue("Домашний сервер");
      const metrics = await page.evaluate(() => {
        const action = document.querySelector<HTMLElement>(".notebook-editor-header-action")!.getBoundingClientRect();
        return { viewport: innerWidth, content: document.documentElement.scrollWidth, actionRight: action.right };
      });
      expect(metrics.content).toBeLessThanOrEqual(width);
      expect(metrics.actionRight).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const editor = page.locator('.bn-editor[contenteditable="true"]');
    await editor.click();
    const marker = `Pending ${theme}`;
    await page.keyboard.type(marker);
    // Resize with a pending edit: the BlockNote instance must survive every layout.
    for (const [width, height] of [[840, 920], [393, 873], [920, 600], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expect(editor).toContainText(marker);
      await expect(page.getByLabel("Название страницы", { exact: true })).toHaveValue("Домашний сервер");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.getByRole("button", { name: "Режим фокуса", exact: true }).click();
    await expect(page.locator('[data-mobile-screen="pages"]')).toBeHidden();
    await page.getByRole("button", { name: "Выйти из режима фокуса", exact: true }).click();
    await page.setViewportSize({ width: 393, height: 873 });
    await editor.click();
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      if (!viewport) throw new Error("Chrome visualViewport unavailable");
      Object.defineProperty(viewport, "height", { configurable: true, value: 340 });
      viewport.dispatchEvent(new Event("resize"));
    });
    await expect.poll(() => page.locator(".notebook-app-shell").evaluate((node) => node.getBoundingClientRect().height)).toBe(340);
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, "height");
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await page.getByRole("button", { name: "Режим фокуса", exact: true }).click();
    expect(await page.evaluate(() => (window as Window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.())).toBe("HANDLED");
    await expect(page.locator(".notebook-app-shell")).toHaveAttribute("data-focus-mode", "false");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-page-title="Настройка сети"] button[title]').click();
    await expect(page.locator(".notebook-page-title-input")).toHaveValue("Настройка сети");
    await expect.poll(async () => {
      const data = z.object({ page: z.object({ content: z.array(z.unknown()) }) }).parse(await page.request.get(`/api/pages/${first.id}`).then((r) => r.json()));
      return JSON.stringify(data.page.content);
    }).toContain(marker);
    await page.getByTestId("desktop-app-header").getByRole("button", { name: "Настройки", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Настройки", exact: true });
    await settings.getByRole("button", { name: "Оформление", exact: true }).click();
    const next = theme === "studio-graphite" ? "Studio Atelier" : "Studio Graphite";
    await settings.getByRole("button", { name: next, exact: true }).click();
    await settings.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveClass(theme === "studio-graphite" ? "studio-atelier" : "studio-graphite");
    await expect(page.locator(".notebook-page-title-input")).toHaveValue("Настройка сети");
    expect(second.id).not.toBe(first.id);
  });
}
