import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("all themes persist and system follows the device", async ({ page }) => {
  await login(page);
  await page.evaluate(() => localStorage.setItem("theme", "system"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass("light");
  for (const theme of ["light", "dark", "atmospheric", "studio-graphite", "studio-atelier", "system"]) {
    await page.getByRole("button", { name: "Переключить тему", exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe(theme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(theme === "system" ? "light" : theme);
  }
});

test("legacy nested paragraphs keep real parentheses and list markers on desktop and mobile", async ({ page }) => {
  await login(page);
  const notebookResponse = await page.request.post("/api/notebooks", { data: { title: "Legacy regression" } });
  expect(notebookResponse.ok()).toBe(true);
  const { notebook } = await notebookResponse.json();
  const sectionResponse = await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Legacy" } });
  expect(sectionResponse.ok()).toBe(true);
  const { section } = await sectionResponse.json();
  const pageResponse = await page.request.post("/api/pages", { data: { sectionId: section.id, title: "1С БСО" } });
  expect(pageResponse.ok()).toBe(true);
  const { page: created } = await pageResponse.json();
  const content = [{ type: "paragraph", content: "Родитель", children: [
    { type: "paragraph", content: "1С БСО (оригинал)" },
    { type: "bulletListItem", content: "(Список)" },
  ] }];
  const saved = await page.request.patch(`/api/pages/${created.id}`, { data: { expectedRevision: created.revision, content } });
  expect(saved.ok()).toBe(true);
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/pages/${created.id}`);
    const text = page.getByTestId("notebook-editor-canvas");
    await expect(text).toContainText("1С БСО (оригинал)");
    const markers = await text.evaluate((canvas) => {
      const nested = canvas.querySelector<HTMLElement>(".bn-block-group .bn-block-group > .bn-block-outer");
      const bullet = canvas.querySelector<HTMLElement>('[data-content-type="bulletListItem"]');
      if (!nested || !bullet) throw new Error("Missing legacy nesting");
      return { guide: getComputedStyle(nested, "::before").content, bullet: getComputedStyle(bullet, "::before").content };
    });
    expect(markers.guide).toBe("none");
    expect(markers.bullet).not.toBe("none");
    expect(markers.bullet).not.toBe('""');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const original = await page.request.get(`/api/pages/${created.id}`).then((response) => response.json());
  expect(original.page.content).toEqual(content);
});
