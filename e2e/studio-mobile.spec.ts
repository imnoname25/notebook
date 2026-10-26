import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

async function createFixture(page: Page) {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Mobile UI test" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Mobile synthetic notebook" } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Synthetic section" } }).then(r => r.json()));
  const { page: note } = z.object({ page: id }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Mobile synthetic document" } }).then(r => r.json()));
  const content = [
    { type: "paragraph", content: "Synthetic technical document; no personal data." },
    { type: "table", content: { type: "tableContent", columnWidths: [220, 220, 220], rows: [
      { cells: ["Вымышленный участник с длинным именем", "REFERENCE-0123456789-ABCDEFGHIJKLMN", "https://example.test/documentation"] },
      { cells: ["Тестовая запись", "sample-service.internal:8443", "Справочник"] },
    ] } },
    { type: "quote", content: "Synthetic quotation" },
    { type: "codeBlock", props: { language: "text" }, content: "technical_reference_".repeat(30) },
    ...Array.from({ length: 24 }, (_, i) => ({ type: "numberedListItem", content: `Техническая запись ${i + 1}`, children: [{ type: "bulletListItem", content: "Вложенная запись" }] })),
  ];
  expect((await page.request.patch(`/api/pages/${note.id}`, { data: { content, icon: "📘" } })).ok()).toBe(true);
  return note.id;
}

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: compact drawer, readable tables, stable editor and focus`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const id = await createFixture(page);
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width: 393, height: 873 });
    await page.goto(`/pages/${id}`);
    const editor = page.locator('.bn-editor[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.evaluate(node => { node.dataset.mobileIdentity = "retained"; });
    const title = page.getByLabel("Название страницы", { exact: true });

    for (const [width, height] of [[360, 800], [393, 873], [600, 800], [840, 960], [1024, 768], [1440, 900], [1920, 1080], [2560, 1440], [393, 873]]) {
      await page.setViewportSize({ width, height });
      await expect(editor).toHaveAttribute("data-mobile-identity", "retained");
      await expect(title).toHaveValue("Mobile synthetic document");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width < 1200) {
        const header = await page.getByTestId("mobile-app-header").boundingBox();
        expect(header!.height).toBeGreaterThanOrEqual(48);
        expect(header!.height).toBeLessThanOrEqual(56);
        await expect(page.locator(".notebook-sidebar")).toHaveCount(0);
      }
      if (width < 768) await expect(page.locator('[data-mobile-screen="pages"]')).toBeHidden();
    }
    expect((await page.getByTestId("page-editor-header").boundingBox())!.height).toBeLessThanOrEqual(80);
    const table = page.locator(".tableWrapper");
    expect(await table.evaluate(node => { node.scrollLeft = 200; return node.scrollLeft; })).toBeGreaterThan(0);
    expect(await table.locator("td").first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(192);
    await table.evaluate(node => { node.scrollLeft = 0; });
    await table.locator("td").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" cell update");
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${id}`).then(r => r.json()))).toContain("cell update");

    await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Навигация", exact: true });
    await expect(drawer).toBeVisible();
    const rowHeights = await drawer.locator("[data-nav-row]:visible").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(rowHeights.length).toBeGreaterThan(0);
    expect(rowHeights.every(height => height >= 44 && height <= 48)).toBe(true);
    await expect(editor).toHaveAttribute("data-mobile-identity", "retained");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click();
    await drawer.getByRole("button", { name: "Настройки приложения", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Настройки", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click();
    await drawer.getByRole("button", { name: "Корзина", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Корзина", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 840, height: 960 });
    await page.getByRole("button", { name: "Режим фокуса", exact: true }).click();
    await expect(page.locator('[data-mobile-screen="pages"]')).toBeHidden();
    expect(Math.round((await page.locator(".notebook-editor-pane").boundingBox())!.width)).toBe(840);
    await page.getByRole("button", { name: "Выйти из режима фокуса", exact: true }).click();
    await expect(page.locator('[data-mobile-screen="pages"]')).toBeVisible();
    for (const [width, height, label] of [[393, 873, "outer"], [840, 960, "inner"]] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: info.outputPath(`${theme}-${label}.png`) });
    }
  });
}
