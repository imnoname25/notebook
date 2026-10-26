import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
async function setup(page: Page) {
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r=>r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Tabs test" } : credentials })).ok()).toBe(true);
  const id = z.object({ id: z.string() });
  const { notebook } = z.object({ notebook: id }).parse(await page.request.post("/api/notebooks", { data: { title: "Tabs E2E" } }).then(r=>r.json()));
  const { section } = z.object({ section: id }).parse(await page.request.post("/api/sections", { data: { title: "Tabs", notebookId: notebook.id } }).then(r=>r.json()));
  return Promise.all(["First tab", "Second tab", "Third tab"].map(async title => {
    const result = await page.request.post("/api/pages", { data: { title, sectionId: section.id } });
    expect(result.ok()).toBe(true);return z.object({ page: id.extend({ title: z.string() }) }).parse(await result.json()).page;
  }));
}
for (const theme of ["studio-graphite", "studio-atelier"]) {
  test(`${theme}: pending save, failed close, session and responsive tabs`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const notes = await setup(page);const [first,second,third] = notes;
    await page.addInitScript(theme=>localStorage.setItem("theme",theme),theme);
    await page.setViewportSize({ width: 1440, height: 900 });await page.goto(`/pages/${first!.id}`);
    const title = page.getByLabel("Название страницы", { exact: true });
    await expect(title).toHaveValue(first!.title);
    const rowByTitle = (name: string) => page.locator(`[data-page-title="${name}"] button[title]`);
    await rowByTitle(second!.title).click();await expect(title).toHaveValue(second!.title);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await rowByTitle(first!.title).dblclick();await expect(title).toHaveValue(first!.title);
    await rowByTitle(second!.title).click({ modifiers: ["Control"] });await expect(title).toHaveValue(second!.title);
    await rowByTitle(third!.title).click({ modifiers: ["Meta"] });await expect(title).toHaveValue(third!.title);
    await expect(page.getByRole("tab")).toHaveCount(3);
    const select = (name: string) => page.getByRole("tab", { name, exact: true }).click();
    await select(first!.title);await expect(title).toHaveValue(first!.title);
    const editor = page.locator('.bn-editor[contenteditable="true"]');await editor.click();await page.keyboard.type("Saved across tabs");
    await select(second!.title);await select(third!.title);await expect(title).toHaveValue(third!.title);
    await expect.poll(async()=>JSON.stringify(await page.request.get(`/api/pages/${first!.id}`).then(r=>r.json()))).toContain("Saved across tabs");
    await select(first!.title);await expect(title).toHaveValue(first!.title);
    await page.route(`**/api/pages/${first!.id}`,route=>route.request().method()==="PATCH" ? route.fulfill({ status:503, json:{error:"Test save offline"} }) : route.continue());
    await editor.click();await page.keyboard.type(" Keep on failure");
    await page.locator(".document-tabs-strip").getByRole("button",{name:`Закрыть вкладку: ${first!.title}`,exact:true}).click();
    await expect(page.getByRole("button",{name:"Повторить сохранение",exact:true})).toBeVisible();await expect(title).toHaveValue(first!.title);await expect(page.getByRole("tab")).toHaveCount(3);
    await page.unroute(`**/api/pages/${first!.id}`);await page.getByRole("button",{name:"Повторить сохранение",exact:true}).click();
    await expect.poll(async()=>JSON.stringify(await page.request.get(`/api/pages/${first!.id}`).then(r=>r.json()))).toContain("Keep on failure");
    await page.locator(".document-tabs-strip").getByRole("button",{name:`Действия вкладки: ${first!.title}`,exact:true}).click();await page.getByRole("menuitem",{name:"Закрепить вкладку",exact:true}).click();
    await select(second!.title);await expect(title).toHaveValue(second!.title);await select(third!.title);await expect(title).toHaveValue(third!.title);
    await page.goBack();await expect(title).toHaveValue(second!.title);await page.goForward();await expect(title).toHaveValue(third!.title);
    await page.goto("/app");await expect(title).toHaveValue(third!.title);await expect(page.getByRole("tab")).toHaveCount(3);await expect(page.locator('.document-tab[data-pinned="true"]')).toHaveCount(1);
    await page.goto(`/pages/${first!.id}`);await expect(title).toHaveValue(first!.title);
    for (const [width,height] of [[1440,900],[393,873],[840,960]]) { await page.setViewportSize({width,height});await expect(title).toHaveValue(first!.title);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath(`${theme}-${width}.png`)}); }
    await page.setViewportSize({width:1440,height:900});
    expect((await page.request.delete(`/api/pages/${third!.id}`)).ok()).toBe(true);await page.goto("/app");await expect(title).toHaveValue(first!.title);await expect(page.getByRole("tab")).toHaveCount(2);
  });
}
