import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { attachmentIdsInContent } from "@/lib/portable-content";
import { resolveStoragePath, uploadRoot } from "@/lib/storage";
import { lockUserUploads } from "./upload-service";
import {
  createNotification,
  resolveNotification,
} from "@/lib/services/system-notification-service";

async function usedUploadIds(userId: string, tx: Prisma.TransactionClient = db) {
  const [pages, saved, notebooks, articleImages] = await Promise.all([tx.page.findMany({
    where: { section: { notebook: { userId } } },
    select: {
      content: true,
      coverUploadId: true,
      backgroundUploadId: true,
      versions: { select: { content: true } },
    },
  }), tx.savedItemAttachment.findMany({
    where: { savedItem: { userId }, upload: { userId } }, select: { uploadId: true },
  }), tx.notebook.findMany({
    where: { userId, coverUploadId: { not: null } }, select: { coverUploadId: true },
  }), tx.savedArticleImage.findMany({
    where: { article: { savedItem: { userId } }, upload: { userId } }, select: { uploadId: true },
  })]);
  const used = new Set(saved.map(({ uploadId }) => uploadId));
  for (const { uploadId } of articleImages) if (uploadId) used.add(uploadId);
  for (const { coverUploadId } of notebooks) if (coverUploadId) used.add(coverUploadId);
  for (const page of pages) {
    if (page.coverUploadId) used.add(page.coverUploadId);
    if (page.backgroundUploadId) used.add(page.backgroundUploadId);
    attachmentIdsInContent(page.content).forEach((id) => used.add(id));
    for (const version of page.versions)
      attachmentIdsInContent(version.content).forEach((id) => used.add(id));
  }
  return used;
}

export async function listAttachments(
  userId: string,
  limit: number,
  cursor?: string,
) {
  if (
    cursor &&
    !(await db.upload.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    }))
  )
    throw new ApiError(404, "Курсор не найден");
  const [uploads, used] = await Promise.all([
    db.upload.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        page: {
          select: {
            id: true,
            title: true,
            deletedAt: true,
            section: {
              select: {
                id: true,
                title: true,
                notebook: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    }),
    usedUploadIds(userId),
  ]);
  return {
    attachments: uploads
      .slice(0, limit)
      .map((upload) => ({ ...upload, used: used.has(upload.id) })),
    nextCursor:
      uploads.length > limit ? (uploads[limit - 1]?.id ?? null) : null,
  };
}

async function diskFiles(
  root: string,
  relative = "",
): Promise<{ relative: string; size: number }[]> {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true }).catch(
    () => [],
  );
  const files: { relative: string; size: number }[] = [];
  for (const entry of entries) {
    if (entry.name === ".safety-backups" || entry.name.startsWith(".cleanup-"))
      continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await diskFiles(root, next)));
    else if (entry.isFile())
      files.push({
        relative: next.replace(/\\/g, "/"),
        size: (await stat(path.join(root, next))).size,
      });
  }
  return files;
}

export type StorageAudit = {
  missingFiles: { id: string; name: string }[];
  orphanFiles: { storageName: string; size: number }[];
  unusedAttachments: {
    id: string;
    name: string;
    size: number;
    storageName: string;
    exists: boolean;
  }[];
  reclaimableBytes: number;
};
async function inspectStorage(userId: string, tx: Prisma.TransactionClient): Promise<StorageAudit> {
  const [uploads, used, files] = await Promise.all([
    tx.upload.findMany({ where: { userId } }),
    usedUploadIds(userId, tx),
    diskFiles(path.join(uploadRoot(), userId)),
  ]);
  const disk = new Map(
    files.map((file) => [`${userId}/${file.relative}`, file.size]),
  );
  const metadata = new Set(uploads.map((upload) => upload.storageName));
  const missingFiles = uploads
    .filter((upload) => !disk.has(upload.storageName))
    .map((upload) => ({ id: upload.id, name: upload.originalName }));
  const orphanFiles = [...disk]
    .filter(([storageName]) => !metadata.has(storageName))
    .map(([storageName, size]) => ({ storageName, size }));
  const unusedAttachments = uploads
    .filter((upload) => !used.has(upload.id))
    .map((upload) => ({
      id: upload.id,
      name: upload.originalName,
      size: upload.size,
      storageName: upload.storageName,
      exists: disk.has(upload.storageName),
    }));
  return {
    missingFiles,
    orphanFiles,
    unusedAttachments,
    reclaimableBytes:
      orphanFiles.reduce((sum, file) => sum + file.size, 0) +
      unusedAttachments.filter((item) => item.exists).reduce((sum, item) => sum + item.size, 0),
  };
}

async function reportStorageAudit({ missingFiles }: StorageAudit) {
  if (missingFiles.length)
    await createNotification({
      type: "storage_audit_failed",
      severity: "error",
      title: "Вложения отсутствуют на диске",
      message: `Storage audit обнаружил отсутствующие файлы: ${missingFiles.length}.`,
      dedupKey: "storage:audit:critical",
    });
  else await resolveNotification("storage:audit:critical");
}

export async function auditStorage(userId: string) {
  const audit = await inspectStorage(userId, db);
  await reportStorageAudit(audit);
  return audit;
}

async function removeUploadFiles<T>(userId: string, remove: (
  tx: Prisma.TransactionClient,
  quarantineFile: (storageName: string) => Promise<void>,
) => Promise<T>) {
  const quarantine = path.join(uploadRoot(), `.cleanup-${randomUUID()}`);
  const moved: { from: string; to: string }[] = [];
  let result: T;
  try {
    result = await db.$transaction(async tx => {
      await lockUserUploads(tx, userId);
      return remove(tx, async storageName => {
        const from = resolveStoragePath(storageName);
        const to = path.join(quarantine, randomUUID());
        await mkdir(quarantine, { recursive: true });
        await rename(from, to);
        moved.push({ from, to });
      });
    }, { timeout: 120_000 });
  } catch (error) {
    const restored = await Promise.allSettled(moved.map(item => rename(item.to, item.from)));
    if (restored.every(item => item.status === "fulfilled")) await rm(quarantine, { recursive: true, force: true });
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true });
  return result;
}

export async function cleanupStorage(userId: string) {
  const audit = await removeUploadFiles(userId, async (tx, quarantineFile) => {
    const current = await inspectStorage(userId, tx);
    const diskFiles = [...current.unusedAttachments.filter(entry => entry.exists), ...current.orphanFiles];
    for (const { storageName } of diskFiles) await quarantineFile(storageName);
    await tx.upload.deleteMany({ where: { userId, id: { in: current.unusedAttachments.map(item => item.id) } } });
    return current;
  });
  await reportStorageAudit(audit);
  return { removed: audit.unusedAttachments.length + audit.orphanFiles.length, reclaimedBytes: audit.reclaimableBytes };
}

export async function deleteUnusedAttachment(userId: string, id: string) {
  await removeUploadFiles(userId, async (tx, quarantineFile) => {
    const upload = await tx.upload.findFirst({ where: { id, userId } });
    if (!upload) throw new ApiError(404, "Вложение не найдено");
    if ((await usedUploadIds(userId, tx)).has(id)) throw new ApiError(409, "Вложение используется");
    if (await stat(resolveStoragePath(upload.storageName)).catch(() => null)) await quarantineFile(upload.storageName);
    await tx.upload.delete({ where: { id } });
  });
}

export async function storageStats(userId: string) {
  const [notebooks, pages, versions, attachments, aggregate, audit] =
    await Promise.all([
      db.notebook.count({ where: { userId } }),
      db.page.count({ where: { section: { notebook: { userId } } } }),
      db.pageVersion.count({
        where: { page: { section: { notebook: { userId } } } },
      }),
      db.upload.count({ where: { userId } }),
      db.upload.aggregate({ where: { userId }, _sum: { size: true } }),
      auditStorage(userId),
    ]);
  return {
    notebooks,
    pages,
    versions,
    attachments,
    attachmentBytes: aggregate._sum.size ?? 0,
    unusedAttachments: audit.unusedAttachments.length,
    unusedBytes: audit.reclaimableBytes,
  };
}
