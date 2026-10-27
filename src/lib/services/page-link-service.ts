import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { internalPageIdsInContent } from "@/lib/portable-content";

export async function syncPageLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  sourcePageId: string,
  content: unknown,
) {
  const requested = [...internalPageIdsInContent(content)].filter((id) => id !== sourcePageId);
  const ownedTargets = requested.length
    ? await tx.page.findMany({
        where: {
          id: { in: requested },
          section: { notebook: { userId } },
        },
        select: { id: true },
      })
    : [];
  const targetIds = ownedTargets.map(({ id }) => id);
  await tx.pageLink.deleteMany({
    where: {
      sourcePageId,
      ...(targetIds.length ? { targetPageId: { notIn: targetIds } } : {}),
    },
  });
  if (targetIds.length) {
    await tx.pageLink.createMany({
      data: targetIds.map((targetPageId) => ({ sourcePageId, targetPageId })),
      skipDuplicates: true,
    });
  }
}

/** Metadata only, bounded and always scoped to the authenticated owner. */
export async function getLinkTargets(userId: string, ids?: string[], query = "") {
  const pages = await db.page.findMany({ where: { ...(ids ? { id: { in: ids.slice(0, 200) } } : {}), deletedAt: null,
    ...(query ? { title: { contains: query.slice(0, 100), mode: "insensitive" as const } } : {}),
    section: { deletedAt: null, notebook: { userId, deletedAt: null } } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: ids ? 200 : 15,
    select: { id: true, title: true, section: { select: { title: true, notebook: { select: { title: true } } } } } });
  return pages.map(page => ({ id: page.id, title: page.title, sectionTitle: page.section.title, notebookTitle: page.section.notebook.title }));
}

export type RelatedCandidate = {
  id: string;
  updatedAt: Date;
  sameSection: boolean;
  sharedTagCount: number;
  directlyLinked: boolean;
  linksBack: boolean;
};

export function rankRelatedPages(candidates: RelatedCandidate[]) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score:
        (candidate.directlyLinked ? 5 : 0) +
        (candidate.linksBack ? 3 : 0) +
        candidate.sharedTagCount * 2 +
        (candidate.sameSection ? 1 : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id));
}

export async function getPageKnowledge(userId: string, pageId: string) {
  const page = await db.page.findFirst({
    where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } },
    select: {
      id: true,
      sectionId: true,
      tags: { select: { tag: { select: { id: true, name: true, normalized: true } } } },
      outgoingLinks: { select: { targetPageId: true } },
      incomingLinks: {
        where: { sourcePage: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } } },
        select: { sourcePageId: true, sourcePage: { select: { title: true, icon: true, section: { select: { title: true, notebook: { select: { title: true } } } } } } },
      },
    },
  });
  if (!page) throw new ApiError(404, "Страница не найдена");
  const tagIds = page.tags.map(({ tag }) => tag.id);
  const outgoing = new Set(page.outgoingLinks.map(({ targetPageId }) => targetPageId));
  const incoming = new Set(page.incomingLinks.map(({ sourcePageId }) => sourcePageId));
  const candidates = await db.page.findMany({
    where: {
      id: { not: pageId },
      deletedAt: null,
      section: { deletedAt: null, notebook: { userId, deletedAt: null } },
      OR: [
        { id: { in: [...outgoing, ...incoming] } },
        ...(tagIds.length ? [{ tags: { some: { tagId: { in: tagIds } } } }] : []),
        { sectionId: page.sectionId },
      ],
    },
    take: 50,
    select: {
      id: true, title: true, icon: true, updatedAt: true, sectionId: true,
      section: { select: { title: true, notebook: { select: { title: true } } } },
      tags: { where: { tagId: { in: tagIds } }, select: { tagId: true } },
    },
  });
  const ranking = new Map(rankRelatedPages(candidates.map((candidate) => ({
    id: candidate.id,
    updatedAt: candidate.updatedAt,
    sameSection: candidate.sectionId === page.sectionId,
    sharedTagCount: candidate.tags.length,
    directlyLinked: outgoing.has(candidate.id),
    linksBack: incoming.has(candidate.id),
  }))).slice(0, 5).map((item) => [item.id, item.score]));
  return {
    tags: page.tags.map(({ tag }) => tag),
    backlinks: page.incomingLinks.map(({ sourcePageId, sourcePage }) => ({ id: sourcePageId, ...sourcePage })),
    related: candidates
      .filter(({ id }) => ranking.has(id))
      .sort((left, right) => (ranking.get(right.id) ?? 0) - (ranking.get(left.id) ?? 0))
      .map((candidate) => ({ id: candidate.id, title: candidate.title, icon: candidate.icon, section: candidate.section, score: ranking.get(candidate.id) })),
  };
}
