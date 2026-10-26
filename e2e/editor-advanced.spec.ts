import { expect, test } from "@playwright/test";
import { z } from "zod";

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: native toggle keyboard, nested outline, export and unknown block protection`, async ({ page }) => {
    const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
    const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
    expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Editor test" } : credentials })).ok()).toBe(true);
    const id = z.object({ id: z.string() });
    const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Editor synthetic notebook" } }).then(r => r.json()));
    const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Editor synthetic section" } }).then(r => r.json()));
    const { page: note } = z.object({ page: id }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Editor synthetic document" } }).then(r => r.json()));
    const content = [
      { type: "tableOfContents", props: { title: "Оглавление", depth: 3 } },
      { id: "legacy", type: "toggle", props: { open: false }, content: "Legacy group", children: [
        { type: "heading", props: { level: 2, isToggleable: true }, content: "Native heading", children: [
          { type: "heading", props: { level: 3 }, content: "Nested heading" },
          { id: "retained-text", type: "paragraph", content: "Retained hidden text" },
        ] },
      ] },
      { type: "callout", props: { kind: "warning" }, content: [{ type: "text", text: "Synthetic warning", styles: { bold: true } }] },
      { type: "codeBlock", props: { language: "bash" }, content: "  echo synthetic\n\tprintf indented" },
      { type: "table", content: { type: "tableContent", columnWidths: [220, 220, 220], rows: [{ cells: ["A", "B", "C"] }, { cells: ["D", "E", "F"] }] } },
    ];
    expect((await page.request.patch(`/api/pages/${note.id}`, { data: { content } })).ok()).toBe(true);
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.goto(`/pages/${note.id}`);
    const hidden = page.locator('[data-id="retained-text"]').first();
    await expect(hidden).toBeHidden();
    await page.locator(".notebook-toc").getByRole("button", { name: "Nested heading", exact: true }).click();
    await expect(hidden).toBeVisible();
    await page.getByRole("button", { name: "Свернуть дочерние блоки", exact: true }).click();
    await expect(hidden).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(hidden).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(hidden).toBeHidden();
    await page.getByRole("button", { name: "Развернуть дочерние блоки", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(hidden).toBeVisible();
    await page.getByLabel("Тип callout", { exact: true }).selectOption("success");
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${note.id}`).then(r => r.json()))).toContain('"kind":"success"');
    // No OS clipboard access: capture this synthetic block inside the test page only.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      write: async (items: ClipboardItem[]) => { (window as Window & { testBlockHtml?: string }).testBlockHtml = await items[0]!.getType("text/html").then(blob => blob.text()); },
    } }));
    await page.locator(".notebook-callout").hover();
    await page.getByRole("button", { name: "Действия с блоком", exact: true }).click();
    await page.getByRole("menuitem", { name: "Копировать", exact: true }).click();
    const clipboard = await page.evaluate(() => (window as Window & { testBlockHtml?: string }).testBlockHtml);
    expect(clipboard).toContain("data-notebook-block-json");
    await page.locator('[data-id="retained-text"] .bn-inline-content').click();
    await page.keyboard.press("End");
    await page.evaluate(html => {
      const data = new DataTransfer();
      data.setData("text/html", html!);
      data.setData("text/plain", "Synthetic warning");
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, clipboard);
    await expect.poll(async () => {
      const document = await page.request.get(`/api/pages/${note.id}`).then(r => r.json());
      return (JSON.stringify(document).match(/"type":"callout"/g) ?? []).length;
    }).toBe(2);
    await page.getByLabel("Язык кода", { exact: true }).selectOption("powershell");
    await page.locator("td").first().click();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "TSV_A\tTSV_B\nTSV_C\tTSV_D");
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${note.id}`).then(r => r.json()))).toContain("TSV_D");
    const html = await page.request.get(`/api/data/export/page/${note.id}?format=html`);
    expect(html.ok()).toBe(true);
    expect(await html.text()).toContain("Retained hidden text");
    expect((await page.request.patch(`/api/pages/${note.id}`, { data: { content: [{ type: "future-block", props: { original: true } }] } })).ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("Документ содержит неподдерживаемые блоки", { exact: true })).toBeVisible();
    await expect(page.locator(".bn-editor")).toHaveCount(0);
    const json = await page.request.get(`/api/data/export/page/${note.id}?format=json`);
    expect(await json.text()).toContain("future-block");
  });
}
