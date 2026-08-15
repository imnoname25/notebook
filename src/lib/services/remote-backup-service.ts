import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import type { BackupRemoteTarget, RemoteProvider } from "@/lib/remote-backup";
import { S3BackupTarget } from "@/lib/s3-backup";
import { decryptSettingSecret } from "@/lib/settings-encryption";
import { getApplicationSettings } from "@/lib/services/settings-service";
import { WebdavBackupTarget } from "@/lib/webdav";
import { createNotification, resolveNotification } from "@/lib/services/system-notification-service";

export function remoteErrorCategory(provider: RemoteProvider, error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("credential") || message.includes("unauthorized")) return `${provider}_unauthorized`;
  if (message.includes("forbidden")) return `${provider}_forbidden`;
  if (message.includes("timeout")) return `${provider}_timeout`;
  if (message.includes("bucket")) return `${provider}_bucket`;
  return `${provider}_failed`;
}

export async function configuredRemoteTargets(): Promise<BackupRemoteTarget[]> {
  const settings = await getApplicationSettings(); const targets: BackupRemoteTarget[] = [];
  if (settings.webdavEnabled && settings.webdavUrl) targets.push(new WebdavBackupTarget({ url: settings.webdavUrl, username: settings.webdavUsername, password: settings.webdavPasswordEncrypted ? decryptSettingSecret(settings.webdavPasswordEncrypted) : null, remoteDirectory: settings.webdavRemoteDirectory }));
  if (settings.s3Enabled && settings.s3Bucket && settings.s3AccessKeyId && settings.s3SecretAccessKeyEncrypted) targets.push(new S3BackupTarget({ endpoint: settings.s3Endpoint, region: settings.s3Region, bucket: settings.s3Bucket, accessKeyId: settings.s3AccessKeyId, secretAccessKey: decryptSettingSecret(settings.s3SecretAccessKeyEncrypted), prefix: settings.s3Prefix, forcePathStyle: settings.s3ForcePathStyle }));
  return targets;
}

export async function uploadToRemoteTargets(record: { id: string; filename: string; size: bigint; sha256: string }, targets?: BackupRemoteTarget[]) {
  const effectiveTargets = targets ?? await configuredRemoteTargets();
  await Promise.all(effectiveTargets.map(async (target) => {
    await db.backupRemoteCopy.upsert({ where: { backupRecordId_provider: { backupRecordId: record.id, provider: target.provider } }, create: { backupRecordId: record.id, provider: target.provider, status: "uploading", remoteKey: record.filename, size: record.size, sha256: record.sha256 }, update: { status: "uploading", errorCategory: null, lastAttemptAt: new Date() } });
    try {
      const uploaded = await target.upload({ filename: record.filename, filePath: (await import("@/lib/backup-storage")).resolveBackupPath(record.filename), size: record.size, sha256: record.sha256 });
      await db.backupRemoteCopy.update({ where: { backupRecordId_provider: { backupRecordId: record.id, provider: target.provider } }, data: { status: "success", remoteKey: uploaded.remoteKey, etag: uploaded.etag, versionId: uploaded.versionId, uploadedAt: new Date(), errorCategory: null } });
      await resolveNotification(`backup:${target.provider}:failure`).catch(() => undefined);
    } catch (error) {
      const category = remoteErrorCategory(target.provider, error); await db.backupRemoteCopy.update({ where: { backupRecordId_provider: { backupRecordId: record.id, provider: target.provider } }, data: { status: "failed", errorCategory: category } });
      await createNotification({ type: "backup_remote_failed", severity: "warning", title: `${target.provider === "s3" ? "S3" : "WebDAV"} upload не выполнен`, message: "Локальная резервная копия сохранена. Проверьте подключение и повторите загрузку.", dedupKey: `backup:${target.provider}:failure` }).catch(() => undefined);
    }
  }));
}

export async function retryRemoteCopy(backupRecordId: string, provider: RemoteProvider) {
  const record = await db.backupRecord.findFirst({ where: { id: backupRecordId, status: "success", filename: { not: null }, size: { not: null }, sha256: { not: null } } });
  if (!record?.filename || record.size === null || !record.sha256) throw new ApiError(409, "Для retry нужна локальная копия backup");
  const target = (await configuredRemoteTargets()).find((item) => item.provider === provider); if (!target) throw new ApiError(409, `${provider} не настроен`);
  await uploadToRemoteTargets({ id: record.id, filename: record.filename, size: record.size, sha256: record.sha256 }, [target]);
  return db.backupRecord.findUniqueOrThrow({ where: { id: record.id }, include: { remoteCopies: true } });
}

export async function enforceRemoteRetention(now = new Date(), targets?: BackupRemoteTarget[]) {
  const effectiveTargets = targets ?? await configuredRemoteTargets();
  const settings = await getApplicationSettings(); const cutoff = now.getTime() - settings.remoteRetentionDays * 86_400_000; let removed = 0;
  for (const target of effectiveTargets) {
    const copies = await db.backupRemoteCopy.findMany({ where: { provider: target.provider, status: "success", uploadedAt: { not: null } }, orderBy: { uploadedAt: "desc" } });
    for (const [index, copy] of copies.entries()) {
      if (index < settings.remoteRetentionCount && (copy.uploadedAt?.getTime() ?? now.getTime()) >= cutoff) continue;
      if (!target.ownsKey(copy.remoteKey)) continue;
      try { await target.delete(copy.remoteKey); await db.backupRemoteCopy.delete({ where: { id: copy.id } }); removed++; } catch { await db.backupRemoteCopy.update({ where: { id: copy.id }, data: { status: "failed", errorCategory: `${target.provider}_retention_failed` } }); }
    }
  }
  return removed;
}

export async function remoteTarget(provider: RemoteProvider) { const target = (await configuredRemoteTargets()).find((item) => item.provider === provider); if (!target) throw new ApiError(409, `${provider} не настроен`); return target; }
