import { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { db } from "@/lib/db";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { createPageSnapshot } from "@/lib/services/page-version-service";

export type PageSaveInput = {
  title?: string;
  content?: Record<string, unknown>[];
  isFavorite?: boolean;
  icon?: string | null;
  color?: string;
  coverUploadId?: string | null;
  expectedRevision?: number;
  snapshotReason?: "interval" | "manual";
};

export async function savePage(userId: string, pageId: string, input: PageSaveInput) {
  return db.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } },
      select: { id: true, title: true, content: true, searchText: true, revision: true },
    });
    if (!page) throw new ApiError(404, "Страница не найдена");
    if (input.expectedRevision !== undefined && input.expectedRevision !== page.revision) throw new ApiError(409, "Страница была изменена в другой операции");

    const nextTitle = input.title ?? page.title;
    const nextContent = input.content ?? page.content;
    const documentChanged = page.title !== nextTitle || JSON.stringify(page.content) !== JSON.stringify(nextContent);
    if (documentChanged || input.snapshotReason === "manual") await createPageSnapshot(tx, page, input.snapshotReason ?? "interval");

    if (input.coverUploadId) {
      const cover = await tx.upload.findFirst({ where: { id: input.coverUploadId, userId, pageId }, select: { id: true } });
      if (!cover) throw new ApiError(400, "Обложка должна принадлежать этой странице");
    }
    const data: Prisma.PageUpdateInput = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.isFavorite === undefined ? {} : { isFavorite: input.isFavorite }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.coverUploadId === undefined ? {} : { coverUpload: input.coverUploadId ? { connect: { id: input.coverUploadId } } : { disconnect: true } }),
      ...(input.content === undefined ? {} : { content: input.content as Prisma.InputJsonValue, searchText: extractBlockNoteText(input.content) }),
      ...(documentChanged ? { revision: { increment: 1 } } : {}),
    };
    return tx.page.update({ where: { id: pageId }, data });
  });
}
