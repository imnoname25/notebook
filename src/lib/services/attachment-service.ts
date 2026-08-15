import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { attachmentIdsInContent } from "@/lib/portable-content";
import { resolveStoragePath, uploadRoot } from "@/lib/storage";
import { createNotification, resolveNotification } from "@/lib/services/system-notification-service";

async function usedUploadIds(userId: string) {
  const pages = await db.page.findMany({ where: { section: { notebook: { userId } } }, select: { content: true, versions: { select: { content: true } } } }); const used = new Set<string>();
  for (const page of pages) { attachmentIdsInContent(page.content).forEach((id) => used.add(id)); for (const version of page.versions) attachmentIdsInContent(version.content).forEach((id) => used.add(id)); }
  return used;
}

export async function listAttachments(userId: string, limit: number, cursor?: string) {
  if (cursor && !(await db.upload.findFirst({ where: { id: cursor, userId }, select: { id: true } }))) throw new ApiError(404, "Курсор не найден");
  const [uploads, used] = await Promise.all([db.upload.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { page: { select: { id: true, title: true, deletedAt: true, section: { select: { id: true, title: true, notebook: { select: { id: true, title: true } } } } } } } }), usedUploadIds(userId)]);
  return { attachments: uploads.slice(0, limit).map((upload) => ({ ...upload, used: used.has(upload.id) })), nextCursor: uploads.length > limit ? uploads[limit - 1]?.id ?? null : null };
}

async function diskFiles(root: string, relative = ""): Promise<{ relative: string; size: number }[]> {
  const current = path.join(root, relative); const entries = await readdir(current, { withFileTypes: true }).catch(() => []); const files: { relative: string; size: number }[] = [];
  for (const entry of entries) { if (entry.name === ".safety-backups" || entry.name.startsWith(".cleanup-")) continue; const next = path.join(relative, entry.name); if (entry.isDirectory()) files.push(...await diskFiles(root, next)); else if (entry.isFile()) files.push({ relative: next.replace(/\\/g, "/"), size: (await stat(path.join(root, next))).size }); }
  return files;
}

export type StorageAudit = { missingFiles: { id: string; name: string }[]; orphanFiles: { storageName: string; size: number }[]; unusedAttachments: { id: string; name: string; size: number; storageName: string; exists: boolean }[]; reclaimableBytes: number };
export async function auditStorage(userId: string): Promise<StorageAudit> {
  const [uploads, used, files] = await Promise.all([db.upload.findMany({ where: { userId } }), usedUploadIds(userId), diskFiles(path.join(uploadRoot(), userId))]);
  const disk = new Map(files.map((file) => [`${userId}/${file.relative}`, file.size])); const metadata = new Set(uploads.map((upload) => upload.storageName));
  const missingFiles = uploads.filter((upload) => !disk.has(upload.storageName)).map((upload) => ({ id: upload.id, name: upload.originalName }));
  const orphanFiles = [...disk].filter(([storageName]) => !metadata.has(storageName)).map(([storageName, size]) => ({ storageName, size }));
  const unusedAttachments = uploads.filter((upload) => !used.has(upload.id)).map((upload) => ({ id: upload.id, name: upload.originalName, size: upload.size, storageName: upload.storageName, exists: disk.has(upload.storageName) }));
  if (missingFiles.length) await createNotification({ type: "storage_audit_failed", severity: "error", title: "Вложения отсутствуют на диске", message: `Storage audit обнаружил отсутствующие файлы: ${missingFiles.length}.`, dedupKey: "storage:audit:critical" }); else await resolveNotification("storage:audit:critical");
  return { missingFiles, orphanFiles, unusedAttachments, reclaimableBytes: orphanFiles.reduce((sum, file) => sum + file.size, 0) + unusedAttachments.filter((item) => item.exists).reduce((sum, item) => sum + item.size, 0) };
}

export async function cleanupStorage(userId: string) {
  const audit = await auditStorage(userId); const quarantine = path.join(uploadRoot(), `.cleanup-${randomUUID()}`); await mkdir(quarantine, { recursive: true }); const moved: { from: string; to: string }[] = [];
  try {
    for (const item of audit.unusedAttachments.filter((entry) => entry.exists).map((entry) => ({ storageName: entry.storageName })).concat(audit.orphanFiles)) { const from = resolveStoragePath(item.storageName); const to = path.join(quarantine, randomUUID()); await rename(from, to); moved.push({ from, to }); }
    await db.upload.deleteMany({ where: { userId, id: { in: audit.unusedAttachments.map((item) => item.id) } } }); await rm(quarantine, { recursive: true, force: true }); return { removed: audit.unusedAttachments.length + audit.orphanFiles.length, reclaimedBytes: audit.reclaimableBytes };
  } catch (error) { for (const item of moved.reverse()) await rename(item.to, item.from).catch(() => undefined); await rm(quarantine, { recursive: true, force: true }); throw error; }
}

export async function deleteUnusedAttachment(userId: string, id: string) {
  const used = await usedUploadIds(userId); if (used.has(id)) throw new ApiError(409, "Вложение используется страницей или историей версий"); const upload = await db.upload.findFirst({ where: { id, userId } }); if (!upload) throw new ApiError(404, "Вложение не найдено");
  const source = resolveStoragePath(upload.storageName); const quarantine = path.join(uploadRoot(), `.cleanup-${randomUUID()}`); const exists = Boolean(await stat(source).catch(() => null));
  if (exists) { await mkdir(quarantine, { recursive: true }); await rename(source, path.join(quarantine, "attachment")); }
  try { await db.upload.delete({ where: { id } }); await rm(quarantine, { recursive: true, force: true }); }
  catch (error) { if (exists) await rename(path.join(quarantine, "attachment"), source).catch(() => undefined); await rm(quarantine, { recursive: true, force: true }); throw error; }
}

export async function storageStats(userId: string) {
  const [notebooks, pages, versions, attachments, aggregate, audit] = await Promise.all([db.notebook.count({ where: { userId } }), db.page.count({ where: { section: { notebook: { userId } } } }), db.pageVersion.count({ where: { page: { section: { notebook: { userId } } } } }), db.upload.count({ where: { userId } }), db.upload.aggregate({ where: { userId }, _sum: { size: true } }), auditStorage(userId)]);
  return { notebooks, pages, versions, attachments, attachmentBytes: aggregate._sum.size ?? 0, unusedAttachments: audit.unusedAttachments.length, unusedBytes: audit.reclaimableBytes };
}
