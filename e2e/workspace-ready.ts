import { expect, test, type Page } from "@playwright/test";

/** Navigation's load event does not mean the client session or lazy BlockNote is ready. */
export async function expectRestoredDocument(page: Page, note: { id: string; title: string }) {
  const tabId = `document-tab-${note.id}`;
  const panel = page.locator("#notebook-document-panel-left");
  await test.step("Сессия выбрала документ и загрузила его панель", async () => {
    await expect(page.locator('.workspace-editor-slot[data-pane="left"]').getByRole("tab", { name: note.title, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute("aria-labelledby", tabId);
  });
  await test.step("Динамический редактор готов к вводу", async () => {
    const document = panel.locator(`[data-page-id="${note.id}"]`);
    await expect(document.locator(".bn-editor")).toHaveAttribute("contenteditable", "true");
    await expect(document.getByLabel("Название страницы", { exact: true })).toHaveValue(note.title);
    await expect(document.getByLabel("Название страницы", { exact: true })).toBeEditable();
  });
}
