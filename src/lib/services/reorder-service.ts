import { ApiError } from "@/lib/errors";
import { db } from "@/lib/db";

export function assertExactOrder(received: string[], expected: string[]) {
  if (received.length !== new Set(received).size || received.length !== expected.length) throw new ApiError(400, "Передан неполный или повторяющийся порядок");
  const expectedSet = new Set(expected);
  if (received.some((id) => !expectedSet.has(id))) throw new ApiError(404, "Объект сортировки не найден");
}

export async function reorderNotebooks(userId: string, ids: string[]) {
  const current = await db.notebook.findMany({ where: { userId, deletedAt: null }, select: { id: true } });
  assertExactOrder(ids, current.map((item) => item.id));
  await db.$transaction(ids.map((id, sortOrder) => db.notebook.update({ where: { id }, data: { sortOrder } })));
}

export async function reorderSections(userId: string, notebookId: string, parentId: string | null, ids: string[]) {
  const notebook = await db.notebook.findFirst({ where: { id: notebookId, userId, deletedAt: null }, select: { id: true } });
  if (!notebook) throw new ApiError(404, "Блокнот не найден");
  if (parentId) {
    const parent = await db.section.findFirst({ where: { id: parentId, notebookId, deletedAt: null }, select: { id: true } });
    if (!parent) throw new ApiError(404, "Родительский раздел не найден");
  }
  const current = await db.section.findMany({ where: { notebookId, parentId, deletedAt: null }, select: { id: true } });
  assertExactOrder(ids, current.map((item) => item.id));
  await db.$transaction(ids.map((id, sortOrder) => db.section.update({ where: { id }, data: { sortOrder } })));
}

export async function reorderPages(userId: string, sectionId: string, ids: string[]) {
  const section = await db.section.findFirst({ where: { id: sectionId, deletedAt: null, notebook: { userId, deletedAt: null } }, select: { id: true } });
  if (!section) throw new ApiError(404, "Раздел не найден");
  const current = await db.page.findMany({ where: { sectionId, deletedAt: null }, select: { id: true } });
  assertExactOrder(ids, current.map((item) => item.id));
  await db.$transaction(ids.map((id, sortOrder) => db.page.update({ where: { id }, data: { sortOrder } })));
}
