import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "split-screen", width: 1024, height: 900 },
  { name: "1366 desktop", width: 1366, height: 900 },
  { name: "1920 desktop", width: 1920, height: 1080 },
  { name: "2560 desktop", width: 2560, height: 1440 },
] as const;

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("editor canvas stays left-aligned and lets wide blocks use the pane", async ({ page }) => {
  await login(page);
  await page.request.patch("/api/settings", { data: { editorContentWidth: "normal" } });
  const longNotebookTitle = "Рабочий блокнот с очень длинным названием для проверки навигации";
  const notebook = await page.request.post("/api/notebooks", { data: { title: longNotebookTitle } }).then((response) => response.json());
  const section = await page.request.post("/api/sections", { data: { notebookId: notebook.notebook.id, parentId: null, title: "Canvas" } }).then((response) => response.json());
  const created = await page.request.post("/api/pages", { data: { sectionId: section.section.id, title: "OneNote layout" } }).then((response) => response.json());
  await page.request.patch(`/api/pages/${created.page.id}`, { data: {
    expectedRevision: 0,
    title: "OneNote layout",
    content: [
      { type: "paragraph", content: "Обычный текст остаётся читаемым и начинается слева" },
      { type: "codeBlock", props: { language: "typescript" }, content: "const canvas = 'uses the available editor width';" },
    ],
  } });
  await page.goto(`/pages/${created.page.id}`);

  for (const viewport of viewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const metrics = await page.getByTestId("notebook-editor-canvas").evaluate((canvas) => {
        const editor = canvas.querySelector<HTMLElement>(".bn-editor");
        const paragraph = canvas.querySelector<HTMLElement>('[data-content-type="paragraph"]');
        const code = canvas.querySelector<HTMLElement>('[data-content-type="codeBlock"]');
        const header = canvas.parentElement?.querySelector<HTMLElement>('[data-testid="page-editor-header"]');
        const title = header?.querySelector<HTMLElement>("input");
        if (!editor || !paragraph || !code || !header || !title) throw new Error("BlockNote layout nodes are missing");
        const canvasRect = canvas.getBoundingClientRect();
        const paragraphRect = paragraph.getBoundingClientRect();
        const codeRect = code.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const editorStyle = getComputedStyle(editor);
        return {
          canvasWidth: canvasRect.width,
          paragraphWidth: paragraphRect.width,
          codeWidth: codeRect.width,
          paragraphLeftGap: paragraphRect.left - canvasRect.left,
          titleLeftGap: titleRect.left - canvasRect.left,
          paragraphRightGap: canvasRect.right - paragraphRect.right,
          codeRightGap: canvasRect.right - codeRect.right,
          editorMarginLeft: editorStyle.marginLeft,
          editorMarginRight: editorStyle.marginRight,
          editorMaxWidth: editorStyle.maxWidth,
        };
      });

      expect(metrics.editorMarginLeft).not.toBe("auto");
      expect(metrics.editorMarginRight).not.toBe("auto");
      expect(metrics.editorMaxWidth).toBe("none");
      expect(metrics.paragraphLeftGap).toBeGreaterThanOrEqual(28);
      expect(metrics.paragraphLeftGap).toBeLessThanOrEqual(52);
      expect(Math.abs(metrics.titleLeftGap - metrics.paragraphLeftGap)).toBeLessThanOrEqual(1);
      expect(metrics.codeRightGap).toBeLessThanOrEqual(52);
      expect(metrics.codeWidth).toBeGreaterThanOrEqual(metrics.paragraphWidth - 1);
      if (viewport.width >= 1920) {
        expect(metrics.paragraphRightGap).toBeGreaterThan(metrics.paragraphLeftGap + 200);
        expect(metrics.codeWidth).toBeGreaterThan(metrics.paragraphWidth + 200);
      }
      expect(metrics.canvasWidth).toBeGreaterThan(0);
      const notebookRow = page.locator(`[data-notebook-title="${longNotebookTitle}"]`);
      await expect(notebookRow).toBeVisible();
      await expect(notebookRow.locator("button").nth(1)).toHaveAttribute("title", longNotebookTitle);
      const label = notebookRow.locator("button").nth(1).locator("span").last();
      expect(await label.evaluate((node) => node.scrollWidth >= node.clientWidth)).toBe(true);
    });
  }

  const normalWidth = await page.locator('[data-content-type="paragraph"]').evaluate((node) => node.getBoundingClientRect().width);
  await page.request.patch("/api/settings", { data: { editorContentWidth: "wide" } });
  await page.reload();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(page.getByTestId("notebook-editor-canvas")).toHaveAttribute("data-content-width", "wide");
  const wideWidth = await page.locator('[data-content-type="paragraph"]').evaluate((node) => node.getBoundingClientRect().width);
  expect(wideWidth).toBeGreaterThan(normalWidth + 250);
  await page.request.patch("/api/settings", { data: { editorContentWidth: "normal" } });
});
