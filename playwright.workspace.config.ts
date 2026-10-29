import { defineConfig, devices } from "@playwright/test";

// Non-destructive P0 investigation: no global setup, TRUNCATE, reset or teardown deletes.
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Use a dedicated local notebook_workspace_* PostgreSQL database");
const database = new URL(databaseUrl);
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const server = new URL(baseURL);
if (!["127.0.0.1", "localhost"].includes(database.hostname) || !database.pathname.startsWith("/notebook_workspace_") || !["127.0.0.1", "localhost"].includes(server.hostname)) throw new Error("Workspace investigation requires isolated loopback database/server URLs");
process.env.DATABASE_URL = databaseUrl;
export default defineConfig({
  testDir: "./e2e", testMatch: "**/workspace-responsiveness.spec.ts", outputDir: "test-results/workspace-c1",
  fullyParallel: false, workers: 1, retries: 0, timeout: 180_000, reporter: "list",
  use: { baseURL, channel: process.env.E2E_BROWSER_CHANNEL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: `npm run dev -- --hostname ${server.hostname} --port ${server.port || "3100"}`, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000, env: { DATABASE_URL: databaseUrl, APP_ORIGIN: baseURL } },
});
