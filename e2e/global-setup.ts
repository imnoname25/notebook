import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { Client } from "pg";

export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL must point to a dedicated PostgreSQL test database");
  if (process.env.E2E_RESET_DATABASE !== "1") throw new Error("Set E2E_RESET_DATABASE=1 to confirm that the dedicated E2E database may be cleared");
  process.env.DATABASE_URL = databaseUrl;
  // Execute the installed CLI through Node: .cmd files cannot be execFileSync'd on Windows.
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const prismaCli = path.join(path.dirname(require.resolve("prisma/package.json")), "build", "index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { stdio: "inherit", env: process.env });
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { await client.query('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE'); }
  finally { await client.end(); }
  // Cold compilation is test preparation, not a timed user interaction. The
  // first fresh webpack run spent 23s compiling / before showing the login UI.
  const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
  const publicPaths = ["/", "/login", "/app"];
  const authPaths = ["/api/auth/setup", "/api/auth/login"];
  const protectedPaths = ["/api/account/preferences", "/api/notifications", "/api/notebooks"];
  for (const pathname of [...publicPaths, ...authPaths, ...protectedPaths]) {
    const response = await fetch(new URL(pathname, baseURL), {
      method: authPaths.includes(pathname) ? "OPTIONS" : "GET",
      signal: AbortSignal.timeout(120_000),
    });
    if (protectedPaths.includes(pathname) ? response.status !== 401 : !response.ok) {
      throw new Error(`E2E route preparation failed: ${pathname} (${response.status})`);
    }
    await response.arrayBuffer();
  }
}
