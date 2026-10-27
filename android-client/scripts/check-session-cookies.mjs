import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";

// Chrome proves the cookie/initiator regression; it does not replace an Android test.
const requests = [];
let origin;
const server = http.createServer((request, response) => {
  const authenticated = (request.headers.cookie ?? "").includes("notebook_session=synthetic-test-session");
  if (request.url === "/app") requests.push({ authenticated, site: request.headers["sec-fetch-site"] });
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/login-test") {
    response.setHeader("Set-Cookie", "notebook_session=synthetic-test-session; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600");
  } else if (request.url === "/logout-test") {
    response.setHeader("Set-Cookie", "notebook_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  } else if (request.url === "/launcher") {
    response.end(`<script>location.replace(${JSON.stringify(`${origin}/app`)})</script>`);
    return;
  }
  response.end(authenticated ? "SIGNED_IN" : "LOGIN_REQUIRED");
});
await new Promise(resolve => server.listen(0, "0.0.0.0", resolve));
let browser;
try {
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  let context = await browser.newContext();
  let page = await context.newPage();
  await page.goto(`${origin}/login-test`);
  const state = await context.storageState();
  const cookie = state.cookies.find(cookie => cookie.name === "notebook_session");
  assert.ok(cookie.httpOnly && cookie.sameSite === "Strict" && cookie.expires > Date.now() / 1000);
  await context.close();

  // Simulate restoring the persistent cookie store after a process restart.
  context = await browser.newContext({ storageState: state });
  page = await context.newPage();
  await page.goto(`http://localhost:${port}/launcher`);
  await page.waitForURL(`${origin}/app`);
  assert.equal(await page.locator("body").innerText(), "LOGIN_REQUIRED");
  assert.deepEqual(requests.at(-1), { authenticated: false, site: "cross-site" });
  assert.ok((await context.cookies(origin)).some(cookie => cookie.name === "notebook_session"), "The cookie was not deleted");

  // Playwright initiates a fresh navigation without the launcher's JS initiator.
  await page.goto(`${origin}/app`);
  assert.equal(await page.locator("body").innerText(), "SIGNED_IN");
  assert.deepEqual(requests.at(-1), { authenticated: true, site: "none" });
  await page.goto(`${origin}/logout-test`);
  await page.goto(`${origin}/app`);
  assert.equal(await page.locator("body").innerText(), "LOGIN_REQUIRED");
  assert.equal((await context.cookies(origin)).some(cookie => cookie.name === "notebook_session"), false);
  console.log("PASS Chrome: persistent Strict/HttpOnly cookie, cross-site launch reproduction, initiator-free launch, logout. Physical Android: NOT TESTED.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
