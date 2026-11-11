import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { resolveStoragePath } from "@/lib/storage";
import { ATTACHMENT_EXTENSIONS, IMAGE_EXTENSIONS, isValidAttachmentMime, maxUploadBytes } from "@/lib/uploads";

export async function prepareUpload(file: File, allowPdf = false) {
  if (file.size <= 0 || file.size > maxUploadBytes()) throw new ApiError(413, "Недопустимый размер файла");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extensions = allowPdf ? ATTACHMENT_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!Object.hasOwn(extensions, file.type) || !isValidAttachmentMime(file.type, bytes)) {
    throw new ApiError(415, allowPdf ? "Поддерживаются JPEG, PNG, GIF, WebP, AVIF и PDF" : "Поддерживаются JPEG, PNG, GIF, WebP и AVIF");
  }
  return {
    bytes, extension: extensions[file.type], mimeType: file.type,
    originalName: file.name.replaceAll("\0", "").slice(0, 255),
    size: file.size, sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export type PreparedUpload = Awaited<ReturnType<typeof prepareUpload>>;

// Coordinate filesystem changes with cleanup and legacy restore across connections.
export async function lockUserUploads(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notebook:uploads:${userId}`}, 0))`);
}

export async function withUploadWrites<T>(userId: string, write: (
  tx: Prisma.TransactionClient,
  store: (file: PreparedUpload, pageId?: string) => Promise<{ id: string }>,
) => Promise<T>) {
  const written: string[] = [];
  try {
    return await db.$transaction(async (tx) => {
      await lockUserUploads(tx, userId);
      return write(tx, async ({ bytes, extension, ...metadata }, pageId) => {
        const storageName = `${userId}/${randomUUID()}.${extension}`;
        const target = resolveStoragePath(storageName);
        await mkdir(path.dirname(target), { recursive: true });
        written.push(storageName);
        await writeFile(target, bytes, { flag: "wx", flush: true });
        return tx.upload.create({ data: { ...metadata, userId, pageId, storageName }, select: { id: true } });
      });
    }, { timeout: 30_000 });
  } catch (error) {
    // A lost commit response can leave valid metadata. Leave files for audit if
    // the database cannot confirm the rollback.
    if (written.length) {
      await db.$transaction(async tx => {
        await lockUserUploads(tx, userId);
        const committed = await tx.upload.findMany({ where: { storageName: { in: written } }, select: { storageName: true } });
        const retained = new Set(committed.map(file => file.storageName));
        await Promise.allSettled(written.filter(name => !retained.has(name))
          .map(name => rm(resolveStoragePath(name), { force: true })));
      }).catch(() => undefined);
    }
    throw error;
  }
}
