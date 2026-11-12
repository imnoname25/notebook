BEGIN;

CREATE TYPE "SavedArticleJobStatus" AS ENUM ('queued', 'running', 'retry', 'ready', 'fallback', 'failed');

CREATE TABLE "SavedArticle" (
  "savedItemId" TEXT PRIMARY KEY REFERENCES "SavedItem"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "contentVersion" INTEGER NOT NULL CHECK ("contentVersion" > 0),
  blocks JSONB NOT NULL CHECK (jsonb_typeof(blocks) = 'array'),
  "sourceUrl" TEXT NOT NULL,
  "extractedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "SavedArticleJob" (
  "savedItemId" TEXT PRIMARY KEY REFERENCES "SavedItem"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceUrl" TEXT NOT NULL,
  generation TEXT NOT NULL,
  status "SavedArticleJobStatus" NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "leaseUntil" TIMESTAMP(3),
  "leaseToken" TEXT,
  "finishedAt" TIMESTAMP(3),
  reason TEXT,
  CHECK (
    (status = 'running' AND "leaseUntil" IS NOT NULL AND "leaseToken" IS NOT NULL) OR
    (status <> 'running' AND "leaseUntil" IS NULL AND "leaseToken" IS NULL)
  ),
  CHECK ((status IN ('ready', 'fallback', 'failed')) = ("finishedAt" IS NOT NULL))
);

CREATE INDEX "SavedArticleJob_status_availableAt_savedItemId_idx" ON "SavedArticleJob"(status, "availableAt", "savedItemId");
CREATE INDEX "SavedArticleJob_status_leaseUntil_savedItemId_idx" ON "SavedArticleJob"(status, "leaseUntil", "savedItemId");

COMMIT;
