import { execFileSync } from "node:child_process";

export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL must point to a dedicated PostgreSQL test database");
  if (process.env.E2E_RESET_DATABASE !== "1") throw new Error("Set E2E_RESET_DATABASE=1 to confirm that the dedicated E2E database may be cleared");
  process.env.DATABASE_URL = databaseUrl;
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  const { db } = await import("../src/lib/db");
  await db.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
  await db.$disconnect();
}
