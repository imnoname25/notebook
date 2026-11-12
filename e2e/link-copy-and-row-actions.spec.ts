import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { setTestTheme } from "./theme-fixture";

const entity = z.object({ id: z.string(), title: z.string() });
const address = "https://example.test/path?value=1#anchor";

async function fixture(page: Page) {
  const suffix = Date.now();
  expect((await page.request.post("/api/auth/login", {
    data: { email: "admin@example.test", password: "correct horse battery staple" },
  })).ok()).toBe(true);
  const notebook = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", {
    data: { title: `UX notebook ${suffix}` },
  }).then(response => response.json())).notebook;
  const section = z.object({ section: entity }).parse(await page.request.post("/api/sections", {
    data: { notebookId: notebook.id, title: `UX section ${suffix}` },
  }).then(response => response.json())).section;
  const note = z.object({ page: entity.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", {
    data: { sectionId: section.id, title: `UX page ${suffix}` },
  }).then(response => response.json())).page;
  await setTestTheme(page, "studio-graphite");
  return { notebook, section, note };
}

async function selectText(locator: Locator) {
  await locator.evaluate(element => {
    element.closest<HTMLElement>(".bn-editor")?.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

test("Ctrl+C copies the link URL and Ctrl+V preserves the styled link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { note } = await fixture(page);
  expect((await page.request.patch(`/api/pages/${note.id}`, {
    data: {
      expectedRevision: note.revision,
      content: [
        { id: "copy-link", type: "paragraph", content: [{ type: "link", href: address, content: [{ type: "text", text: "Named link", styles: { bold: true } }] }] },
        { id: "copy-plain", type: "paragraph", content: "Ordinary text" },
      ],
    },
  })).ok()).toBe(true);
  await page.goto(`/pages/${note.id}`);
  const link = page.locator(`.bn-editor a[href="${address}"]`);
  await expect(link).toHaveText("Named link");
  await selectText(link);
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(address);

  const copied = await link.evaluate(element => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return { plain: data.getData("text/plain"), html: data.getData("text/html"), internal: data.getData("blocknote/html") };
  });
  expect(copied.plain).toBe(address);
  expect(copied.html).toContain("Named link");
  expect(copied.html).toContain(address);
  expect(copied.internal).toContain(address);

  const input = page.getByRole("textbox", { name: "Название страницы", exact: true });
  await input.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(input).toHaveValue(address);

  const plain = page.locator('[data-id="copy-plain"] .bn-inline-content');
  await plain.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(link).toHaveCount(2);
  await expect(link.last()).toHaveText("Named link");
  await expect(page.locator(`.bn-editor strong a[href="${address}"]`)).toHaveCount(2);
  await selectText(plain);
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).trimEnd())).toBe("Ordinary text");
});

test("desktop rows retain buttons, right click, keyboard actions, and focus return", async ({ page }) => {
  const { section, note } = await fixture(page);
  await page.goto(`/pages/${note.id}`);
  const sectionRow = page.locator('[data-nav-row="section"]').getByTitle(section.title, { exact: true });
  const pageRow = page.locator(`[data-page-select][title="${note.title}"]`);
  await expect(page.getByRole("button", { name: `Действия страницы ${note.title}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Действия раздела ${section.title}` })).toBeVisible();
  await sectionRow.click({ button: "right" });
  await expect(page.getByRole("dialog", { name: section.title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sectionRow).toBeFocused();
  await pageRow.press("Shift+F10");
  await expect(page.getByRole("dialog", { name: note.title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pageRow).toBeFocused();
});

test.describe("touch row actions", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const width of [360, 768]) {
    test(`Android shell at ${width}px supports hold, tap and a gesture-free action path`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(() => Object.defineProperty(window, "Capacitor", { value: { isNativePlatform: () => true } }));
      const { section, note } = await fixture(page);
      const another = z.object({ page: entity }).parse(await page.request.post("/api/pages", {
        data: { sectionId: section.id, title: "Another page" },
      }).then(response => response.json())).page;
      await page.goto(`/pages/${note.id}`);
      await expect(page.getByRole("textbox", { name: "Название страницы", exact: true })).toHaveValue(note.title);
      await page.getByRole("button", { name: "Открыть навигацию", exact: true }).tap();
      const navigation = page.getByRole("dialog", { name: "Навигация", exact: true });
      const sectionRow = navigation.getByTitle(section.title, { exact: true });
      await expect(sectionRow).toBeVisible();
      await expect(navigation.getByRole("button", { name: `Действия раздела ${section.title}` })).toHaveCount(0);

      const cdp = await context.newCDPSession(page);
      async function touch(type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) {
        await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      }
      async function hold(row: Locator, name: string) {
        await row.scrollIntoViewIfNeeded();
        const box = (await row.boundingBox())!;
        await touch("touchStart", box.x + box.width / 2, box.y + box.height / 2);
        const dialog = page.getByRole("dialog", { name, exact: true });
        try { await expect(dialog).toBeVisible(); }
        finally { await touch("touchEnd"); }
        await expect(dialog).toBeVisible();
        return dialog;
      }
      const sectionActions = await hold(sectionRow, section.title);
      await expect(sectionActions.getByRole("button", { name: "Добавить вложенный раздел" })).toBeVisible();
      await sectionActions.getByRole("button", { name: "Отмена", exact: true }).tap();
      await navigation.getByRole("button", { name: "Действия разделов", exact: true }).tap();
      await sectionRow.tap();
      await sectionActions.getByRole("button", { name: "Отмена", exact: true }).tap();
      await sectionRow.tap();

      const list = page.locator(".notebook-document-list");
      const row = list.locator("[data-page-select]").filter({ hasText: note.title });
      await expect(row).toBeVisible();
      await expect(page.getByRole("button", { name: `Избранное: ${note.title}` })).toHaveCount(0);
      await list.evaluate(element => { element.style.maxHeight = "76px"; });
      const scrollBox = (await row.boundingBox())!;
      await touch("touchStart", scrollBox.x + 32, scrollBox.y + scrollBox.height - 5);
      await touch("touchMove", scrollBox.x + 32, scrollBox.y + 5);
      await page.waitForTimeout(600);
      await touch("touchEnd");
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(page.getByRole("dialog", { name: note.title })).toHaveCount(0);
      await list.evaluate(element => { element.style.removeProperty("max-height"); element.scrollTop = 0; });

      const box = (await row.boundingBox())!;
      const handle = list.locator(`[data-page-title="${another.title}"] [data-row-drag-handle]`);
      const grip = (await handle.boundingBox())!;
      await touch("touchStart", grip.x + grip.width / 2, grip.y + grip.height / 2);
      await expect(list.locator(`[data-page-title="${another.title}"] [data-page-select]`)).toHaveAttribute("aria-pressed", "true");
      await touch("touchMove", grip.x + grip.width / 2, box.y + box.height / 2);
      await touch("touchEnd");
      await expect(list.locator("[data-page-select]").first()).toContainText(another.title);
      await expect(page.getByRole("dialog", { name: another.title })).toHaveCount(0);

      const actions = await hold(row, note.title);
      await expect(actions.getByRole("button", { name: "Переместить", exact: true })).toBeVisible();
      await actions.getByRole("button", { name: "Добавить в избранное", exact: true }).tap();
      await expect(list.locator(`[data-page-title="${note.title}"] .notebook-favorite-indicator`)).toBeVisible();
      await page.getByRole("button", { name: "Действия страниц", exact: true }).tap();
      await row.tap();
      await page.getByRole("dialog", { name: note.title }).getByRole("button", { name: "Отмена", exact: true }).tap();
      await row.tap();
      await expect(page.getByRole("textbox", { name: "Название страницы", exact: true })).toHaveValue(note.title);
    });
  }

  test("ordinary mobile browser keeps the inline actions even with the Android query flag", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const { section, note } = await fixture(page);
    await page.goto(`/pages/${note.id}?client=android`);
    await expect(page.getByRole("textbox", { name: "Название страницы", exact: true })).toHaveValue(note.title);
    await page.getByRole("button", { name: "Открыть навигацию", exact: true }).tap();
    const navigation = page.getByRole("dialog", { name: "Навигация", exact: true });
    await expect(navigation.getByRole("button", { name: `Действия раздела ${section.title}` })).toBeVisible();
    await navigation.getByTitle(section.title, { exact: true }).tap();
    await expect(page.getByRole("button", { name: `Действия страницы ${note.title}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Действия страниц", exact: true })).toHaveCount(0);
  });
});
