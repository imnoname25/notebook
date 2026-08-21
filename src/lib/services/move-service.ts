import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { descendantSectionIds } from "@/lib/services/trash-service";

async function normalizePages(tx: Prisma.TransactionClient, sectionId: string) {
  const pages = await tx.page.findMany({
    where: { sectionId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  await Promise.all(
    pages.map((page, sortOrder) =>
      tx.page.update({ where: { id: page.id }, data: { sortOrder } }),
    ),
  );
}

async function normalizeSections(
  tx: Prisma.TransactionClient,
  notebookId: string,
  parentId: string | null,
) {
  const sections = await tx.section.findMany({
    where: { notebookId, parentId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  await Promise.all(
    sections.map((section, sortOrder) =>
      tx.section.update({ where: { id: section.id }, data: { sortOrder } }),
    ),
  );
}

export async function movePage(
  userId: string,
  pageId: string,
  destinationSectionId: string,
) {
  return db.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: {
        id: pageId,
        deletedAt: null,
        section: { deletedAt: null, notebook: { userId, deletedAt: null } },
      },
      select: { id: true, sectionId: true },
    });
    const destination = await tx.section.findFirst({
      where: {
        id: destinationSectionId,
        deletedAt: null,
        notebook: { userId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!page) throw new ApiError(404, "Страница не найдена");
    if (!destination) throw new ApiError(404, "Раздел назначения не найден");
    if (page.sectionId === destination.id)
      return tx.page.findUniqueOrThrow({ where: { id: page.id } });
    const max = await tx.page.aggregate({
      where: { sectionId: destination.id, deletedAt: null },
      _max: { sortOrder: true },
    });
    const moved = await tx.page.update({
      where: { id: page.id },
      data: {
        sectionId: destination.id,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await normalizePages(tx, page.sectionId);
    await normalizePages(tx, destination.id);
    return moved;
  });
}

export async function moveSection(
  userId: string,
  sectionId: string,
  destinationNotebookId: string,
) {
  return db.$transaction(async (tx) => {
    const section = await tx.section.findFirst({
      where: {
        id: sectionId,
        deletedAt: null,
        notebook: { userId, deletedAt: null },
      },
      select: { id: true, notebookId: true, parentId: true },
    });
    const destination = await tx.notebook.findFirst({
      where: { id: destinationNotebookId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!section) throw new ApiError(404, "Раздел не найден");
    if (!destination) throw new ApiError(404, "Блокнот назначения не найден");
    if (section.notebookId === destination.id)
      return tx.section.findUniqueOrThrow({ where: { id: section.id } });
    const sourceSections = await tx.section.findMany({
      where: { notebookId: section.notebookId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const subtreeIds = descendantSectionIds(sourceSections, section.id);
    const max = await tx.section.aggregate({
      where: { notebookId: destination.id, parentId: null, deletedAt: null },
      _max: { sortOrder: true },
    });
    await tx.section.updateMany({
      where: { id: { in: subtreeIds } },
      data: { notebookId: destination.id },
    });
    const moved = await tx.section.update({
      where: { id: section.id },
      data: { parentId: null, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    await normalizeSections(tx, section.notebookId, section.parentId);
    await normalizeSections(tx, destination.id, null);
    return moved;
  });
}

export async function duplicatePage(userId: string, pageId: string) {
  return db.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: {
        id: pageId,
        deletedAt: null,
        section: { deletedAt: null, notebook: { userId, deletedAt: null } },
      },
    });
    if (!page) throw new ApiError(404, "Страница не найдена");
    await tx.page.updateMany({
      where: {
        sectionId: page.sectionId,
        deletedAt: null,
        sortOrder: { gt: page.sortOrder },
      },
      data: { sortOrder: { increment: 1 } },
    });
    return tx.page.create({
      data: {
        sectionId: page.sectionId,
        title: `${page.title} — копия`,
        icon: page.icon,
        color: page.color,
        backgroundType: page.backgroundType,
        backgroundColor: page.backgroundColor,
        backgroundGradient: page.backgroundGradient,
        backgroundPattern: page.backgroundPattern,
        backgroundPosition: page.backgroundPosition,
        backgroundOverlay: page.backgroundOverlay,
        appearancePreset: page.appearancePreset,
        content: page.content as Prisma.InputJsonValue,
        searchText: page.searchText,
        sortOrder: page.sortOrder + 1,
      },
    });
  });
}
