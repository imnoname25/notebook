import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { savedArticleBlocks, SAVED_ARTICLE_CONTENT_VERSION, type SavedArticleBlocks } from "@/lib/saved-article-format";
import { metadataUrl } from "@/lib/saved-metadata-network";

export const MAX_ARTICLE_ATTEMPTS = 3;
const LEASE_SECONDS = 30;
const utcNow = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;

export async function enqueueSavedArticle(userId: string, savedItemId: string) {
  return db.$transaction(async tx => {
    const [item] = await tx.$queryRaw<{ url: string | null }[]>(Prisma.sql`
      SELECT url FROM "SavedItem" WHERE id = ${savedItemId} AND "userId" = ${userId} FOR NO KEY UPDATE`);
    if (!item) throw new ApiError(404, "Материал не найден");
    if (!item.url) throw new ApiError(409, "У материала нет ссылки");
    try { metadataUrl(item.url); } catch { throw new ApiError(409, "Ссылка недоступна для извлечения"); }

    const generation = randomUUID();
    const data = { generation, sourceUrl: item.url, availableAt: new Date() };
    return tx.savedArticleJob.upsert({
      where: { savedItemId },
      create: { savedItemId, ...data },
      update: { ...data, status: "queued", attempts: 0, leaseUntil: null, leaseToken: null, finishedAt: null, reason: null },
      select: { generation: true, status: true },
    });
  });
}

export async function getSavedArticleState(userId: string, savedItemId: string) {
  const item = await db.savedItem.findFirst({
    where: { id: savedItemId, userId },
    select: {
      url: true,
      article: { select: { contentVersion: true, sourceUrl: true, extractedAt: true } },
      articleJob: { select: { generation: true, status: true, attempts: true, availableAt: true, finishedAt: true, reason: true } },
    },
  });
  if (!item) throw new ApiError(404, "Материал не найден");
  return { article: item.article?.sourceUrl === item.url ? item.article : null, job: item.articleJob };
}

type ClaimedJob = { savedItemId: string; sourceUrl: string; generation: string; attempts: number; leaseToken: string };
export async function claimSavedArticleJob(): Promise<ClaimedJob | null> {
  const token = randomUUID();
  const [job] = await db.$queryRaw<(Omit<ClaimedJob, "leaseToken"> & { leaseToken: string | null })[]>(Prisma.sql`
    WITH candidate AS (
      SELECT j."savedItemId", CASE WHEN s.url IS DISTINCT FROM j."sourceUrl" THEN 'source-changed'
        WHEN j.attempts >= ${MAX_ARTICLE_ATTEMPTS} THEN 'lease-expired' END AS failure
      FROM "SavedArticleJob" j JOIN "SavedItem" s ON s.id = j."savedItemId"
      WHERE (j.status IN ('queued', 'retry') AND j."availableAt" <= ${utcNow})
         OR (j.status = 'running' AND j."leaseUntil" <= ${utcNow})
      ORDER BY CASE WHEN j.status = 'running' THEN j."leaseUntil" ELSE j."availableAt" END, j."savedItemId"
      LIMIT 1 FOR UPDATE OF j SKIP LOCKED
    )
    UPDATE "SavedArticleJob" j
    SET status = (CASE WHEN candidate.failure IS NULL THEN 'running' ELSE 'failed' END)::"SavedArticleJobStatus",
      attempts = j.attempts + CASE WHEN candidate.failure IS NULL THEN 1 ELSE 0 END,
      "leaseToken" = CASE WHEN candidate.failure IS NULL THEN ${token} END,
      "leaseUntil" = CASE WHEN candidate.failure IS NULL THEN ${utcNow} + ${LEASE_SECONDS} * interval '1 second' END,
      "finishedAt" = CASE WHEN candidate.failure IS NOT NULL THEN ${utcNow} END,
      reason = candidate.failure
    FROM candidate WHERE j."savedItemId" = candidate."savedItemId"
    RETURNING j."savedItemId", j."sourceUrl", j.generation, j.attempts, j."leaseToken"`);
  return job?.leaseToken ? { ...job, leaseToken: job.leaseToken } : null;
}

export type SavedArticleOutcome =
  | { status: "ready"; blocks: SavedArticleBlocks }
  | { status: "fallback" | "failed"; reason: string }
  | { status: "retry"; reason: string; retryAt: Date };

export async function settleSavedArticleJob(job: ClaimedJob, outcome: SavedArticleOutcome, signal?: AbortSignal) {
  const blocks = outcome.status === "ready" ? savedArticleBlocks.parse(outcome.blocks) : null;
  return db.$transaction(async tx => {
    const [item] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "SavedItem" WHERE id = ${job.savedItemId} AND url = ${job.sourceUrl} FOR NO KEY UPDATE`);
    if (!item || signal?.aborted) return false;
    const retryAt = outcome.status === "retry" ? outcome.retryAt.toISOString() : null;
    const reason = outcome.status === "ready" ? null : outcome.reason;
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "SavedArticleJob" SET status = ${outcome.status}::"SavedArticleJobStatus", reason = ${reason},
        "leaseToken" = NULL, "leaseUntil" = NULL,
        "finishedAt" = CASE WHEN ${retryAt}::timestamptz IS NULL THEN ${utcNow} END,
        "availableAt" = COALESCE(${retryAt}::timestamptz AT TIME ZONE 'UTC', "availableAt")
      WHERE "savedItemId" = ${job.savedItemId} AND "sourceUrl" = ${job.sourceUrl}
        AND generation = ${job.generation} AND "leaseToken" = ${job.leaseToken}
        AND status = 'running' AND "leaseUntil" > ${utcNow}`);
    if (!changed) return false;
    if (blocks) {
      const data = { contentVersion: SAVED_ARTICLE_CONTENT_VERSION, blocks, sourceUrl: job.sourceUrl, extractedAt: new Date() };
      await tx.savedArticle.upsert({ where: { savedItemId: job.savedItemId }, create: { savedItemId: job.savedItemId, ...data }, update: data });
    }
    signal?.throwIfAborted();
    return true;
  });
}
