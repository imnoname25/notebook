-- Recent pages are interaction history, not portable notebook content.
CREATE TABLE "RecentPage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecentPage_userId_pageId_key" ON "RecentPage"("userId", "pageId");
CREATE INDEX "RecentPage_userId_lastOpenedAt_idx" ON "RecentPage"("userId", "lastOpenedAt");
ALTER TABLE "RecentPage" ADD CONSTRAINT "RecentPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecentPage" ADD CONSTRAINT "RecentPage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
