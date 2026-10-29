import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { z } from "zod";

const entity = z.object({ id: z.string() });
const note = entity.extend({ title: z.string(), revision: z.number(), content: z.array(z.record(z.string(), z.unknown())) });
const text = (value: string) => [{ type: "text", text: value, styles: {} }];
async function fixture(page: Page) {
  const credentials = { email: "admin@example.test", password: "correct horse battery staple" };
  const { needsSetup } = z.object({ needsSetup: z.boolean() }).parse(await page.request.get("/api/auth/status").then(r => r.json()));
  expect((await page.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", { data: needsSetup ? { ...credentials, name: "Synthetic responsiveness" } : credentials })).ok()).toBe(true);
  const isolated = { email: `workspace-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: credentials.password };
  expect((await page.request.post("/api/admin/users", { data: { ...isolated, name: "Workspace investigation", role: "USER", mustChangePassword: false } })).ok()).toBe(true);
  expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);expect((await page.request.post("/api/auth/login", { data: isolated })).ok()).toBe(true);
  const { notebook } = z.object({ notebook: entity }).parse(await page.request.post("/api/notebooks", { data: { title: `Workspace probe ${Date.now()}` } }).then(r => r.json()));
  const sections: { id: string; title: string; pages: z.infer<typeof note>[] }[] = [];
  for (let i = 0; i < 5; i++) {
    const title = `Измерение раздел ${i}`;
    const { section } = z.object({ section: entity }).parse(await page.request.post("/api/sections", { data: { notebookId: notebook.id, title } }).then(r => r.json()));
    const pages: z.infer<typeof note>[] = [];
    for (let j = 0; j < 2; j++) {
      const { page: created } = z.object({ page: note }).parse(await page.request.post("/api/pages", { data: { sectionId: section.id, title: `Измерение ${i}-${j}` } }).then(r => r.json()));
      const content = [
        ...Array.from({ length: 35 }, (_, k) => ({ id: `paragraph-${i}-${j}-${k}`, type: "paragraph", content: text(`Синтетический текст ${k}. Без личных данных.`) })),
        { id: `table-${i}-${j}`, type: "table", content: { type: "tableContent", columnWidths: [240, 240, 240], rows: [{ cells: ["Name", "Value", "Description"] }, { cells: ["Synthetic", "HTTP", "Testing"] }] } },
        { id: `link-${i}-${j}`, type: "paragraph", content: [{ type: "link", href: "https://example.test", content: text("Test link") }] },
      ];
      const { page: saved } = z.object({ page: note }).parse(await page.request.patch(`/api/pages/${created.id}`, { data: { expectedRevision: created.revision, content } }).then(r => r.json()));pages.push(saved);
    }
    sections.push({ ...section, title, pages });
  }
  return { notebook, sections };
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    const metrics = { commits: 0, duration: 0, renders: {} as Record<string, number>, mounts: {} as Record<string, number>, longTasks: [] as number[], treeEmpty: 0, treeRemoved: 0, editorMounts: 0 };
    Object.assign(window, { __workspaceProbe: metrics });
    let renderer = 0;
    // React DevTools commit hook and development profiling timings; no app instrumentation.
    Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, renderers: new Map(), inject() { return ++renderer; }, onCommitFiberUnmount() {},
      onCommitFiberRoot(_id: number, root: { current: unknown }) {
        type Fiber = { type?: { name?: string }; actualDuration?: number; flags: number; alternate?: Fiber; child?: Fiber; sibling?: Fiber };
        metrics.commits++;metrics.duration += (root.current as Fiber).actualDuration ?? 0;
        const visit = (fiber: Fiber | undefined) => { if (!fiber) return;const name = fiber.type?.name;if (name && ["NotebookWorkspace", "NotebookSidebar", "NotebookSidebarTree", "RichTextEditor", "WorkspacePane"].includes(name)) { if (fiber.flags & 1) metrics.renders[name] = (metrics.renders[name] ?? 0) + 1;if (!fiber.alternate) metrics.mounts[name] = (metrics.mounts[name] ?? 0) + 1; }visit(fiber.child);visit(fiber.sibling); };visit(root.current as Fiber);
      },
    } });
    new PerformanceObserver(list => metrics.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ entryTypes: ["longtask"] });
    let seen = false;let lastTree: Element | null = null;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) metrics.editorMounts += Number(node.matches(".bn-editor")) + node.querySelectorAll(".bn-editor").length;
      const tree = document.querySelector(".notebook-navigation-tree");const count = tree?.querySelectorAll("[data-notebook-title]").length ?? 0;
      if (seen && tree && !count) metrics.treeEmpty++;if (lastTree && !lastTree.isConnected) metrics.treeRemoved++;if (count) seen = true;lastTree = tree;
    }).observe(document, { subtree: true, childList: true });
  });
}
async function snapshot(page: Page) {
  return page.evaluate(() => ({ metrics: Reflect.get(window, "__workspaceProbe") as Record<string, unknown>, heap: (Reflect.get(performance, "memory") as { usedJSHeapSize?: number } | undefined)?.usedJSHeapSize ?? null }));
}
for (const theme of ["studio-graphite", "studio-atelier"]) test(`${theme}: measured workspace navigation and delayed reads`, async ({ page, context }, info) => {
  test.setTimeout(240_000);const { sections } = await fixture(page);await observe(page);
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];page.on("pageerror", e => errors.push(e.message));page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const requests: { url: string; method: string; ms: number; status: number }[] = [];const times = new Map<object, number>();
  page.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) times.set(r, performance.now()); });
  page.on("requestfinished", async r => { if (!times.has(r)) return;requests.push({ url: new URL(r.url()).pathname + new URL(r.url()).search, method: r.method(), ms: performance.now() - times.get(r)!, status: (await r.response())?.status() ?? 0 }); });
  await page.goto(`/pages/${sections[0].pages[0].id}`);await expect(page.locator(".bn-editor[contenteditable=true]")).toBeVisible();
  const section = (i: number) => page.locator(`.notebook-sidebar [data-nav-select][aria-describedby]`).filter({ hasText: sections[i].title }).last();
  const select = (i: number, j = 0) => page.locator(`[data-page-title="${sections[i].pages[j].title}"] [data-page-select]`);
  // Warm each real route/compiler before measuring. No artificial application delay.
  await section(1).click();await expect(select(1)).toBeVisible();await select(1).click();await expect(page.locator(".bn-editor[contenteditable=true]")).toBeVisible();
  const cdp = await context.newCDPSession(page);await cdp.send("Tracing.start", { categories: "devtools.timeline,v8,blink.user_timing", transferMode: "ReturnAsStream" });
  const start = await snapshot(page), requestStart = requests.length;const actions: { kind: string; ms: number; requests: number }[] = [];
  for (let k = 0; k < 30; k++) {
    const i = k % 5;let now = performance.now(), n = requests.length;await section(i).click();await expect(select(i)).toBeVisible();actions.push({ kind: "section", ms: performance.now() - now, requests: requests.length - n });
    now = performance.now();n = requests.length;await select(i).click();await expect(page.locator(".workspace-editor-slot[data-active=true] .bn-editor[contenteditable=true]")).toBeVisible();await expect(page).toHaveURL(new RegExp(`/pages/${sections[i].pages[0].id}`));actions.push({ kind: "page", ms: performance.now() - now, requests: requests.length - n });
  }
  const serial = { start, end: await snapshot(page), actions, requests: requests.slice(requestStart) };
  // A slow superseded GET must not hold the new selection hostage. Delay transport only, preserve real HTTP body.
  const old = sections[4].pages[1], latest = sections[4].pages[0];let release!: () => void;let arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(`**/api/pages/${old.id}`, async route => { const response = await route.fetch();arrived();await gate;await route.fulfill({ response }); });
  await select(4, 1).click();await started;const rapidStart = performance.now();await select(4).click();
  const responsiveness = await page.waitForFunction(id => location.pathname.endsWith(id) && !document.querySelector('.workspace-editor-slot[data-active=true] .bn-editor[contenteditable="false"]'), latest.id, { timeout: 1500 }).then(() => true, () => false);
  const delayedMs = performance.now() - rapidStart;
  release();await expect(page).toHaveURL(new RegExp(`/pages/${latest.id}`));await page.unroute(`**/api/pages/${old.id}`);
  const splitStart = requests.length;await page.getByRole("button", { name: "Split View", exact: true }).click();await select(4, 1).click();await expect(page.locator(".workspace-editors")).toHaveAttribute("data-two", "true");
  const splitReady = await snapshot(page), switchStart = requests.length;
  for (let k = 0; k < 30; k++) { await select(4, k % 2).click();await expect(page).toHaveURL(new RegExp(`/pages/${sections[4].pages[k % 2].id}`)); }
  const end = await snapshot(page);
  expect(end.metrics.editorMounts).toBe(splitReady.metrics.editorMounts);
  expect(requests.slice(switchStart).filter(r => /^\/api\/pages\/[^/]+$/.test(r.url))).toHaveLength(0);
  const stopped = new Promise<string>(resolve => cdp.once("Tracing.tracingComplete", event => resolve(event.stream!)));await cdp.send("Tracing.end");const stream = await stopped;let trace = "";
  for (;;) { const data = await cdp.send("IO.read", { handle: stream });trace += data.data;if (data.eof) break; }await cdp.send("IO.close", { handle: stream });
  await writeFile(info.outputPath("performance.json"), trace);await writeFile(info.outputPath("measurements.json"), JSON.stringify({ theme, serial, delayed: { responsiveness, ms: delayedMs }, split: { requests: requests.slice(splitStart), end }, errors }, null, 2));
  await page.screenshot({ path: info.outputPath(`${theme}-workspace.png`) });expect(errors).toEqual([]);expect(responsiveness).toBe(true);
  expect(serial.requests.filter(r => r.url === "/api/notebooks" || r.url === "/api/account/preferences")).toHaveLength(0);
  expect(serial.requests.filter(r => r.url.startsWith("/api/pages?"))).toHaveLength(30);
  expect(end.metrics.treeEmpty).toBe(0);expect(end.metrics.treeRemoved).toBe(0);
});

for (const theme of ["studio-graphite", "studio-atelier"]) test(`${theme}: reversed lists, errors, 30 rapid selections and pending autosave`, async ({ page }) => {
  const { sections } = await fixture(page);await observe(page);await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
  let releaseTree!: () => void;const treeGate = new Promise<void>(resolve => { releaseTree = resolve; });
  await page.route("**/api/notebooks", async route => { const response = await route.fetch();await treeGate;await route.fulfill({ response }); });
  await page.goto(`/pages/${sections[0].pages[0].id}`);await expect(page.getByText("Загрузка блокнотов…", { exact: true })).toBeVisible();await expect(page.getByText("Здесь появятся ваши блокноты.", { exact: true })).toHaveCount(0);releaseTree();await expect(page.locator(".bn-editor[contenteditable=true]")).toBeVisible();await page.unroute("**/api/notebooks");
  const section = (i: number) => page.locator(`.notebook-sidebar [data-nav-select][title="${sections[i].title}"]`).last();
  const select = (i: number, j = 0) => page.locator(`[data-page-title="${sections[i].pages[j].title}"] [data-page-select]`);
  // Genuine HTTP responses delivered in reverse order. Only their transport timing changes.
  let release!: () => void, began!: () => void;const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { began = resolve; });
  let delivered!: () => void;const delivery = new Promise<void>(resolve => { delivered = resolve; });
  const slowList = `**/api/pages?sectionId=${sections[1].id}`;
  await page.route(slowList, async route => { const response = await route.fetch();began();await gate;await route.fulfill({ response });delivered(); });
  await section(1).click();await started;await section(2).click();await expect(select(2)).toBeVisible();release();await delivery;await page.unroute(slowList);await expect(select(1)).toHaveCount(0);await expect(select(2)).toBeVisible();
  const failedList = `**/api/pages?sectionId=${sections[3].id}`;
  await page.route(failedList, route => route.fulfill({ status: 503, json: { error: "Synthetic list unavailable" } }));await section(3).click();await expect(page.locator(".notebook-page-list").getByRole("status").filter({ hasText: "Не удалось загрузить страницы" })).toContainText("Не удалось загрузить страницы");await expect(page.getByText("В разделе пока нет страниц.", { exact: true })).toHaveCount(0);await expect(page.locator(".notebook-navigation-tree [data-notebook-title]").first()).toBeVisible();await page.unroute(failedList);await page.locator(".notebook-page-list").getByRole("button", { name: "Повторить", exact: true }).click();await expect(select(3)).toBeVisible();
  await select(3).click();const target = sections[3].pages[0];await expect(page).toHaveURL(new RegExp(`/pages/${target.id}`));const editor = page.locator(".workspace-editor-slot[data-active=true] .bn-editor");await expect(editor).toHaveAttribute("contenteditable", "true");
  let saveRelease!: () => void, saving!: () => void;const saveGate = new Promise<void>(resolve => { saveRelease = resolve; }), saveStarted = new Promise<void>(resolve => { saving = resolve; });
  await page.route(`**/api/pages/${target.id}`, async route => { if (route.request().method() !== "PATCH") return route.continue();saving();await saveGate;await route.continue(); });
  const marker = " СохранённыйТекстБыстройНавигации";await editor.locator(".bn-inline-content").first().click();await page.keyboard.press("End");await page.keyboard.insertText(marker);await saveStarted;
  // Requests while a write is pending: the final selection must win, never cancel the write.
  await page.evaluate(titles => { for (let k = 0; k < 30; k++) { const buttons = document.querySelectorAll<HTMLButtonElement>(`.notebook-sidebar [data-nav-select][title="${titles[k % 5]}"]`);buttons.item(buttons.length - 1).click(); } }, sections.map(s => s.title));
  saveRelease();await expect(select(4)).toBeVisible();await page.unroute(`**/api/pages/${target.id}`);
  const saved = z.object({ page: note }).parse(await page.request.get(`/api/pages/${target.id}`).then(r => r.json())).page;expect(JSON.stringify(saved.content)).toContain(marker.trim());
  await section(3).click();await expect(select(3)).toBeVisible();await select(3).click();await expect(editor).toContainText(marker.trim());
  const metrics = (await snapshot(page)).metrics;expect(metrics.treeEmpty).toBe(0);expect(metrics.treeRemoved).toBe(0);expect(metrics.mounts).toMatchObject({ NotebookWorkspace: 1 });expect(errors).toEqual([]);
  for (const width of [360, 840, 1920]) { await page.setViewportSize({ width, height: 900 });await expect(editor).toContainText(marker.trim());expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); }
});
