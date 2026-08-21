import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { listFavoritePages, listRecentPages } from "./recent-page-service";

export async function getNotebookOverview(userId: string, notebookId: string) {
  const notebook = await db.notebook.findFirst({
    where: { id: notebookId, userId, deletedAt: null },
    select: {
      id: true,
      title: true,
      icon: true,
      color: true,
      updatedAt: true,
      sections: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          notebookId: true,
          parentId: true,
          title: true,
          icon: true,
          color: true,
          sortOrder: true,
          _count: { select: { pages: { where: { deletedAt: null } } } },
        },
      },
    },
  });
  if (!notebook) throw new ApiError(404, "Блокнот не найден");
  const [favorites, recent] = await Promise.all([
    listFavoritePages(userId, notebookId, 8),
    listRecentPages(userId, 8, notebookId),
  ]);
  return {
    notebook: { ...notebook, pageCount: notebook.sections.reduce((total, section) => total + section._count.pages, 0) },
    sections: notebook.sections.map(({ _count, ...section }) => ({ ...section, pageCount: _count.pages })),
    favorites,
    recent,
  };
}
