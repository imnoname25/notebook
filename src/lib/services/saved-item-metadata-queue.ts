import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const LEASE_SECONDS = 60;
export const MAX_METADATA_ATTEMPTS = 3;

// A job is eligible again after its lease expires, including after a process restart.
export async function claimSavedItemMetadataJob() {
  const leaseToken = randomUUID();
  const [job] = await db.$queryRaw<{ savedItemId: string; url: string; attempts: number; finishedAt: Date | null }[]>(Prisma.sql`
    WITH candidate AS (
      SELECT j."savedItemId", s.url
      FROM "SavedItemMetadataJob" j JOIN "SavedItem" s ON s.id = j."savedItemId"
      WHERE j."finishedAt" IS NULL AND j."availableAt" <= (now() AT TIME ZONE 'UTC')
        AND s.url IS NOT NULL
      ORDER BY j."availableAt", j."savedItemId"
      LIMIT 1 FOR UPDATE OF j SKIP LOCKED
    )
    UPDATE "SavedItemMetadataJob" j SET "leaseToken" = CASE WHEN j.attempts < ${MAX_METADATA_ATTEMPTS} THEN ${leaseToken} END,
      "availableAt" = (now() AT TIME ZONE 'UTC') + ${LEASE_SECONDS} * interval '1 second',
      "finishedAt" = CASE WHEN j.attempts >= ${MAX_METADATA_ATTEMPTS} THEN now() AT TIME ZONE 'UTC' END,
      failed = j.attempts >= ${MAX_METADATA_ATTEMPTS},
      attempts = LEAST(j.attempts + 1, ${MAX_METADATA_ATTEMPTS})
    FROM candidate WHERE j."savedItemId" = candidate."savedItemId"
    RETURNING j."savedItemId", candidate.url, j.attempts, j."finishedAt"`);
  return job && !job.finishedAt ? { savedItemId: job.savedItemId, url: job.url, attempts: job.attempts, leaseToken } : null;
}

type MetadataOutcome = { status: "done" | "failed" } | { status: "retry"; retryAt: Date };

// The caller can commit metadata and acknowledge its lease in the same transaction.
export async function settleSavedItemMetadataJob(
  tx: Prisma.TransactionClient,
  job: { savedItemId: string; leaseToken: string },
  outcome: MetadataOutcome,
) {
  const retryAt = outcome.status === "retry" ? outcome.retryAt.toISOString() : null;
  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE "SavedItemMetadataJob" SET "leaseToken" = NULL,
      "finishedAt" = CASE WHEN ${outcome.status === "retry"} THEN NULL ELSE (clock_timestamp() AT TIME ZONE 'UTC') END,
      "availableAt" = COALESCE(${retryAt}::timestamptz AT TIME ZONE 'UTC', "availableAt"),
      failed = ${outcome.status === "failed"}
    WHERE "savedItemId" = ${job.savedItemId} AND "leaseToken" = ${job.leaseToken}
      AND "availableAt" > (clock_timestamp() AT TIME ZONE 'UTC') AND "finishedAt" IS NULL`);
  return updated === 1;
}
