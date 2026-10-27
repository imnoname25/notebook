import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

async function setup(page: Page) {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Split test" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Split workspace" } }).then(r => r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title: "Documents" } }).then(r => r.json()));
  const stamp = Date.now();
  return Promise.all(["Alpha", "Beta", "Gamma"].map(async label => {
    const response = await page.request.post("/api/pages", { data: { sectionId: section.id, title: `Split${label}${stamp}` } });expect(response.ok()).toBe(true);
    const note = z.object({ page: id.extend({ title: z.string(), revision: z.number() }) }).parse(await response.json()).page;
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] });
    const content = [paragraph(`Original ${label}`), { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Synthetic task", styles: {} }] },
      ...(label === "Beta" ? [{ type: "table", content: { type: "tableContent", rows: [{ cells: ["Name", "Link", "Value"] }, { cells: ["Synthetic name", "https://example.test/value", "Technical value"] }].map(row => ({ cells: row.cells.map(text => [{ type: "text", text, styles: {} }]) })) } }] : []),
      ...Array.from({ length: 60 }, (_, index) => paragraph(label === "Gamma" && index === 59 ? `SplitMatch${stamp}` : `Synthetic paragraph ${index}`))];
    expect((await page.request.patch(`/api/pages/${note.id}`, { data: { expectedRevision: note.revision, content } })).ok()).toBe(true);
    return { ...note, match: `SplitMatch${stamp}` };
  }));
}

for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: independent writers, failed close, pane transfer and responsive restoration`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const [a, b, c] = await setup(page);const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width: 1920, height: 1080 });await page.goto(`/pages/${a!.id}`);
    const left = page.locator('.workspace-editor-slot[data-pane="left"]');const right = page.locator('.workspace-editor-slot[data-pane="right"]');
    const title = (pane: typeof left) => pane.getByLabel("Название страницы", { exact: true });
    const search = async (query: string) => {
      await page.keyboard.press("Control+k");await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(query);
      await page.getByRole("region", { name: "Быстрый поиск документов" }).getByRole("option").first().click();
    };
    const content = async (id: string) => JSON.stringify(await page.request.get(`/api/pages/${id}`).then(r => r.json()));
    const type = async (pane: typeof left, text: string) => { await pane.locator(".bn-inline-content").first().click();await page.keyboard.press("End");await page.keyboard.type(text); };
    await expect(title(left)).toHaveValue(a!.title);await left.getByRole("button", { name: "Split View", exact: true }).click();await search(b!.title);
    await expect(title(right)).toHaveValue(b!.title);await expect(page.locator(".bn-editor")).toHaveCount(2);
    await type(left, "Alpha saved marker");await type(right, "Beta saved marker");
    await expect.poll(() => content(a!.id)).toContain("Alpha saved marker");await expect.poll(() => content(b!.id)).toContain("Beta saved marker");expect(await content(a!.id)).not.toContain("Beta saved marker");
    await page.reload();await expect(title(left)).toHaveValue(a!.title);await expect(title(right)).toHaveValue(b!.title);
    // An existing document is focused in its own pane, rather than duplicated.
    await search(a!.title);await expect(left).toHaveAttribute("data-active", "true");await expect(page.locator(".bn-editor")).toHaveCount(2);
    const separator = page.getByRole("separator", { name: "Ширина панелей документов", exact: true });
    await separator.focus();await page.keyboard.press("ArrowRight");await expect(separator).toHaveAttribute("aria-valuenow", "52");await separator.dblclick();await expect(separator).toHaveAttribute("aria-valuenow", "50");
    await page.route(`**/api/pages/${a!.id}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Synthetic offline A" } }) : route.continue());
    await type(left, " Pending alpha");await expect(left.getByRole("button", { name: "Повторить сохранение", exact: true })).toBeVisible();
    await type(right, " Independent beta");await expect.poll(() => content(b!.id)).toContain("Independent beta");
    await right.getByRole("button", { name: "Закрыть Split View", exact: true }).click();await expect(page.locator(".bn-editor")).toHaveCount(2);await expect(left.locator(".bn-editor")).toContainText("Pending alpha");
    await page.unroute(`**/api/pages/${a!.id}`);await left.getByRole("button", { name: "Повторить сохранение", exact: true }).click();await expect.poll(() => content(a!.id)).toContain("Pending alpha");
    await left.locator('.document-tab[data-active="true"]').dragTo(right);await expect(title(right)).toHaveValue(a!.title);
    await right.getByRole("button", { name: "Закрыть Split View", exact: true }).click();await expect(page.locator(".bn-editor")).toHaveCount(1);await expect(title(left)).toHaveValue(a!.title);
    await left.getByRole("button", { name: "Split View", exact: true }).click();await search(c!.match);await expect(title(right)).toHaveValue(c!.title);
    await expect(right.locator(".notebook-search-current").first()).toHaveText(c!.match);await expect(left.locator(".notebook-search-match")).toHaveCount(0);
    for (const width of [360, 840, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });await expect(title(right)).toHaveValue(c!.title);await expect(page.locator(".bn-editor")).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`) });
    }
    await page.keyboard.press("Control+Alt+ArrowLeft");await expect(left).toHaveAttribute("data-active", "true");
    await search(b!.title);await expect(title(left)).toHaveValue(b!.title);await page.goBack();await expect(title(left)).toHaveValue(a!.title);await expect(title(right)).toHaveValue(c!.title);
    expect(errors).toEqual([]);
  });
}
