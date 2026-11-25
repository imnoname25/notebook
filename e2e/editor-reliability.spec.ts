import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { setTestTheme } from "./theme-fixture";

const idSchema = z.object({ id: z.string() });
const blockSchema = z.object({ id: z.string(), type: z.string(), content: z.unknown(), children: z.array(z.unknown()).optional() });
const pageSchema = z.object({ page: idSchema.extend({ revision: z.number(), content: z.array(blockSchema) }) });
const text = (value: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: value, styles });
const paragraph = (id: string, content: unknown[] = [], children: unknown[] = []) => ({ id, type: "paragraph", content, children });
const link = (href: string, ...content: ReturnType<typeof text>[]) => ({ type: "link", href, content });
const pasteShortcut = process.platform === "darwin" ? "Meta" : "Control";

async function openNote(page: Page, content: unknown[], theme?: "studio-graphite" | "studio-atelier") {
  page.setDefaultTimeout(12_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await page.request.post("/api/auth/login", {
    data: { email: "admin@example.test", password: "correct horse battery staple" },
  })).ok()).toBe(true);
  const { notebook } = z.object({ notebook: idSchema }).parse(await page.request.post("/api/notebooks", { data: { title: "Editor reliability" } }).then(r => r.json()));
  const { section } = z.object({ section: idSchema }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Synthetic documents" } }).then(r => r.json()));
  const { page: note } = z.object({ page: idSchema.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Synthetic clipboard data" } }).then(r => r.json()));
  expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content } })).ok()).toBe(true);
  if (theme) await setTestTheme(page, theme);
  await page.goto(`/pages/${note.id}`);
  await expect(page.locator(".bn-editor[contenteditable=true]")).toBeVisible();
  return async () => pageSchema.parse(await page.request.get(`/api/pages/${note.id}`).then(r => r.json())).page;
}

const block = (page: Page, id: string) => page.locator(`.bn-editor [data-id="${id}"]`).first();
const inline = (page: Page, id: string) => block(page, id).locator(".bn-inline-content").first();

async function caretPoint(locator: Locator, at: "start" | "end", inset = 0) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((root, { at, inset }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const node = at === "start" ? nodes[0] : nodes.at(-1);
    if (!node) throw new Error("Missing clipboard fixture text");
    const range = document.createRange();
    range.setStart(node, at === "start" ? inset : node.length - inset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  }, { at, inset });
}

async function dragText(page: Page, first: Locator, last = first, reverse = false, inset = 0) {
  // Start a new selection instead of dragging the already selected text.
  if (await page.evaluate(() => getSelection()?.isCollapsed === false)) await page.keyboard.press("ArrowLeft");
  const start = await caretPoint(first, "start", inset);
  const end = await caretPoint(last, "end", inset);
  const [from, to] = reverse ? [end, start] : [start, end];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function selectLine(page: Page, locator: Locator) {
  await locator.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
}

async function clipboard(page: Page) {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (!item) throw new Error("The system clipboard is empty");
    const get = async (type: string) => item.types.includes(type) ? (await item.getType(type)).text() : "";
    return { text: await get("text/plain"), html: await get("text/html") };
  });
}

async function paste(page: Page, plain: string, html?: string, plainOnly = false) {
  await page.evaluate(async ({ plain, html }) => {
    const payload: Record<string, Blob> = { "text/plain": new Blob([plain], { type: "text/plain" }) };
    if (html) payload["text/html"] = new Blob([html], { type: "text/html" });
    await navigator.clipboard.write([new ClipboardItem(payload)]);
  }, { plain, html });
  await page.keyboard.press(`${pasteShortcut}+${plainOnly ? "Shift+" : ""}v`);
}

test("legacy soft breaks isolate a URL and preserve literal clipboard text in both directions", async ({ page }) => {
  const url = "https://example.test/technical";
  const address = "fixture@example.test";
  const technical = '  [fixture]_*&#()! C:\\Work\\Test /tmp/test\t \uFFFC  ';
  await openNote(page, [
    paragraph("old", [text("Before\n"), link(url, text(url)), text("\nSecond\nThird", { bold: true })]),
    paragraph("email", [link(`mailto:${address}`, text(address))]),
    paragraph("label", [link(url, text("Visible label", { italic: true }))]),
    paragraph("technical", [text(technical)]),
    paragraph("blank"),
    paragraph("end", [text("Last")]),
  ]);
  const urlLink = block(page, "old").locator("a");
  for (const reverse of [false, true]) {
    await dragText(page, urlLink, urlLink, reverse);
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(url);
    await page.keyboard.press(`${pasteShortcut}+c`);
    const actual = await clipboard(page);
    expect(actual.text).toBe(url);
    expect(actual.html).toContain(`href="${url}"`);
    expect(actual.html).not.toMatch(/Before|Second|Third/);
  }
  await dragText(page, urlLink, urlLink, true, 1);
  await page.keyboard.press(`${pasteShortcut}+c`);
  expect((await clipboard(page)).text).toBe(url.slice(1, -1));
  await selectLine(page, inline(page, "email"));
  await page.keyboard.press(`${pasteShortcut}+c`);
  expect((await clipboard(page)).text).toBe(address);
  await selectLine(page, inline(page, "label"));
  await page.keyboard.press(`${pasteShortcut}+c`);
  expect((await clipboard(page)).text).toBe("Visible label");
  await inline(page, "technical").click();
  await page.keyboard.press("Home");
  await page.keyboard.press(`${pasteShortcut}+Shift+End`);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toContain("Last");
  await page.keyboard.press(`${pasteShortcut}+c`);
  const multiline = await clipboard(page);
  expect(multiline.text).toBe(`${technical}\n\nLast`);
  expect(multiline.html.match(/\uFFFC/g)).toHaveLength(1);
  await page.keyboard.press("ArrowRight");
  await block(page, "label").locator("a").hover();
  await page.getByRole("button", { name: "Копировать адрес ссылки", exact: true }).click();
  await expect.poll(async () => (await clipboard(page)).text).toBe(url);
});

test("cut and rich re-paste use the same selected content, and a cell rectangle copies TSV", async ({ page }) => {
  await openNote(page, [
    paragraph("cut", [text("Before "), link("https://example.test/", text("selected", { bold: true })), text(" after")]),
    { id: "table", type: "table", content: { type: "tableContent", rows: [
      { cells: [[text("A1")], [text("B1")]] }, { cells: [[text("A2")], [text("B2")]] },
    ] } },
  ]);
  const target = block(page, "cut").locator("a");
  await dragText(page, target);
  await page.keyboard.press(`${pasteShortcut}+x`);
  expect((await clipboard(page)).text).toBe("selected");
  await expect.poll(() => inline(page, "cut").textContent()).toBe("Before  after");
  await page.keyboard.press(`${pasteShortcut}+v`);
  await expect(target).toHaveText("selected");
  await expect(block(page, "cut").locator("strong")).toHaveText("selected");
  const cells = block(page, "table").locator("td");
  await selectLine(page, cells.first().locator("p"));
  await page.keyboard.press(`${pasteShortcut}+c`);
  expect((await clipboard(page)).text).toBe("A1");
  await cells.first().click();
  await cells.last().click({ modifiers: ["Shift"] });
  await expect(block(page, "table").locator(".selectedCell")).toHaveCount(4);
  await page.keyboard.press(`${pasteShortcut}+c`);
  const table = await clipboard(page);
  expect(table.text).toBe("A1\tB1\nA2\tB2");
  expect(table.html).toContain("<table");
  expect(table.html).toContain("B2");
});

test("literal and rich paste keep technical data and URL replacement semantics", async ({ page }) => {
  test.setTimeout(60_000);
  const saved = await openNote(page, [
    paragraph("rich", [text("Old")]),
    paragraph("url", [text("Old")]),
    paragraph("email", [text("Old")]),
    paragraph("typed"),
    paragraph("card"),
    paragraph("plain"),
    paragraph("link-choice"),
    paragraph("card-choice"),
    paragraph("spreadsheet"),
  ]);
  await selectLine(page, inline(page, "rich"));
  await paste(page, "# Header\n\n**Markdown**", '<p class="MsoNormal"><strong>A\uFFFCB</strong></p>');
  await expect(block(page, "rich").locator("strong")).toHaveText("A\uFFFCB");
  await selectLine(page, inline(page, "url"));
  await paste(page, "https://example.test/target");
  await expect(inline(page, "url")).toHaveText("https://example.test/target");
  await expect(block(page, "url").locator("a")).toHaveCount(0);
  await selectLine(page, inline(page, "email"));
  await paste(page, "fixture@example.test");
  await expect(inline(page, "email")).toHaveText("fixture@example.test");
  await inline(page, "typed").click();
  await page.keyboard.type("settings.zip fixture@example.test https://example.test/typed ");
  await expect(block(page, "typed").locator("a")).toHaveText(["fixture@example.test", "https://example.test/typed"]);
  await inline(page, "card").click();
  await paste(page, "http://example.test");
  const dialog = page.getByRole("dialog").filter({ hasText: "http://example.test" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button")).toHaveCount(3);
  await dialog.getByRole("button", { name: /текст/i }).click();
  await expect(inline(page, "card")).toHaveText("http://example.test");
  await inline(page, "plain").click();
  await paste(page, "# Header\n\n  **Word**\t  \n", "<p><em>Discarded formatting</em></p>", true);
  await expect.poll(async () => JSON.stringify((await saved()).content)).toContain("  **Word**\\t  ");
  await expect(page.locator(".bn-editor h1")).toHaveCount(0);
  await expect(page.locator(".bn-editor")).not.toContainText("Discarded formatting");
  await inline(page, "link-choice").click();
  await paste(page, "http://example.test");
  await dialog.getByRole("button", { name: /ссылк/i }).click();
  await expect(block(page, "link-choice").locator("a")).toHaveText("http://example.test");
  await inline(page, "card-choice").click();
  await paste(page, "https://example.test/card");
  await page.getByRole("dialog").filter({ hasText: "https://example.test/card" }).getByRole("button", { name: /карточк/i }).click();
  await expect(block(page, "card-choice").locator("[data-content-type=bookmark]")).toContainText("example.test");
  await inline(page, "spreadsheet").click();
  await paste(page, "Column A\tColumn B\n1\t2", '<table><tr><th>Column A</th><th>Column B</th></tr><tr><td>1</td><td><strong>2</strong></td></tr></table>');
  await expect(page.locator(".bn-editor table tr")).toHaveCount(2);
  await expect(page.locator(".bn-editor table td strong")).toHaveText("2");
});

for (const panel of ["floating", "persistent"] as const) {
  test(`${panel} heading splits one legacy line and autosaves a deep-link-safe Undo/Redo`, async ({ page }) => {
    test.setTimeout(60_000);
    const saved = await openNote(page, [
      paragraph("legacy", [text("Before\n"), link("https://example.test/line", text("Middle", { bold: true })), text("\nAfter", { italic: true })], [
        paragraph("child", [text("Nested child")]),
      ]),
      paragraph("neighbor", [text("Neighbor")]),
    ], panel === "floating" ? "studio-graphite" : "studio-atelier");
    const middle = block(page, "legacy").locator("a");
    await dragText(page, middle, middle, panel === "floating");
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Middle");
    if (panel === "floating") {
      const toolbar = page.locator(".bn-formatting-toolbar").filter({ visible: true });
      await toolbar.getByRole("combobox").filter({ hasText: "Параграф" }).click();
      await page.getByRole("option", { name: "Заголовок 2 уровня", exact: true }).click();
    } else {
      await page.getByRole("toolbar", { name: "Форматирование документа" }).getByLabel("Формат блока").selectOption("h2");
    }
    await expect(page.locator(".bn-editor h2")).toHaveText("Middle");
    await expect(page.locator(".bn-editor h2 strong")).toHaveText("Middle");
    await expect(inline(page, "legacy")).toHaveText("Before");
    await expect(inline(page, "neighbor")).toHaveText("Neighbor");
    await expect(inline(page, "child")).toHaveText("Nested child");
    const splitIds = async () => (await saved()).content.map(item => item.id);
    await expect.poll(splitIds).toHaveLength(4);
    const ids = await splitIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("legacy");
    await page.keyboard.press(`${pasteShortcut}+z`);
    await expect(page.locator(".bn-editor h2")).toHaveCount(0);
    await expect.poll(splitIds).toEqual(["legacy", "neighbor"]);
    await page.keyboard.press(`${pasteShortcut}+Shift+z`);
    await expect.poll(splitIds).toEqual(ids);
    await page.reload();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.locator(".bn-editor h2")).toHaveText("Middle");
    await expect(inline(page, "legacy")).toHaveText("Before");
    await expect(inline(page, "child")).toHaveText("Nested child");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test(`${panel} link command retains an exact mixed-mark selection while its form has focus`, async ({ page }) => {
    const saved = await openNote(page, [paragraph("mixed", [
      text("Before "), text("AB", { bold: true }), text("cd", { italic: true }), text(" after"),
    ])], panel === "floating" ? "studio-atelier" : "studio-graphite");
    await page.setViewportSize({ width: 1920, height: 1080 });
    const mixed = block(page, "mixed");
    await dragText(page, mixed.locator("strong"), mixed.locator("em"), false, 1);
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Bc");
    if (panel === "floating") {
      await page.locator(".bn-formatting-toolbar").getByRole("button", { name: "Создать ссылку", exact: true }).click();
    } else {
      const toolbar = page.getByRole("toolbar", { name: "Форматирование документа" });
      await toolbar.getByRole("button", { name: "Вставить ссылку", exact: true }).click();
    }
    await page.getByRole("textbox", { name: "Адрес", exact: true }).fill("https://example.test/formatting");
    await page.getByRole("button", { name: "Применить ссылку", exact: true }).click();
    await expect(mixed).toHaveText("Before ABcd after");
    await expect.poll(async () => (await saved()).content[0]?.content).toEqual([
      text("Before "), text("A", { bold: true }),
      link("https://example.test/formatting", text("B", { bold: true }), text("c", { italic: true })),
      text("d", { italic: true }), text(" after"),
    ]);

    await page.reload();
    await mixed.locator("a").first().hover();
    await page.getByRole("button", { name: "Удалить ссылку", exact: true }).click();
    await expect(mixed.locator("a")).toHaveCount(0);
    await expect.poll(async () => (await saved()).content[0]?.content).toEqual([
      text("Before "), text("AB", { bold: true }), text("cd", { italic: true }), text(" after"),
    ]);
  });
}
