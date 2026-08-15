import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL; const enabled = Boolean(databaseUrl) && process.env.TEST_RESET_DATABASE === "1"; if (enabled) process.env.DATABASE_URL = databaseUrl;
describe.skipIf(!enabled)("operations integration", () => {
  let db: typeof import("@/lib/db").db; let backup: typeof import("./backup-service"); let settingsService: typeof import("./settings-service"); let directory = "";
  beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "notebook-backups-integration-")); process.env.BACKUP_DIR = directory; ({ db } = await import("@/lib/db")); backup = await import("./backup-service"); settingsService = await import("./settings-service"); });
  beforeEach(async () => { await db.backupRecord.deleteMany(); await db.applicationSettings.deleteMany(); await rm(directory, { recursive: true, force: true }); await mkdir(directory); });
  afterAll(async () => { if (db) await db.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  it("retention removes only old successful local backups", async () => { await db.applicationSettings.create({ data: { backupRetentionCount: 1, backupRetentionDays: 30 } }); const old = await db.backupRecord.create({ data: { type: "manual", status: "success", filename: "notebook-backup-old.zip", createdAt: new Date("2026-08-01") } }); const current = await db.backupRecord.create({ data: { type: "manual", status: "success", filename: "notebook-backup-current.zip", createdAt: new Date("2026-08-14") } }); await writeFile(path.join(directory, old.filename!), "old"); await writeFile(path.join(directory, current.filename!), "current"); expect(await backup.enforceBackupRetention(new Date("2026-08-14"))).toBe(1); await expect(readFile(path.join(directory, old.filename!))).rejects.toThrow(); expect(await readFile(path.join(directory, current.filename!), "utf8")).toBe("current"); });
  it("normal settings response never contains the encrypted WebDAV password", async () => { const settings = await db.applicationSettings.create({ data: { webdavPasswordEncrypted: "v1:secret" } }); const response = settingsService.publicSettings(settings); expect(JSON.stringify(response)).not.toContain("v1:secret"); expect(response.webdavPasswordConfigured).toBe(true); });
});
