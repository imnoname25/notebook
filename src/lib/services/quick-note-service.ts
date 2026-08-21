import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { syncPageLinks } from "@/lib/services/page-link-service";
import { syncPageTags, syncQuickNoteTags } from "@/lib/services/tag-service";

const quickNoteSelect = {
  id: true, title: true, body: true, color: true, icon: true,
  isPinned: true, status: true, archivedAt: true, createdAt: true, updatedAt: true,
  tags: { select: { tag: { select: { name: true, normalized: true } } } },
} as const;

export async function listQuickNotes(userId: string, archived = false) {
  return db.quickNote.findMany({
    where: { userId, status: archived ? { in: ["ARCHIVED", "CONVERTED"] } : "INBOX" },
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    select: quickNoteSelect,
  });
}

export async function createQuickNote(userId: string, input: { title?: string; body?: string; color?: string; icon?: string | null }) {
  return db.$transaction(async (tx) => {
    const note = await tx.quickNote.create({ data: { userId, ...input }, select: quickNoteSelect });
    await syncQuickNoteTags(tx, userId, note.id, `${note.title} ${note.body}`);
    return tx.quickNote.findUniqueOrThrow({ where: { id: note.id }, select: quickNoteSelect });
  });
}

export async function updateQuickNote(userId: string, id: string, input: { title?: string; body?: string; color?: string; icon?: string | null; isPinned?: boolean; archived?: boolean }) {
  const owned = await db.quickNote.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new ApiError(404, "Быстрая заметка не найдена");
  const { archived, ...data } = input;
  return db.$transaction(async (tx) => {
    const note = await tx.quickNote.update({
      where: { id },
      data: {
        ...data,
        ...(archived === undefined ? {} : {
          archivedAt: archived ? new Date() : null,
          status: archived ? "ARCHIVED" : "INBOX",
        }),
      },
      select: quickNoteSelect,
    });
    if (input.title !== undefined || input.body !== undefined) {
      await syncQuickNoteTags(tx, userId, id, `${note.title} ${note.body}`);
    }
    return tx.quickNote.findUniqueOrThrow({ where: { id }, select: quickNoteSelect });
  });
}

export async function deleteQuickNote(userId: string, id: string) {
  const result = await db.quickNote.deleteMany({ where: { id, userId } });
  if (!result.count) throw new ApiError(404, "Быстрая заметка не найдена");
}

export async function convertQuickNote(userId: string, id: string, sectionId: string) {
  return db.$transaction(async (tx) => {
    const [note, section] = await Promise.all([
      tx.quickNote.findFirst({ where: { id, userId } }),
      tx.section.findFirst({ where: { id: sectionId, deletedAt: null, notebook: { userId, deletedAt: null } }, select: { id: true } }),
    ]);
    if (!note) throw new ApiError(404, "Быстрая заметка не найдена");
    if (!section) throw new ApiError(404, "Раздел назначения не найден");
    const last = await tx.page.aggregate({ where: { sectionId, deletedAt: null }, _max: { sortOrder: true } });
    const lines = note.body.replace(/\r\n/g, "\n").split("\n");
    const content = lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line, styles: {} }] : [] }));
    const searchText = extractBlockNoteText(content);
    const page = await tx.page.create({
      data: {
        sectionId,
        title: note.title.trim() || "Быстрая заметка",
        icon: note.icon,
        color: note.color,
        content: content as Prisma.InputJsonValue,
        searchText,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    await syncPageTags(tx, userId, page.id, `${page.title} ${searchText}`);
    await syncPageLinks(tx, userId, page.id, content);
    await tx.quickNote.update({ where: { id }, data: { status: "CONVERTED", archivedAt: new Date() } });
    return page;
  });
}
