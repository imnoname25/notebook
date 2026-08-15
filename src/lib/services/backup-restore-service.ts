import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { maxImportArchiveBytes } from "@/lib/data-limits";
import { ApiError } from "@/lib/errors";
import type { RemoteProvider } from "@/lib/remote-backup";
import { backupRecordFile } from "@/lib/services/backup-service";
import { disposePreparedImport, prepareImport, restoreBackupData, type PreparedImport } from "@/lib/services/import-service";
import { writePortableArchive } from "@/lib/services/export-service";
import { remoteTarget } from "@/lib/services/remote-backup-service";
import { createNotification } from "@/lib/services/system-notification-service";
import { sha256File, uploadRoot } from "@/lib/storage";

type NodeRequestInit = RequestInit & { duplex: "half" };
function importRequest(filePath: string, size: bigint) { const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream; return new Request("http://notebook.local/restore", { method: "POST", headers: { "content-type": "application/zip", "content-length": size.toString() }, body, duplex: "half" } as NodeRequestInit); }
async function downloadWithRetry(target: Awaited<ReturnType<typeof remoteTarget>>, remoteKey: string, filePath: string) { let lastError: unknown; for (let attempt = 0; attempt < 2; attempt++) { try { return await target.download(remoteKey, filePath, BigInt(maxImportArchiveBytes())); } catch (error) { lastError = error; await rm(filePath, { force: true }); if (!(error instanceof ApiError) || error.status !== 502 || attempt === 1) throw error; } } throw lastError; }

async function restorePrepared(userId: string, prepared: PreparedImport, source: string) {
  const safetyDirectory = path.join(uploadRoot(), ".safety-backups"); await mkdir(safetyDirectory, { recursive: true }); const safetyName = `before-${source}-restore-${randomUUID()}.zip`; const safetyPath = path.join(safetyDirectory, safetyName); let safetyCreated = false;
  try {
    await writePortableArchive(userId, safetyPath, { includeDeleted: true, includeHistory: true, backup: true }); safetyCreated = true; await restoreBackupData(userId, prepared); await rm(safetyPath, { force: true });
    await createNotification({ type: "restore_succeeded", severity: "success", title: "Восстановление завершено", message: `Данные восстановлены из ${source}.` }); return { ok: true as const };
  } catch {
    await createNotification({ type: "restore_failed", severity: "error", title: "Восстановление не завершено", message: safetyCreated ? "Safety backup сохранён. Текущие данные требуют проверки." : "Архив не был применён.", dedupKey: "restore:failure" });
    if (!safetyCreated) { await rm(safetyPath, { force: true }); throw new ApiError(500, "Restore не запускался: safety backup не создан"); }
    throw new ApiError(500, `Restore не завершён. Safety backup сохранён: ${safetyName}`);
  }
}

export async function restoreRecordedBackup(userId: string, backupId: string) {
  const { record, filePath } = await backupRecordFile(backupId); const prepared = await prepareImport(importRequest(filePath, record.size ?? BigInt((await stat(filePath)).size)), "backup");
  try { return await restorePrepared(userId, prepared, "local backup"); } finally { await disposePreparedImport(prepared); }
}

export async function restoreRemoteBackup(userId: string, backupId: string, provider: RemoteProvider) {
  const copy = await db.backupRemoteCopy.findFirst({ where: { backupRecordId: backupId, provider, status: "success" }, include: { backupRecord: true } });
  if (!copy) throw new ApiError(404, "Remote backup не найден"); const target = await remoteTarget(provider); if (!target.ownsKey(copy.remoteKey)) throw new ApiError(409, "Remote key не принадлежит Notebook");
  const directory = await mkdtemp(path.join(tmpdir(), "notebook-remote-restore-")); const filePath = path.join(directory, "backup.zip");
  try {
    const downloaded = await downloadWithRetry(target, copy.remoteKey, filePath); const info = await stat(filePath); if (!info.isFile() || BigInt(info.size) !== downloaded.size) throw new ApiError(409, "Remote backup загружен не полностью");
    const expectedHash = copy.sha256 ?? copy.backupRecord.sha256; if (expectedHash && await sha256File(filePath) !== expectedHash) throw new ApiError(409, "SHA-256 remote backup не совпадает");
    const prepared = await prepareImport(importRequest(filePath, BigInt(info.size)), "backup");
    try { return await restorePrepared(userId, prepared, provider.toUpperCase()); } finally { await disposePreparedImport(prepared); }
  } catch (error) {
    await createNotification({ type: "restore_failed", severity: "error", title: "Remote backup не восстановлен", message: "Архив не прошёл загрузку или проверку целостности. Текущие данные не изменены.", dedupKey: `restore:${provider}:failure` }); throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
