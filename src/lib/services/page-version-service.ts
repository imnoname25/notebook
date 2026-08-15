import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { pageContentHash, retainedVersionIds, shouldCreateSnapshot, type PageVersionPolicy, type SnapshotReason } from "@/lib/page-version-policy";

type PageState = { id: string; title: string; content: Prisma.JsonValue; searchText: string; revision: number };

export async function createPageSnapshot(tx: Prisma.TransactionClient, page: PageState, reason: SnapshotReason, now = new Date()) {
  const policy = await pageVersionPolicy(tx);
  const latest = await tx.pageVersion.findFirst({ where: { pageId: page.id }, orderBy: { createdAt: "desc" }, select: { contentHash: true, createdAt: true } });
  const contentHash = pageContentHash(page.title, page.content);
  if (!shouldCreateSnapshot({ currentHash: contentHash, latestHash: latest?.contentHash, latestCreatedAt: latest?.createdAt, reason, now }, policy)) return null;
  const version = await tx.pageVersion.create({ data: { pageId: page.id, title: page.title, content: page.content as Prisma.InputJsonValue, searchText: page.searchText, contentHash, reason, createdAt: now } });
  await enforcePageVersionRetention(tx, page.id, now, policy);
  return version;
}

async function pageVersionPolicy(tx: Prisma.TransactionClient): Promise<PageVersionPolicy> { const settings = await tx.applicationSettings.findUnique({ where: { id: "singleton" }, select: { pageVersionIntervalMinutes: true, pageVersionRetentionDays: true, pageVersionMaxCount: true } }); return { intervalMs: (settings?.pageVersionIntervalMinutes ?? 5) * 60_000, maxAgeMs: (settings?.pageVersionRetentionDays ?? 30) * 86_400_000, maxCount: settings?.pageVersionMaxCount ?? 100 }; }

export async function enforcePageVersionRetention(tx: Prisma.TransactionClient, pageId: string, now = new Date(), policy?: PageVersionPolicy) {
  const effectivePolicy = policy ?? await pageVersionPolicy(tx);
  const versions = await tx.pageVersion.findMany({ where: { pageId }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
  const retained = new Set(retainedVersionIds(versions, now, effectivePolicy));
  const remove = versions.filter((version) => !retained.has(version.id)).map((version) => version.id);
  if (remove.length) await tx.pageVersion.deleteMany({ where: { id: { in: remove }, pageId } });
}

const ownedVersionWhere = (userId: string, pageId: string) => ({
  pageId, page: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } },
});

export async function listPageVersions(userId: string, pageId: string, limit: number, cursor?: string) {
  const page = await db.page.findFirst({ where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } }, select: { id: true } });
  if (!page) throw new ApiError(404, "Страница не найдена");
  if (cursor && !(await db.pageVersion.findFirst({ where: { id: cursor, pageId }, select: { id: true } }))) throw new ApiError(404, "Курсор истории не найден");
  const versions = await db.pageVersion.findMany({
    where: { pageId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, title: true, reason: true, createdAt: true },
  });
  return { versions: versions.slice(0, limit), nextCursor: versions.length > limit ? versions[limit - 1]?.id ?? null : null };
}

export async function getPageVersion(userId: string, pageId: string, versionId: string) {
  const version = await db.pageVersion.findFirst({ where: { id: versionId, ...ownedVersionWhere(userId, pageId) }, select: { id: true, pageId: true, title: true, content: true, reason: true, createdAt: true } });
  if (!version) throw new ApiError(404, "Версия не найдена");
  return version;
}

export async function deletePageVersion(userId: string, pageId: string, versionId: string) {
  const version = await db.pageVersion.findFirst({ where: { id: versionId, ...ownedVersionWhere(userId, pageId) }, select: { id: true } });
  if (!version) throw new ApiError(404, "Версия не найдена");
  await db.pageVersion.delete({ where: { id: version.id } });
}

export async function restorePageVersion(userId: string, pageId: string, versionId: string, expectedRevision: number) {
  return db.$transaction(async (tx) => {
    const page = await tx.page.findFirst({ where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } }, select: { id: true, title: true, content: true, searchText: true, revision: true } });
    if (!page) throw new ApiError(404, "Страница не найдена");
    if (page.revision !== expectedRevision) throw new ApiError(409, "Страница была изменена. Обновите историю и повторите восстановление");
    const version = await tx.pageVersion.findFirst({ where: { id: versionId, pageId }, select: { title: true, content: true } });
    if (!version) throw new ApiError(404, "Версия не найдена");
    await createPageSnapshot(tx, page, "before_restore");
    const content = version.content as Prisma.InputJsonValue;
    const blocks = Array.isArray(version.content) ? version.content as Record<string, unknown>[] : [];
    return tx.page.update({ where: { id: pageId }, data: { title: version.title, content, searchText: extractBlockNoteText(blocks), revision: { increment: 1 } } });
  });
}
