ALTER TABLE "QuickNote" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "userId"
    ORDER BY "isPinned" DESC, "updatedAt" DESC, "id"
  ) - 1 AS position
  FROM "QuickNote"
)
UPDATE "QuickNote"
SET "sortOrder" = ranked.position
FROM ranked
WHERE "QuickNote"."id" = ranked."id";

DROP INDEX IF EXISTS "QuickNote_userId_status_isPinned_updatedAt_idx";
CREATE INDEX "QuickNote_userId_status_isPinned_sortOrder_idx"
ON "QuickNote"("userId", "status", "isPinned", "sortOrder");
