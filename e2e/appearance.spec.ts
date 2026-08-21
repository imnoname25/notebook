import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("appearance stays readable, bounded and participates in mobile Back", async ({
  page,
}) => {
  await login(page);
  const suffix = Date.now();
  const notebook = await page.request
    .post("/api/notebooks", { data: { title: `Appearance ${suffix}` } })
    .then((response) => response.json());
  const section = await page.request
    .post("/api/sections", {
      data: {
        notebookId: notebook.notebook.id,
        parentId: null,
        title: `Цветной раздел ${suffix}`,
      },
    })
    .then((response) => response.json());
  await page.request.patch(`/api/sections/${section.section.id}`, {
    data: { color: "cyan" },
  });
  const title = `Очень длинное название страницы для проверки preview ${suffix}`;
  const created = await page.request
    .post("/api/pages", { data: { sectionId: section.section.id, title } })
    .then((response) => response.json());
  await page.request.patch(`/api/pages/${created.page.id}`, {
    data: {
      expectedRevision: 0,
      content: [
        {
          type: "paragraph",
          content:
            "Текст превью страницы с достаточно длинным содержимым для двух строк.",
        },
      ],
      color: "violet",
      backgroundType: "pattern",
      backgroundColor: "cyan",
      backgroundPattern: "grid",
      appearancePreset: "focus",
    },
  });
  await page.request.patch("/api/account/preferences", {
    data: {
      pageListView: "preview",
      sectionAccentIntensity: "expressive",
    },
  });
  await page.goto(`/pages/${created.page.id}`);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1366, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await expect(page.locator(".notebook-page-surface")).toHaveAttribute(
        "data-background-pattern",
        "grid",
      );
      const widths = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    });
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  const pageRow = page.locator(`[data-page-title="${title}"]`);
  await expect(pageRow).toHaveAttribute("data-list-view", "preview");
  await expect(pageRow).toContainText("Текст превью страницы");
  const sectionRow = page.locator(
    `[data-nav-row="section"][data-section-color="cyan"]`,
  );
  await expect(sectionRow).toHaveAttribute("aria-current", "page");
  expect(
    await sectionRow.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: `Действия страницы ${title}` })
    .click();
  await page.getByRole("button", { name: "Оформление", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: new RegExp("Оформление страницы") }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as Window & {
          __NOTEBOOK_ANDROID_BACK__?: () => string;
        }
      ).__NOTEBOOK_ANDROID_BACK__?.(),
    ),
  ).toBe("HANDLED");
  await expect(
    page.getByRole("dialog", { name: new RegExp("Оформление страницы") }),
  ).toBeHidden();
  await expect(page.locator('[data-mobile-screen="editor"]')).toBeVisible();
});
