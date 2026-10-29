import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Isolated diagnostic-tool validation, not a Notebook HTTP E2E or production reproduction.
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome" });
try {
  const page = await browser.newPage();const marker = "PRIVATE_SENTINEL_NOT_FOR_REPORT";let requests = 0;
  await page.route("http://probe.test/**", route => {
    requests++;const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: `<div class="notebook-app-shell" data-workspace-screen="workspace"><aside class="notebook-sidebar"><button>Today</button><div class="notebook-navigation-tree" style="width:240px;height:80px;overflow:auto"><section data-notebook-title="${marker}"><div data-nav-row="section">${marker}</div></section></div></aside><div class="notebook-page-list" style="width:300px;height:100px"><div data-page-title="${marker}"></div></div><div class="workspace-editor-slot" data-active="true"><div class="bn-editor">${marker}</div></div></div>` });
    if (pathname === "/api/notebooks") return route.fulfill({ json: { notebooks: [{ id: marker, title: marker, sections: [{ title: marker }, { title: marker }] }] } });
    return route.fulfill({ status: pathname.startsWith("/api/auth/") ? 401 : 200, headers: { "set-cookie": `private_test=${marker}; HttpOnly` }, json: { title: marker, content: marker, token: marker } });
  });
  await page.goto("http://probe.test/");await page.evaluate(() => { window.__probeOriginalFetch = window.fetch; });
  await page.evaluate(await readFile(new URL("../docs/workspace-c1-evidence/browser-probe.js", import.meta.url), "utf8"));
  await page.evaluate(async marker => {
    const tree = await fetch(`/api/notebooks?q=${marker}`).then(r => r.json());if (tree.notebooks[0].title !== marker) throw new Error("Probe changed response");
    const document = await fetch(`/api/pages/${marker}`).then(r => r.json());if (document.content !== marker) throw new Error("Probe consumed response");
    await fetch("/api/auth/login", { method: "POST", headers: { authorization: marker }, body: marker });
  }, marker);
  const report = () => page.evaluate(() => JSON.parse(window.__notebookWorkspaceProbe.report()));
  await expect.poll(async () => (await report()).events.some(e => e.type === "tree-response" && e.books === 1 && e.sections === 2)).toBe(true);
  await page.locator(".notebook-navigation-tree").evaluate(node => { node.style.height = "0px"; });
  expect((await report()).events.some(e => e.type === "layout" && e.books === 1 && e.tree.height === 0 && e.staticNavigation)).toBe(true);
  await page.locator(".notebook-navigation-tree").evaluate(node => { node.style.height = "80px";node.replaceChildren(); });
  expect((await report()).events.some(e => e.type === "layout" && e.books === 0 && e.tree.height === 80 && e.staticNavigation)).toBe(true);
  await page.evaluate(marker => { const error = new Error(marker);error.name = marker;window.dispatchEvent(new ErrorEvent("error", { error, message: marker, filename: `http://probe.test/${marker}` })); }, marker);
  await page.evaluate(() => { const until = performance.now() + 1100;while (performance.now() < until) { /* Simulate a blocked diagnostic target only. */ } });
  expect((await report()).events.some(e => e.type === "sampling-gap" && e.durationMs > 1000)).toBe(true);
  const result = await report();expect(result.events.some(e => e.type === "http-end" && e.endpoint === "auth" && e.status === 401)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(marker);expect(JSON.stringify(result)).not.toContain("probe.test");expect(requests).toBe(4);
  await page.evaluate(() => { window.__notebookWorkspaceProbe.stop();if (window.fetch !== window.__probeOriginalFetch) throw new Error("Fetch was not restored"); });
  console.log("Workspace probe: isolated DOM/layout, HTTP preservation, privacy, gap detection and cleanup passed; no Notebook app reproduction claimed.");
} finally { await browser.close(); }
