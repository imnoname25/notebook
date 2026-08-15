import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";

export const NOTIFICATION_MAX_COUNT = 200;
export const NOTIFICATION_READ_RETENTION_DAYS = 90;
export type NotificationSeverity = "info" | "warning" | "error" | "success";

export async function cleanupNotifications(now = new Date()) {
  const cutoff = new Date(now.getTime() - NOTIFICATION_READ_RETENTION_DAYS * 86_400_000);
  await db.systemNotification.deleteMany({ where: { readAt: { not: null, lt: cutoff } } });
  const retained = await db.systemNotification.findMany({ orderBy: { createdAt: "desc" }, skip: NOTIFICATION_MAX_COUNT, select: { id: true } });
  if (retained.length) await db.systemNotification.deleteMany({ where: { id: { in: retained.map((item) => item.id) } } });
}

export async function createNotification(input: { type: string; severity: NotificationSeverity; title: string; message: string; dedupKey?: string }) {
  const safe = { ...input, title: input.title.slice(0, 160), message: input.message.slice(0, 1000) };
  const notification = input.dedupKey ? await db.systemNotification.findFirst({ where: { dedupKey: input.dedupKey, resolvedAt: null }, orderBy: { createdAt: "desc" } }) : null;
  const result = notification ? await db.systemNotification.update({ where: { id: notification.id }, data: { ...safe, readAt: null, updatedAt: new Date() } }) : await db.systemNotification.create({ data: safe });
  await cleanupNotifications(); return result;
}
export async function resolveNotification(dedupKey: string) { await db.systemNotification.updateMany({ where: { dedupKey, resolvedAt: null }, data: { resolvedAt: new Date(), readAt: new Date() } }); }
export async function listNotifications(limit = 30) { const [notifications, unread] = await Promise.all([db.systemNotification.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 50) }), db.systemNotification.count({ where: { readAt: null, resolvedAt: null } })]); return { notifications, unread }; }
export async function markNotificationRead(id: string) { const item = await db.systemNotification.findUnique({ where: { id } }); if (!item) throw new ApiError(404, "Уведомление не найдено"); return db.systemNotification.update({ where: { id }, data: { readAt: new Date() } }); }
export async function markAllNotificationsRead() { await db.systemNotification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } }); }
