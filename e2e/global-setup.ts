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
}
