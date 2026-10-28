import { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";

/** Serialize content writers without blocking PageLink foreign-key KEY SHARE locks. */
export async function lockOwnedPage(tx: Prisma.TransactionClient, userId: string, pageId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM "Page" p JOIN "Section" s ON s.id = p."sectionId"
    JOIN "Notebook" n ON n.id = s."notebookId"
    WHERE p.id = ${pageId} AND n."userId" = ${userId}
      AND p."deletedAt" IS NULL AND s."deletedAt" IS NULL AND n."deletedAt" IS NULL
    FOR NO KEY UPDATE OF p`);
  if (!rows.length) throw new ApiError(404, "Страница не найдена");
}
