import { db } from "@/lib/db";
import { listFavoritePages, listRecentPages } from "./recent-page-service";
import { listTags } from "./tag-service";

export async function getToday(userId: string) {
  const [inbox, recent, favorites, changed, tags, attention] = await Promise.all([
    db.quickNote.findMany({
      where: { userId, status: "INBOX" }, orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }], take: 5,
      select: { id: true, title: true, body: true, color: true, icon: true, isPinned: true, updatedAt: true },
    }),
    listRecentPages(userId, 5),
    listFavoritePages(userId, undefined, 5),
    db.page.findMany({
      where: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } },
      orderBy: { updatedAt: "desc" }, take: 5,
      select: { id: true, title: true, icon: true, updatedAt: true, section: { select: { id: true, title: true, notebook: { select: { id: true, title: true } } } } },
    }),
    listTags(userId, 12),
    db.liveWidgetResult.findMany({
      where: { status: { in: ["WARNING", "OFFLINE"] }, widget: { page: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } } } },
      orderBy: [{ status: "asc" }, { checkedAt: "desc" }], take: 5,
      select: { status: true, value: true, detail: true, checkedAt: true, widget: { select: { blockId: true, title: true, type: true, page: { select: { id: true, title: true, icon: true } } } } },
    }),
  ]);
  return { inbox, recent, favorites, changed, tags, attention };
}
