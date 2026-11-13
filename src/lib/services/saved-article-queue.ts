import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { savedArticleBlocks, SAVED_ARTICLE_CONTENT_VERSION, SAVED_ARTICLE_IMAGE_VERSION, type SavedArticleBlocks } from "@/lib/saved-article-format";
import { metadataUrl } from "@/lib/saved-metadata-network";
import type { PreparedArticleImage } from "./saved-article-images";
import { withUploadWrites } from "./upload-service";

export const MAX_ARTICLE_ATTEMPTS = 3;
const LEASE_SECONDS = 30;
const utcNow = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;
const MANUAL_COOLDOWN_MS = 60_000;

export async function enqueueNewSavedArticle(tx: Prisma.TransactionClient, savedItemId: string, url: string | null, hasAttachments: boolean) {
  if (process.env.SAVED_ARTICLE_AUTO_EXTRACT !== "1" || !url || hasAttachments) return;
  try { metadataUrl(url); } catch { return; }

  await tx.$executeRaw`SAVEPOINT saved_article_capture`;
  try {
    await tx.savedArticleJob.create({ data: { savedItemId, sourceUrl: url, generation: randomUUID() } });
  } catch {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT saved_article_capture`;
    console.warn("Notebook could not queue automatic article extraction for a new bookmark");
  }
  await tx.$executeRaw`RELEASE SAVEPOINT saved_article_capture`;
}

export async function enqueueSavedArticle(userId: string, savedItemId: string, { manual = false } = {}) {
  return db.$transaction(async tx => {
    if (manual) {
      await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notebook:article-requests:${userId}`}, 0))`);
    }
    const [item] = await tx.$queryRaw<{ url: string | null }[]>(Prisma.sql`
      SELECT url FROM "SavedItem" WHERE id = ${savedItemId} AND "userId" = ${userId} FOR NO KEY UPDATE`);
    if (!item) throw new ApiError(404, "Материал не найден");
    if (!item.url) throw new ApiError(409, "У материала нет ссылки");
    try { metadataUrl(item.url); } catch { throw new ApiError(409, "Ссылка недоступна для извлечения"); }

    const now = new Date();
    if (manual) {
      const recent = new Date(now.getTime() - MANUAL_COOLDOWN_MS);
      const current = await tx.savedArticleJob.findUnique({ where: { savedItemId }, select: { status: true, requestedAt: true } });
      if (current && (current.status === "queued" || current.status === "running" || current.status === "retry"))
        throw new ApiError(409, "Статья уже обрабатывается");
      if ((current && current.requestedAt > recent) || await tx.savedArticleJob.count({
        where: { savedItem: { userId }, OR: [
          { requestedAt: { gt: recent } }, { status: { in: ["queued", "running", "retry"] } },
        ] },
      }) >= 5) throw new ApiError(429, "Повторите запрос немного позже");
    }
    const generation = randomUUID();
    const data = { generation, sourceUrl: item.url, availableAt: now, requestedAt: now };
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

type ClaimedJob = { savedItemId: string; userId: string; sourceUrl: string; generation: string; attempts: number; leaseToken: string };
export async function claimSavedArticleJob(): Promise<ClaimedJob | null> {
  const token = randomUUID();
  const [job] = await db.$queryRaw<(Omit<ClaimedJob, "leaseToken"> & { leaseToken: string | null })[]>(Prisma.sql`
    WITH candidate AS (
      SELECT j."savedItemId", s."userId", CASE WHEN s.url IS DISTINCT FROM j."sourceUrl" THEN 'source-changed'
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
    RETURNING j."savedItemId", candidate."userId", j."sourceUrl", j.generation, j.attempts, j."leaseToken"`);
  return job?.leaseToken ? { ...job, leaseToken: job.leaseToken } : null;
}

export type SavedArticleOutcome =
  | { status: "ready"; blocks: SavedArticleBlocks; images?: PreparedArticleImage[] }
  | { status: "fallback" | "failed"; reason: string }
  | { status: "retry"; reason: string; retryAt: Date };

class ExpiredArticleLease extends Error {}

export async function settleSavedArticleJob(job: ClaimedJob, outcome: SavedArticleOutcome, signal?: AbortSignal) {
  const blocks = outcome.status === "ready" ? savedArticleBlocks.parse(outcome.blocks) : null;
  const imageKeys = new Set(blocks?.flatMap(block => block.type === "image" ? [block.key] : []));
  const images = new Map(outcome.status === "ready" ? outcome.images?.map(image => [image.key, image]) : undefined);
  if (imageKeys.size !== images.size || [...imageKeys].some(key => !images.has(key))) throw new Error("Invalid article image references");
  const lease = Prisma.sql`"savedItemId" = ${job.savedItemId} AND "sourceUrl" = ${job.sourceUrl}
    AND generation = ${job.generation} AND "leaseToken" = ${job.leaseToken}
    AND status = 'running' AND "leaseUntil" > ${utcNow}`;
  return withUploadWrites(job.userId, async (tx, store) => {
    const [item] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "SavedItem" WHERE id = ${job.savedItemId} AND "userId" = ${job.userId} AND url = ${job.sourceUrl} FOR NO KEY UPDATE`);
    if (!item || signal?.aborted) return false;
    const [current] = await tx.$queryRaw<{ savedItemId: string }[]>(Prisma.sql`
      SELECT "savedItemId" FROM "SavedArticleJob" WHERE ${lease} FOR UPDATE`);
    if (!current) return false;
    const retryAt = outcome.status === "retry" ? outcome.retryAt.toISOString() : null;
    const reason = outcome.status === "ready" ? null : outcome.reason;
    if (blocks) {
      const data = { contentVersion: imageKeys.size ? SAVED_ARTICLE_IMAGE_VERSION : SAVED_ARTICLE_CONTENT_VERSION,
        blocks, sourceUrl: job.sourceUrl, extractedAt: new Date() };
      await tx.savedArticle.upsert({ where: { savedItemId: job.savedItemId }, create: { savedItemId: job.savedItemId, ...data }, update: data });
      await tx.savedArticleImage.deleteMany({ where: { savedItemId: job.savedItemId } });
      let position = 0;
      for (const imageKey of imageKeys) {
        signal?.throwIfAborted();
        const image = images.get(imageKey)!;
        const upload = image.file ? await store(image.file) : null;
        await tx.savedArticleImage.create({ data: {
          savedItemId: job.savedItemId, imageKey, sourceUrl: image.sourceUrl, position: position++, uploadId: upload?.id,
        } });
      }
    }
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "SavedArticleJob" SET status = ${outcome.status}::"SavedArticleJobStatus", reason = ${reason},
        "leaseToken" = NULL, "leaseUntil" = NULL,
        "finishedAt" = CASE WHEN ${retryAt}::timestamptz IS NULL THEN ${utcNow} END,
        "availableAt" = COALESCE(${retryAt}::timestamptz AT TIME ZONE 'UTC', "availableAt")
      WHERE ${lease}`);
    if (!changed) throw new ExpiredArticleLease();
    signal?.throwIfAborted();
    return true;
  }).catch((error: unknown) => {
    if (error instanceof ExpiredArticleLease) return false;
    throw error;
  });
}
