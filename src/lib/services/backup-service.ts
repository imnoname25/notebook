import { mkdir, rm, stat } from "node:fs/promises";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { backupFilename, backupRoot, resolveBackupPath } from "@/lib/backup-storage";
import { writePortableArchive } from "@/lib/services/export-service";
import { getApplicationSettings } from "@/lib/services/settings-service";
import { sha256File } from "@/lib/storage";
import { configuredRemoteTargets, enforceRemoteRetention, retryRemoteCopy, uploadToRemoteTargets } from "@/lib/services/remote-backup-service";
import { createNotification, resolveNotification } from "@/lib/services/system-notification-service";

export type BackupType = "manual" | "scheduled" | "safety";
type SerializableRecord = { id: string; type: string; status: string; filename: string | null; size: bigint | null; sha256: string | null; remoteStatus: string; remoteEtag: string | null; errorCategory: string | null; createdAt: Date; completedAt: Date | null; remoteCopies?: { id: string; provider: string; status: string; remoteKey: string; etag: string | null; versionId: string | null; size: bigint | null; sha256: string | null; errorCategory: string | null; uploadedAt: Date | null }[] };

function errorCategory(error: unknown) { if (error instanceof ApiError) return `api_${error.status}`; if (error instanceof Error && ["ENOSPC", "EACCES", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")) return (error as NodeJS.ErrnoException).code!.toLowerCase(); return "backup_failed"; }
export function serializeBackup(record: SerializableRecord) { const webdav = record.remoteCopies?.find((copy) => copy.provider === "webdav"); return { ...record, size: record.size === null ? null : Number(record.size), remoteStatus: webdav?.status ?? record.remoteStatus, remoteEtag: webdav?.etag ?? record.remoteEtag, errorCategory: webdav?.errorCategory ?? record.errorCategory, remoteCopies: (record.remoteCopies ?? []).map((copy) => ({ ...copy, size: copy.size === null ? null : Number(copy.size) })) }; }

export async function enforceBackupRetention(now = new Date()) {
  const settings = await getApplicationSettings(); const records = await db.backupRecord.findMany({ where: { status: "success", filename: { not: null } }, orderBy: { createdAt: "desc" }, include: { remoteCopies: true } }); const cutoff = now.getTime() - settings.backupRetentionDays * 86_400_000;
  const remove = records.filter((record, index) => index >= settings.backupRetentionCount || record.createdAt.getTime() < cutoff);
  for (const record of remove) {
    if (record.filename) await rm(resolveBackupPath(record.filename), { force: true });
    if (record.remoteCopies.length) await db.backupRecord.update({ where: { id: record.id }, data: { filename: null } });
    else await db.backupRecord.delete({ where: { id: record.id } });
  }
  return remove.length;
}

export async function createOperationalBackup(userId: string, type: BackupType, now = new Date()) {
  const record = await db.backupRecord.create({ data: { type, status: "running", remoteStatus: "not_configured", createdAt: now } }); const filename = backupFilename(now, record.id.slice(-6)); const target = resolveBackupPath(filename); await mkdir(backupRoot(), { recursive: true });
  try {
    await writePortableArchive(userId, target, { includeDeleted: true, includeHistory: true, backup: true }); const info = await stat(target); const sha256 = await sha256File(target);
    await db.backupRecord.update({ where: { id: record.id }, data: { status: "success", filename, size: BigInt(info.size), sha256, completedAt: new Date() } });
    try { await uploadToRemoteTargets({ id: record.id, filename, size: BigInt(info.size), sha256 }); }
    catch { await createNotification({ type: "backup_remote_failed", severity: "warning", title: "Remote backup не настроен или недоступен", message: "Локальная резервная копия сохранена. Проверьте secret key и настройки remote providers.", dedupKey: "backup:remote:configuration" }); }
    await db.applicationSettings.update({ where: { id: "singleton" }, data: { backupConsecutiveFailures: 0, ...(type === "scheduled" ? { lastScheduledBackupAt: now } : {}) } });
    await resolveNotification("backup:local:failure"); await resolveNotification("backup:local:consecutive");
    await enforceBackupRetention(now); await enforceRemoteRetention(now).catch(() => undefined);
    console.info("Notebook backup completed", { type, size: info.size });
    return db.backupRecord.findUniqueOrThrow({ where: { id: record.id }, include: { remoteCopies: true } });
  } catch (error) {
    await rm(target, { force: true }); await db.backupRecord.update({ where: { id: record.id }, data: { status: "failed", errorCategory: errorCategory(error), completedAt: new Date() } });
    const settings = await db.applicationSettings.update({ where: { id: "singleton" }, data: { backupConsecutiveFailures: { increment: 1 }, ...(type === "scheduled" ? { lastScheduledBackupAt: now } : {}) } });
    if (type === "scheduled") {
      await createNotification({ type: "backup_failed", severity: "error", title: "Плановая резервная копия не создана", message: "Проверьте свободное место и системную диагностику.", dedupKey: "backup:local:failure" });
      if (settings.backupConsecutiveFailures >= 3) await createNotification({ type: "backup_repeated_failure", severity: "error", title: "Три резервные копии подряд завершились ошибкой", message: "Резервное копирование требует внимания.", dedupKey: "backup:local:consecutive" });
    }
    console.error("Notebook backup failed", { type, category: errorCategory(error) }); throw error;
  }
}

export async function retryBackupWebdav(id: string) { return retryRemoteCopy(id, "webdav"); }
export async function retryBackupRemote(id: string, provider: "webdav" | "s3") { return retryRemoteCopy(id, provider); }

export async function deleteBackup(id: string) {
  const record = await db.backupRecord.findUnique({ where: { id }, include: { remoteCopies: true } }); if (!record) throw new ApiError(404, "Backup не найден"); if (record.status === "running") throw new ApiError(409, "Backup ещё выполняется");
  const targets = await configuredRemoteTargets();
  for (const copy of record.remoteCopies.filter((item) => item.status === "success")) { const target = targets.find((item) => item.provider === copy.provider); if (!target) throw new ApiError(409, `Сначала включите ${copy.provider}, чтобы безопасно удалить remote copy`); if (!target.ownsKey(copy.remoteKey)) throw new ApiError(409, "Remote key не принадлежит Notebook"); await target.delete(copy.remoteKey); }
  if (record.filename) await rm(resolveBackupPath(record.filename), { force: true }); await db.backupRecord.delete({ where: { id } });
}
export async function listBackups(limit: number, cursor?: string) { if (cursor && !(await db.backupRecord.findUnique({ where: { id: cursor } }))) throw new ApiError(404, "Курсор backup не найден"); const records = await db.backupRecord.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { remoteCopies: true } }); return { backups: records.slice(0, limit).map(serializeBackup), nextCursor: records.length > limit ? records[limit - 1]?.id ?? null : null }; }
export async function backupRecordFile(id: string) { const record = await db.backupRecord.findFirst({ where: { id, status: "success", filename: { not: null } } }); if (!record?.filename) throw new ApiError(404, "Локальная копия backup отсутствует"); const filePath = resolveBackupPath(record.filename); const info = await stat(filePath).catch(() => null); if (!info?.isFile() || (record.size !== null && BigInt(info.size) !== record.size)) throw new ApiError(409, "Файл backup отсутствует или повреждён"); if (record.sha256 && await sha256File(filePath) !== record.sha256) throw new ApiError(409, "SHA-256 backup не совпадает"); return { record, filePath }; }
