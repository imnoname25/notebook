import { db } from "@/lib/db";
import type { SearchResult } from "./search-service";
import { listFavoritePages, listRecentPages } from "./recent-page-service";

const plain = (text: string) => [{ text, highlight: false }];

export async function getQuickSwitcher(userId: string) {
  const [recent, favorites, notebooks] = await Promise.all([
    listRecentPages(userId, 10),
    listFavoritePages(userId, undefined, 10),
    db.notebook.findMany({
      where: { userId, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      take: 20,
      select: {
        id: true, title: true, icon: true, color: true,
        sections: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, take: 30, select: { id: true, title: true } },
      },
    }),
  ]);
  const pageResult = (page: (typeof recent)[number]): SearchResult => ({
    type: "page", id: page.id, title: page.title, titleParts: plain(page.title),
    notebookId: page.notebookId, notebookTitle: page.notebookTitle,
    notebookColor: page.notebookColor, notebookIcon: page.notebookIcon,
    sectionId: page.sectionId, sectionTitle: page.sectionTitle,
  });
  return {
    recent: recent.map(pageResult),
    favorites: favorites.map((page) => pageResult({ ...page, lastOpenedAt: page.updatedAt })),
    notebooks: notebooks.map<SearchResult>((notebook) => ({ type: "notebook", id: notebook.id, title: notebook.title, titleParts: plain(notebook.title), notebookId: notebook.id, notebookTitle: notebook.title, notebookColor: notebook.color, notebookIcon: notebook.icon })),
    sections: notebooks.flatMap((notebook) => notebook.sections.map<SearchResult>((section) => ({ type: "section", id: section.id, title: section.title, titleParts: plain(section.title), notebookId: notebook.id, notebookTitle: notebook.title, notebookColor: notebook.color, notebookIcon: notebook.icon, sectionId: section.id, sectionTitle: section.title }))).slice(0, 30),
  };
}
