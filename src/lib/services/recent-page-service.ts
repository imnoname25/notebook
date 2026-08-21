import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";

export const RECENT_PAGE_LIMIT = 20;

const recentPageSelect = {
  id: true,
  lastOpenedAt: true,
  page: {
    select: {
      id: true,
      title: true,
      icon: true,
      color: true,
      isFavorite: true,
      updatedAt: true,
      section: {
        select: {
          id: true,
          title: true,
          notebook: { select: { id: true, title: true, icon: true, color: true } },
        },
      },
    },
  },
} as const;

export async function recordRecentPage(userId: string, pageId: string) {
  const page = await db.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      section: { deletedAt: null, notebook: { userId, deletedAt: null } },
    },
    select: { id: true },
  });
  if (!page) throw new ApiError(404, "Страница не найдена");

  return db.$transaction(async (tx) => {
    const recent = await tx.recentPage.upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId },
      update: { lastOpenedAt: new Date() },
      select: { id: true, lastOpenedAt: true },
    });
    const stale = await tx.recentPage.findMany({
      where: { userId },
      orderBy: { lastOpenedAt: "desc" },
      skip: RECENT_PAGE_LIMIT,
      select: { id: true },
    });
    if (stale.length) {
      await tx.recentPage.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
    }
    return recent;
  });
}

export async function listRecentPages(userId: string, limit = 12, notebookId?: string) {
  const rows = await db.recentPage.findMany({
    where: {
      userId,
      page: {
        deletedAt: null,
        section: {
          deletedAt: null,
          notebook: { userId, deletedAt: null, ...(notebookId ? { id: notebookId } : {}) },
        },
      },
    },
    orderBy: { lastOpenedAt: "desc" },
    take: Math.min(limit, RECENT_PAGE_LIMIT),
    select: recentPageSelect,
  });
  return rows.map(({ lastOpenedAt, page }) => ({
    ...page,
    sectionId: page.section.id,
    sectionTitle: page.section.title,
    notebookId: page.section.notebook.id,
    notebookTitle: page.section.notebook.title,
    notebookIcon: page.section.notebook.icon,
    notebookColor: page.section.notebook.color,
    lastOpenedAt,
  }));
}

export async function listFavoritePages(userId: string, notebookId?: string, limit = 12) {
  const pages = await db.page.findMany({
    where: {
      isFavorite: true,
      deletedAt: null,
      section: {
        deletedAt: null,
        notebook: { userId, deletedAt: null, ...(notebookId ? { id: notebookId } : {}) },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      icon: true,
      color: true,
      isFavorite: true,
      updatedAt: true,
      section: { select: { id: true, title: true, notebook: { select: { id: true, title: true, icon: true, color: true } } } },
    },
  });
  return pages.map((page) => ({
    ...page,
    sectionId: page.section.id,
    sectionTitle: page.section.title,
    notebookId: page.section.notebook.id,
    notebookTitle: page.section.notebook.title,
    notebookIcon: page.section.notebook.icon,
    notebookColor: page.section.notebook.color,
  }));
}
