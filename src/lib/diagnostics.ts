import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { uploadRoot } from "@/lib/storage";
import { backupRoot } from "@/lib/backup-storage";

export type CheckStatus = "ok" | "error" | "unknown";
async function writableStorage(root: string) {
  try { await mkdir(root, { recursive: true }); const probe = path.join(root, `.notebook-health-${randomUUID()}`); await writeFile(probe, "health", { flag: "wx" }); await rm(probe, { force: true }); const filesystem = await statfs(root).catch(() => null); return { status: "ok" as const, writable: true, freeBytes: filesystem ? Number(filesystem.bavail * filesystem.bsize) : null }; }
  catch { return { status: "error" as const, writable: false, freeBytes: null }; }
}

export async function databaseDiagnostic() { const started = Date.now(); try { await db.$queryRaw`SELECT 1`; return { status: "ok" as const, responseTimeMs: Date.now() - started }; } catch { return { status: "error" as const, responseTimeMs: Date.now() - started }; } }

export async function migrationDiagnostic() {
  try { const expected = (await readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length; const rows = await db.$queryRaw<{ applied: bigint; failed: bigint }[]>`SELECT COUNT(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS applied, COUNT(*) FILTER (WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL) AS failed FROM "_prisma_migrations"`; const applied = Number(rows[0]?.applied ?? 0); const failed = Number(rows[0]?.failed ?? 0); return { status: failed === 0 && applied >= expected ? "ok" as const : "error" as const, applied, expected, failed }; }
  catch { return { status: "unknown" as const, applied: null, expected: null, failed: null }; }
}

export async function ftsDiagnostic() {
  try {
    const rows = await db.$queryRaw<{ vectorColumns: bigint; ginIndexes: bigint; indexedPages: bigint }[]>`
      SELECT
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'searchVector' AND table_name IN ('Page', 'Section', 'Notebook')) AS "vectorColumns",
        (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('Page_searchVector_idx', 'Section_searchVector_idx', 'Notebook_searchVector_idx')) AS "ginIndexes",
        (SELECT COUNT(*) FROM "Page" WHERE "searchVector" IS NOT NULL) AS "indexedPages"
    `;
    const vectorColumns = Number(rows[0]?.vectorColumns ?? 0); const ginIndexes = Number(rows[0]?.ginIndexes ?? 0);
    return { status: vectorColumns === 3 && ginIndexes === 3 ? "ok" as const : "error" as const, vectorColumns, ginIndexes, indexedPages: Number(rows[0]?.indexedPages ?? 0) };
  } catch { return { status: "error" as const, vectorColumns: 0, ginIndexes: 0, indexedPages: 0 }; }
}

export async function storageDiagnostics() { const [uploads, backups, temporary] = await Promise.all([writableStorage(uploadRoot()), writableStorage(backupRoot()), writableStorage(tmpdir())]); return { uploads, backups, temporary }; }

export async function readinessDiagnostic() { const [database, storage, migrations, fts] = await Promise.all([databaseDiagnostic(), storageDiagnostics(), migrationDiagnostic(), ftsDiagnostic()]); const ready = database.status === "ok" && storage.uploads.status === "ok" && storage.backups.status === "ok" && storage.temporary.status === "ok" && migrations.status !== "error" && fts.status === "ok"; return { ready, database, storage, migrations, fts }; }
