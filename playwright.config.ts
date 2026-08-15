import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const serverUrl = new URL(baseURL);
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";
const listingOnly = process.argv.includes("--list");
if (!listingOnly && !databaseUrl) throw new Error("E2E_DATABASE_URL must point to a dedicated PostgreSQL test database");
if (!listingOnly && process.env.E2E_RESET_DATABASE !== "1") throw new Error("Set E2E_RESET_DATABASE=1 to confirm that the dedicated E2E database may be cleared");
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --hostname ${serverUrl.hostname} --port ${serverUrl.port || "3100"}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATABASE_URL: databaseUrl, APP_ORIGIN: baseURL },
  },
});
