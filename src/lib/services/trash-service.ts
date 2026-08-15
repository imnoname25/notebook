import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";

export type TrashItemType = "notebook" | "section" | "page";
export type TrashItem = {
  type: TrashItemType;
  id: string;
  title: string;
  deletedAt: Date;
  notebookTitle?: string;
  sectionTitle?: string;
};

export function descendantSectionIds(sections: { id: string; parentId: string | null }[], rootId: string) {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of sections) {
      if (section.parentId && result.has(section.parentId) && !result.has(section.id)) {
        result.add(section.id);
        changed = true;
      }
    }
  }
  return [...result];
}

export async function softDeletePage(userId: string, pageId: string) {
  const page = await db.page.findFirst({ where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } }, select: { id: true } });
  if (!page) throw new ApiError(404, "Страница не найдена");
  await db.page.update({ where: { id: pageId }, data: { deletedAt: new Date(), deletionGroupId: randomUUID(), isDeletionRoot: true } });
}

export async function softDeleteSection(userId: string, sectionId: string) {
  const root = await db.section.findFirst({ where: { id: sectionId, deletedAt: null, notebook: { userId, deletedAt: null } }, select: { id: true, notebookId: true } });
  if (!root) throw new ApiError(404, "Раздел не найден");
  const sections = await db.section.findMany({ where: { notebookId: root.notebookId, deletedAt: null }, select: { id: true, parentId: true } });
  const ids = descendantSectionIds(sections, root.id);
  const deletedAt = new Date();
  const groupId = randomUUID();
  await db.$transaction([
    db.page.updateMany({ where: { sectionId: { in: ids }, deletedAt: null }, data: { deletedAt, deletionGroupId: groupId, isDeletionRoot: false } }),
    db.section.updateMany({ where: { id: { in: ids } }, data: { deletedAt, deletionGroupId: groupId, isDeletionRoot: false } }),
    db.section.update({ where: { id: root.id }, data: { isDeletionRoot: true } }),
  ]);
}

export async function softDeleteNotebook(userId: string, notebookId: string) {
  const notebook = await db.notebook.findFirst({ where: { id: notebookId, userId, deletedAt: null }, select: { id: true } });
  if (!notebook) throw new ApiError(404, "Блокнот не найден");
  const deletedAt = new Date();
  const groupId = randomUUID();
  await db.$transaction([
    db.page.updateMany({ where: { deletedAt: null, section: { notebookId, deletedAt: null } }, data: { deletedAt, deletionGroupId: groupId, isDeletionRoot: false } }),
    db.section.updateMany({ where: { notebookId, deletedAt: null }, data: { deletedAt, deletionGroupId: groupId, isDeletionRoot: false } }),
    db.notebook.update({ where: { id: notebookId }, data: { deletedAt, deletionGroupId: groupId, isDeletionRoot: true } }),
  ]);
}

export async function getTrash(userId: string): Promise<TrashItem[]> {
  const [notebooks, sections, pages] = await Promise.all([
    db.notebook.findMany({ where: { userId, deletedAt: { not: null }, isDeletionRoot: true }, select: { id: true, title: true, deletedAt: true } }),
    db.section.findMany({ where: { notebook: { userId }, deletedAt: { not: null }, isDeletionRoot: true }, select: { id: true, title: true, deletedAt: true, notebook: { select: { title: true } } } }),
    db.page.findMany({ where: { section: { notebook: { userId } }, deletedAt: { not: null }, isDeletionRoot: true }, select: { id: true, title: true, deletedAt: true, section: { select: { title: true, notebook: { select: { title: true } } } } } }),
  ]);
  const items: TrashItem[] = [
    ...notebooks.map((item) => ({ type: "notebook" as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
    ...sections.map((item) => ({ type: "section" as const, id: item.id, title: item.title, deletedAt: item.deletedAt!, notebookTitle: item.notebook.title })),
    ...pages.map((item) => ({ type: "page" as const, id: item.id, title: item.title, deletedAt: item.deletedAt!, notebookTitle: item.section.notebook.title, sectionTitle: item.section.title })),
  ];
  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

async function ensureActiveNotebook(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.notebook.findFirst({ where: { userId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  if (existing) return existing;
  const last = await tx.notebook.aggregate({ where: { userId }, _max: { sortOrder: true } });
  return tx.notebook.create({ data: { userId, title: "Восстановлено", sortOrder: (last._max.sortOrder ?? -1) + 1 } });
}

async function ensureActiveSection(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.section.findFirst({ where: { deletedAt: null, notebook: { userId, deletedAt: null } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  if (existing) return existing;
  const notebook = await ensureActiveNotebook(tx, userId);
  const last = await tx.section.aggregate({ where: { notebookId: notebook.id, parentId: null }, _max: { sortOrder: true } });
  return tx.section.create({ data: { notebookId: notebook.id, title: "Восстановлено", sortOrder: (last._max.sortOrder ?? -1) + 1 } });
}

export async function restoreTrashItem(userId: string, type: TrashItemType, id: string) {
  await db.$transaction(async (tx) => {
    if (type === "notebook") {
      const notebook = await tx.notebook.findFirst({ where: { id, userId, deletedAt: { not: null }, isDeletionRoot: true } });
      if (!notebook) throw new ApiError(404, "Элемент корзины не найден");
      const groupId = notebook.deletionGroupId ?? notebook.id;
      await tx.notebook.update({ where: { id }, data: { deletedAt: null, deletionGroupId: null, isDeletionRoot: false } });
      await tx.section.updateMany({ where: { notebookId: id, deletionGroupId: groupId }, data: { deletedAt: null, deletionGroupId: null, isDeletionRoot: false } });
      await tx.page.updateMany({ where: { deletionGroupId: groupId, section: { notebookId: id } }, data: { deletedAt: null, deletionGroupId: null, isDeletionRoot: false } });
      return;
    }

    if (type === "section") {
      const section = await tx.section.findFirst({ where: { id, deletedAt: { not: null }, isDeletionRoot: true, notebook: { userId } }, include: { notebook: true } });
      if (!section) throw new ApiError(404, "Элемент корзины не найден");
      const groupId = section.deletionGroupId ?? section.id;
      const targetNotebook = section.notebook.deletedAt === null ? section.notebook : await ensureActiveNotebook(tx, userId);
      const originalParent = section.parentId ? await tx.section.findFirst({ where: { id: section.parentId, notebookId: targetNotebook.id, deletedAt: null } }) : null;
      await tx.section.updateMany({ where: { deletionGroupId: groupId, notebook: { userId } }, data: { notebookId: targetNotebook.id, deletedAt: null, deletionGroupId: null, isDeletionRoot: false } });
      await tx.section.update({ where: { id }, data: { parentId: originalParent?.id ?? null } });
      await tx.page.updateMany({ where: { deletionGroupId: groupId, section: { notebook: { userId } } }, data: { deletedAt: null, deletionGroupId: null, isDeletionRoot: false } });
      return;
    }

    const page = await tx.page.findFirst({ where: { id, deletedAt: { not: null }, isDeletionRoot: true, section: { notebook: { userId } } }, include: { section: { include: { notebook: true } } } });
    if (!page) throw new ApiError(404, "Элемент корзины не найден");
    const targetSection = page.section.deletedAt === null && page.section.notebook.deletedAt === null ? page.section : await ensureActiveSection(tx, userId);
    await tx.page.update({ where: { id }, data: { sectionId: targetSection.id, deletedAt: null, deletionGroupId: null, isDeletionRoot: false } });
  });
}

export async function permanentlyDeleteTrashItem(userId: string, type: TrashItemType, id: string) {
  if (type === "notebook") {
    const deleted = await db.notebook.deleteMany({ where: { id, userId, deletedAt: { not: null }, isDeletionRoot: true } });
    if (!deleted.count) throw new ApiError(404, "Элемент корзины не найден");
    return;
  }
  if (type === "section") {
    const section = await db.section.findFirst({ where: { id, deletedAt: { not: null }, isDeletionRoot: true, notebook: { userId } }, select: { id: true } });
    if (!section) throw new ApiError(404, "Элемент корзины не найден");
    await db.section.delete({ where: { id } });
    return;
  }
  const page = await db.page.deleteMany({ where: { id, deletedAt: { not: null }, isDeletionRoot: true, section: { notebook: { userId } } } });
  if (!page.count) throw new ApiError(404, "Элемент корзины не найден");
}

export async function emptyTrash(userId: string) {
  await db.$transaction(async (tx) => {
    await tx.notebook.deleteMany({ where: { userId, deletedAt: { not: null } } });
    await tx.section.deleteMany({ where: { deletedAt: { not: null }, notebook: { userId } } });
    await tx.page.deleteMany({ where: { deletedAt: { not: null }, section: { notebook: { userId } } } });
  });
}
