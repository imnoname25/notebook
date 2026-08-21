import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { extractHashtags } from "@/lib/hashtags";

export async function syncPageTags(
  tx: Prisma.TransactionClient,
  userId: string,
  pageId: string,
  text: string,
) {
  const extracted = extractHashtags(text);
  const tags = await Promise.all(
    extracted.map(({ name, normalized }) =>
      tx.tag.upsert({
        where: { userId_normalized: { userId, normalized } },
        create: { userId, name, normalized },
        update: {},
        select: { id: true },
      }),
    ),
  );
  await tx.pageTag.deleteMany({
    where: { pageId, ...(tags.length ? { tagId: { notIn: tags.map((tag) => tag.id) } } : {}) },
  });
  if (tags.length) {
    await tx.pageTag.createMany({
      data: tags.map((tag) => ({ pageId, tagId: tag.id })),
      skipDuplicates: true,
    });
  }
}

async function resolveTags(tx: Prisma.TransactionClient, userId: string, text: string) {
  const extracted = extractHashtags(text);
  return Promise.all(
    extracted.map(({ name, normalized }) =>
      tx.tag.upsert({
        where: { userId_normalized: { userId, normalized } },
        create: { userId, name, normalized },
        update: {},
        select: { id: true },
      }),
    ),
  );
}

export async function syncQuickNoteTags(
  tx: Prisma.TransactionClient,
  userId: string,
  quickNoteId: string,
  text: string,
) {
  const tags = await resolveTags(tx, userId, text);
  await tx.quickNoteTag.deleteMany({
    where: {
      quickNoteId,
      ...(tags.length ? { tagId: { notIn: tags.map((tag) => tag.id) } } : {}),
    },
  });
  if (tags.length) {
    await tx.quickNoteTag.createMany({
      data: tags.map((tag) => ({ quickNoteId, tagId: tag.id })),
      skipDuplicates: true,
    });
  }
}

export async function listTags(userId: string, limit = 30) {
  const tags = await db.tag.findMany({
    where: {
      userId,
      OR: [
        { pages: { some: { page: { deletedAt: null, section: { deletedAt: null, notebook: { deletedAt: null, userId } } } } } },
        { quickNotes: { some: { quickNote: { userId, status: { in: ["INBOX", "ARCHIVED"] } } } } },
      ],
    },
    select: {
      name: true,
      normalized: true,
      _count: {
        select: {
          pages: { where: { page: { deletedAt: null, section: { deletedAt: null, notebook: { deletedAt: null, userId } } } } },
          quickNotes: { where: { quickNote: { userId, status: { in: ["INBOX", "ARCHIVED"] } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
  return tags
    .map((tag) => ({ name: tag.name, normalized: tag.normalized, count: tag._count.pages + tag._count.quickNotes }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ru"));
}

export async function getTagView(userId: string, normalized: string) {
  const tag = await db.tag.findFirst({
    where: { userId, normalized },
    select: {
      name: true,
      normalized: true,
      pages: {
        where: { page: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } } },
        orderBy: { page: { updatedAt: "desc" } },
        take: 30,
        select: { page: { select: { id: true, title: true, icon: true, updatedAt: true, section: { select: { id: true, title: true, notebook: { select: { id: true, title: true, color: true, icon: true } } } } } } },
      },
      quickNotes: {
        where: { quickNote: { userId, status: { in: ["INBOX", "ARCHIVED"] } } },
        orderBy: { quickNote: { updatedAt: "desc" } },
        take: 30,
        select: { quickNote: { select: { id: true, title: true, body: true, color: true, icon: true, status: true, updatedAt: true } } },
      },
    },
  });
  if (!tag) return null;
  return {
    name: tag.name,
    normalized: tag.normalized,
    pages: tag.pages.map(({ page }) => page),
    quickNotes: tag.quickNotes.map(({ quickNote }) => quickNote),
  };
}
