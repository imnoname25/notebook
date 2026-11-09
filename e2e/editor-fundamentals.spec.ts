import { setTestTheme } from "./theme-fixture";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import legacyOffice from "./fixtures/legacy-office-paragraphs.json";
const entity = z.object({ id: z.string() });
const text = (value: string) => [{ type: "text", text: value, styles: {} }];
async function fixture(page: Page, theme: string, content: unknown[] = []) {
  page.setDefaultTimeout(10_000);
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Editor fundamentals" } : credentials })).ok()).toBe(true);
  const user = { email: `fundamentals-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: credentials.password };
  expect((await page.request.post("/api/admin/users", { data: { ...user, name: "Isolated editor", role: "USER", mustChangePassword: false } })).ok()).toBe(true);
  await page.request.post("/api/auth/logout");expect((await page.request.post("/api/auth/login", { data: user })).ok()).toBe(true);
  const { notebook } = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", { data: { title: "Fundamentals" } }).then(r => r.json()));
  const { section } = z.object({ section: entity }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Editing" } }).then(r => r.json()));
  const schema = z.object({ page: entity.extend({ revision: z.number(), content: z.array(z.record(z.string(), z.unknown())) }) });
  const { page: note } = schema.parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Controlled document" } }).then(r => r.json()));
  if (content.length) expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content } })).ok()).toBe(true);
  const get = async () => schema.parse(await page.request.get(`/api/pages/${note.id}`).then(r => r.json())).page;
  await setTestTheme(page, theme);await page.setViewportSize({ width: 1920, height: 1080 });await page.goto(`/pages/${note.id}`);
  await expect(page.locator(".bn-editor[contenteditable=true]")).toBeVisible();
  return { note, section, get };
}
async function paste(page: Page, plain: string, html = "") {
  await page.locator(".bn-editor").first().evaluate((root, value) => {
    const data = new DataTransfer();data.setData("text/plain", value.plain);if (value.html) data.setData("text/html", value.html);
    root.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, { plain, html });
}
async function record(info: TestInfo, name: string, data: unknown) { await writeFile(info.outputPath(`${name}.json`), JSON.stringify(data, null, 2)); }
async function placeMiddleCaret(page: Page) {
  const inline = page.locator('[data-id="middle"] .bn-inline-content');
  const point = await inline.evaluate(node => {
    const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    if (!text) throw new Error("Missing fixture text");
    const range = document.createRange();range.setStart(text, 6);range.collapse(true);
    const box = range.getBoundingClientRect();return { x: box.x, y: box.y + box.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => inline.evaluate(node => {
    const selection = window.getSelection();
    if (!selection?.anchorNode || !node.contains(selection.anchorNode)) return null;
    const range = document.createRange();range.setStart(node, 0);range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString();
  })).toBe("Prefix");
}
async function selectLines(page: Page, editor = page.locator(".bn-editor").first()) {
  await editor.evaluate(root => {
    const lines = root.querySelectorAll(".bn-inline-content");const range = document.createRange();range.setStart(lines[0]!, 0);range.setEnd(lines[lines.length - 1]!, lines[lines.length - 1]!.childNodes.length);
    const selection = window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event("selectionchange"));
  });
}
async function blockAction(page: Page, id: string, action: string) {
  await page.locator(`[data-id="${id}"]`).first().hover();await page.getByRole("button", { name: "Действия с блоком", exact: true }).click();await page.getByRole("menuitem", { name: action, exact: true }).click();
  await expect(page.locator(".bn-editor:focus")).toHaveCount(1);
}
for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: plain text lines and blank lines are independent blocks`, async ({ page }, info) => {
    const { get } = await fixture(page, theme);await page.locator(".bn-inline-content").first().click();
    await record(info, "before", await get());await paste(page, "Первая\r\nВторая\r\n\r\nТретья");
    await expect.poll(async () => JSON.stringify((await get()).content)).toContain("Третья");const saved = await get();await record(info, "after-plain", saved);
    expect(saved.content.map(b => b.type)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
    expect(saved.content.map(b => JSON.stringify(b.content).includes("\\n"))).not.toContain(true);
    await page.keyboard.press("Control+z");await expect(page.locator(".bn-editor")).not.toContainText("Первая");await page.keyboard.press("Control+Shift+z");await expect(page.locator(".bn-editor")).toContainText("Третья");
  });
  test(`${theme}: native selection transforms each independent block`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const { get } = await fixture(page, theme, Array.from({ length: 5 }, (_, i) => ({ id: `line-${i}`, type: "paragraph", content: text(`Строка ${i + 1}`) })));
    await page.locator(".bn-editor").evaluate(root => {
      const lines = root.querySelectorAll(".bn-inline-content");const range = document.createRange();range.setStart(lines[0]!, 0);range.setEnd(lines[4]!, lines[4]!.childNodes.length);
      const selection = window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event("selectionchange"));
    });
    await page.locator('[data-id="line-0"]').first().hover();await page.getByRole("button", { name: "Действия с блоком", exact: true }).click();await page.getByRole("menuitem", { name: "Преобразовать", exact: true }).hover();await page.getByRole("menuitem", { name: "Маркированный список", exact: true }).click();
    await expect.poll(async () => (await get()).content.some(b => b.type === "bulletListItem")).toBe(true);const changed = await get();await record(info, "after-multi-block", changed);
    expect(changed.content.map(b => b.type)).toEqual(Array(5).fill("bulletListItem"));
    for (const [label, type] of [["Нумерованный список", "numberedListItem"], ["Чеклист", "checkListItem"], ["Заголовок", "heading"], ["Цитата", "quote"], ["Сворачиваемый список", "toggleListItem"], ["Информационный блок", "callout"]]) {
      await selectLines(page);await page.locator('[data-id="line-0"]').first().hover();await page.getByRole("button", { name: "Действия с блоком", exact: true }).click();await page.getByRole("menuitem", { name: "Преобразовать", exact: true }).hover();await page.getByRole("menuitem", { name: label, exact: true }).click();
      await expect.poll(async () => (await get()).content.map(b => b.type)).toEqual(Array(5).fill(type));const saved = await get();expect(saved.content.map(b => b.id)).toEqual(Array.from({ length: 5 }, (_, i) => `line-${i}`));await record(info, `after-${type}`, saved);
    }
    await page.keyboard.press("Control+z");await expect.poll(async () => (await get()).content.map(b => b.type)).toEqual(Array(5).fill("toggleListItem"));await page.keyboard.press("Control+Shift+z");await expect.poll(async () => (await get()).content.map(b => b.type)).toEqual(Array(5).fill("callout"));
    await selectLines(page);await page.locator('[data-id="line-0"]').first().hover();await page.getByRole("button", { name: "Действия с блоком", exact: true }).click();await page.getByRole("menuitem", { name: "Преобразовать", exact: true }).hover();await page.getByRole("menuitem", { name: "Текст", exact: true }).click();await expect.poll(async () => (await get()).content.map(b => b.type)).toEqual(Array(5).fill("paragraph"));
  });
  test(`${theme}: imported transparent background is not a decorative brace`, async ({ page }, info) => {
    const content = ["Первая строка", "Вторая строка", "Третья строка"].map((value, i) => ({ id: `legacy-${i}`, type: "paragraph", props: { textColor: "windowtext", backgroundColor: "transparent", textAlignment: "left" }, content: text(value), children: [] }));
    content.push({ id: "deliberate-highlight", type: "paragraph", props: { textColor: "default", backgroundColor: "gray", textAlignment: "left" }, content: text("Явное серое выделение — контроль"), children: [] });
    const { get } = await fixture(page, theme, content);const before = await get();
    const border = await page.locator('[data-id="legacy-0"] > .bn-block').evaluate(n => ({ width: getComputedStyle(n).borderLeftWidth, radius: getComputedStyle(n).borderRadius }));
    await record(info, "legacy-dom", border);await page.screenshot({ path: info.outputPath(`${theme}-legacy.png`) });expect(border.width).toBe("0px");expect(await page.locator('[data-id="deliberate-highlight"] > .bn-block').evaluate(n => getComputedStyle(n).borderLeftWidth)).toBe("3px");expect(await get()).toEqual(before);
    const office = await fixture(page, theme, legacyOffice);const original = await office.get();await expect(page.locator('.bn-block-content[data-background-color="transparent"]')).toHaveCount(99);expect(await page.locator('.bn-block-content[data-background-color="transparent"]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node.parentElement!).borderLeftWidth === "0px"))).toBe(true);expect(await office.get()).toEqual(original);await record(info, "legacy-office", original);
  });
  test(`${theme}: single editor uses pane width for wide blocks`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const table = { id: "wide-table", type: "table", content: { type: "tableContent", columnWidths: [480, 480, 480], rows: [{ cells: [text("Name"), text("Value"), text("Description")] }] } };
    const { get, section } = await fixture(page, theme, [{ id: "readable", type: "paragraph", content: text("Обычный текст") }, table, { id: "wide-code", type: "codeBlock", props: { language: "text" }, content: text("long_technical_value_".repeat(80)) }, { id: "wide-callout", type: "callout", content: text("Information") }, { id: "wide-image", type: "image", props: { url: "/icons/icon-192.png", previewWidth: 1200 } }]);const saved = await get();
    const sizes = await page.locator(".bn-editor").evaluate(root => ({ editor: root.getBoundingClientRect().width, container: root.parentElement!.getBoundingClientRect().width }));
    await record(info, "single-layout", sizes);await page.screenshot({ path: info.outputPath(`${theme}-single.png`) });expect(sizes.editor).toBeGreaterThanOrEqual(sizes.container - 2);expect(await get()).toEqual(saved);
    for (const width of [1920, 1440, 1024, 840, 360]) {
      await page.setViewportSize({ width, height: 900 });expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const geometry = await page.locator(".bn-editor").evaluate(root => ({ root: root.clientWidth, parent: root.parentElement!.clientWidth, text: root.querySelector('[data-content-type="paragraph"]')!.getBoundingClientRect().width, tableViewport: root.querySelector(".tableWrapper")!.clientWidth, scroll: root.querySelector(".tableWrapper")!.scrollWidth }));
      expect(geometry.root).toBeGreaterThanOrEqual(geometry.parent - 2);expect(geometry.scroll).toBeGreaterThan(geometry.tableViewport);expect(geometry.text).toBeLessThanOrEqual(768);await record(info, `layout-${width}`, geometry);
    }
    const { page: other } = z.object({ page: entity.extend({ revision: z.number() }) }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: "Second pane" } }).then(r => r.json()));expect((await page.request.patch(`/api/pages/${other.id}`, { data: { expectedRevision: other.revision, content: [table] } })).ok()).toBe(true);
    await page.setViewportSize({ width: 1920, height: 1080 });await page.reload();await expect(page.locator(".bn-editor")).toBeVisible();await page.getByRole("button", { name: "Split View", exact: true }).click();await page.locator('[data-page-title="Second pane"] [data-page-select]').click();await expect(page.locator(".bn-editor:visible")).toHaveCount(2);await expect(page.locator(".workspace-editors")).toHaveAttribute("data-two", "true");
    const split = await page.locator(".workspace-editors").evaluate(root => ({ width: root.clientWidth, slots: [...root.querySelectorAll<HTMLElement>(":scope > .workspace-editor-slot")].filter(n => n.getClientRects().length).map(n => n.getBoundingClientRect().width) }));
    expect(split.slots).toHaveLength(2);expect(split.slots.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(split.width - 7);await record(info, "split-layout", split);await page.screenshot({ path: info.outputPath(`${theme}-split.png`) });expect(await get()).toEqual(saved);
    for (const width of [1440, 1024, 840, 360]) { await page.setViewportSize({ width, height: 900 });expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); }expect(await get()).toEqual(saved);
  });
  test(`${theme}: paste preserves context, literal characters, rich HTML, code and Enter semantics`, async ({ page }, info) => {
    test.setTimeout(120_000);const { section } = await fixture(page, theme);
    const schema = z.object({ page: entity.extend({ revision: z.number(), content: z.array(z.record(z.string(), z.unknown())) }) });
    const open = async (content: unknown[] = []) => {
      const { page: n } = schema.parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: `Variant ${Date.now()}` } }).then(r => r.json()));
      if (content.length) expect((await page.request.patch(`/api/pages/${n.id}`, { data: { expectedRevision: n.revision, content } })).ok()).toBe(true);
      const loaded = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/pages/${n.id}`);
      await page.goto(`/pages/${n.id}`);expect((await loaded).status()).toBe(200);
      await expect(page.locator(`[data-page-id="${n.id}"] .bn-editor`)).toHaveAttribute("contenteditable", "true");
      return async () => schema.parse(await page.request.get(`/api/pages/${n.id}`).then(r => r.json())).page;
    };
    for (const [index, value] of ["A\nB", "A\rB", "\nA\n\nB\n", "<script>literal</script>\n& text"].entries()) {
      const get = await open();await page.locator(".bn-inline-content").first().click();await paste(page, value);await expect.poll(async () => (await get()).content.length).toBe(value.split(/\r\n?|\n/).length);
      const saved = await get();expect(saved.content.every(b => b.type === "paragraph")).toBe(true);expect(saved.content.map(b => z.array(z.object({ text: z.string() })).parse(b.content).map(i => i.text).join(""))).toEqual(value.split(/\r\n?|\n/));await record(info, `literal-${index}`, saved);
    }
    let get = await open([{ id: "middle", type: "paragraph", content: text("PrefixSuffix") }]);await placeMiddleCaret(page);await paste(page, "One\nTwo");
    await expect.poll(async () => JSON.stringify((await get()).content)).toContain("TwoSuffix");expect(JSON.stringify((await get()).content)).toContain("PrefixOne");await record(info, "paste-in-text", await get());
    get = await open();await page.locator(".bn-inline-content").first().click();await paste(page, "Browser1\nBrowser2", '<p><strong>Browser1</strong></p><p><a href="https://example.test">Browser2</a></p>');await expect.poll(async () => (await get()).content.length).toBe(2);expect(JSON.stringify((await get()).content)).toContain('"bold":true');expect(JSON.stringify((await get()).content)).toContain("https://example.test");await record(info, "rich-html", await get());
    get = await open([{ id: "keep-callout", type: "callout", props: { kind: "warning", title: "Keep title" }, content: text("Callout") }]);await page.locator('[data-id="keep-callout"] .notebook-callout-content').click();await page.keyboard.press("End");await paste(page, "One\nTwo");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("Two");const callout = (await get()).content.find(b => b.id === "keep-callout")!;expect(callout.type).toBe("callout");expect(callout.props).toMatchObject({ kind: "warning", title: "Keep title" });await record(info, "callout-paste", await get());
    get = await open([{ id: "keep-parent", type: "paragraph", content: text("Parent"), children: [{ id: "paste-child", type: "paragraph", content: text("Child") }] }]);await page.locator('[data-id="paste-child"] .bn-inline-content').click();await page.keyboard.press("End");await paste(page, "One\nTwo");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("Two");const parent = (await get()).content.find(b => b.id === "keep-parent")!;expect(parent.children).toHaveLength(2);await record(info, "nested-paste", await get());
    get = await open([{ id: "code", type: "codeBlock", props: { language: "text" }, content: [] }]);await page.locator('[data-id="code"] pre').click();await paste(page, "  A\n\n\tB");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("\\tB");expect((await get()).content).toHaveLength(1);expect((await get()).content[0]!.type).toBe("codeBlock");await record(info, "code", await get());
    get = await open();await page.locator(".bn-inline-content").first().click();await page.keyboard.insertText("Enter1");await page.keyboard.press("Enter");await page.keyboard.insertText("Enter2");await expect.poll(async () => (await get()).content.length).toBe(2);await record(info, "enter", await get());
    get = await open();await page.locator(".bn-inline-content").first().click();await page.keyboard.insertText("Shift1");await page.keyboard.press("Shift+Enter");await page.keyboard.insertText("Shift2");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("Shift2");expect((await get()).content).toHaveLength(1);expect(JSON.stringify((await get()).content)).toContain("\\n");await record(info, "shift-enter", await get());
  });
  test(`${theme}: insert above and below focuses editable siblings without losing nested blocks`, async ({ page }, info) => {
    test.setTimeout(90_000);const content = [{ id: "parent", type: "paragraph", content: text("Parent"), children: [{ id: "child", type: "paragraph", content: text("Child") }] }, { id: "insert-table", type: "table", content: { type: "tableContent", rows: [{ cells: [text("A"), text("B")] }] } }, { id: "insert-columns", type: "columns", props: { count: 2 }, children: [{ id: "column-left", type: "columnPanel", children: [{ id: "column-text", type: "paragraph", content: text("Left") }] }, { id: "column-right", type: "columnPanel", children: [{ id: "right-text", type: "paragraph", content: text("Right") }] }] }];const { get } = await fixture(page, theme, content);
    await blockAction(page, "child", "Добавить блок выше");await page.keyboard.insertText("Before child");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("Before child");
    await blockAction(page, "child", "Добавить блок ниже");await page.keyboard.insertText("After child");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("After child");const saved = await get();await record(info, "insert-siblings", saved);
    const children = saved.content[0]!.children as { id: string; type: string; content: unknown }[];expect(children).toHaveLength(3);expect(children[1]!.id).toBe("child");expect(children.every(b => b.type === "paragraph")).toBe(true);
    await blockAction(page, "child", "Добавить блок выше");await page.keyboard.press("Control+z");await expect.poll(async () => ((await get()).content[0]!.children as unknown[]).length).toBe(3);await page.keyboard.press("Control+Shift+z");await expect.poll(async () => ((await get()).content[0]!.children as unknown[]).length).toBe(4);
    await blockAction(page, "insert-table", "Добавить блок ниже");await page.keyboard.insertText("After table");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("After table");
    await blockAction(page, "column-text", "Добавить блок выше");await page.keyboard.insertText("In left column");await expect.poll(async () => JSON.stringify((await get()).content)).toContain("In left column");
    const result = await get();const columns = result.content.find(b => b.id === "insert-columns")!;const panels = columns.children as { id: string; children: unknown[] }[];expect(panels[0]!.children).toHaveLength(2);expect(panels[1]!.children).toHaveLength(1);expect(result.content.find(b => b.id === "insert-table")!.content).toEqual(saved.content.find(b => b.id === "insert-table")!.content);await record(info, "insert-structures", result);
  });
  test(`${theme}: template editor shares paste and independent transformations`, async ({ page }, info) => {
    const { get } = await fixture(page, theme);const before = await get();await page.getByRole("button", { name: "Шаблоны", exact: true }).click();const manager = page.getByRole("dialog", { name: "Шаблоны", exact: true });await manager.getByRole("button", { name: "Новый", exact: true }).click();const dialog = page.getByRole("dialog", { name: "Новый шаблон", exact: true });await expect(dialog.getByLabel("Название шаблона", { exact: true })).toBeEnabled();await dialog.getByLabel("Название шаблона", { exact: true }).fill("Fundamentals template");await dialog.locator(".bn-inline-content").first().click();
    await dialog.locator(".bn-editor").evaluate(root => { const data = new DataTransfer();data.setData("text/plain", "Template1\r\nTemplate2\r\nTemplate3");root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });await expect(dialog.locator('[data-content-type="paragraph"]')).toHaveCount(3);
    await selectLines(page, dialog.locator(".bn-editor"));await dialog.locator(".bn-block-outer").first().hover();await dialog.getByRole("button", { name: "Действия с блоком", exact: true }).click();await page.getByRole("menuitem", { name: "Преобразовать", exact: true }).hover();await page.getByRole("menuitem", { name: "Заголовок", exact: true }).click();await expect(dialog.locator('[data-content-type="heading"]')).toHaveCount(3);await page.screenshot({ path: info.outputPath(`${theme}-template.png`) });await dialog.getByRole("button", { name: "Сохранить шаблон", exact: true }).click();await expect(dialog).toHaveCount(0);
    const data = z.object({ templates: z.array(z.object({ name: z.string(), content: z.array(z.record(z.string(), z.unknown())) })) }).parse(await page.request.get("/api/templates").then(r => r.json()));const saved = data.templates.find(t => t.name === "Fundamentals template")!;expect(saved.content.map(b => b.type)).toEqual(Array(3).fill("heading"));await record(info, "template", saved);expect(await get()).toEqual(before);
  });
}
