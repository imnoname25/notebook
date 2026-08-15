-- Page history, optimistic concurrency, and hardened session lifecycle.
ALTER TABLE "Page" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Session"
ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "absoluteExpiresAt" TIMESTAMP(3);

UPDATE "Session"
SET "lastUsedAt" = "createdAt",
    "absoluteExpiresAt" = "createdAt" + INTERVAL '90 days';

ALTER TABLE "Session" ALTER COLUMN "absoluteExpiresAt" SET NOT NULL;

CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageVersion_pageId_createdAt_idx" ON "PageVersion"("pageId", "createdAt");
CREATE INDEX "Session_absoluteExpiresAt_idx" ON "Session"("absoluteExpiresAt");
CREATE INDEX "Session_lastUsedAt_idx" ON "Session"("lastUsedAt");

ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey"
FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
