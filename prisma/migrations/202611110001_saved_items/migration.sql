BEGIN;

CREATE TYPE "SavedItemReviewStatus" AS ENUM ('pending', 'reviewed');
CREATE TYPE "SavedItemOperation" AS ENUM ('create', 'convert');

CREATE TABLE "SavedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "title" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "reviewStatus" "SavedItemReviewStatus" NOT NULL DEFAULT 'pending',
    "archivedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "convertedPageId" TEXT REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchVector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', "title"), 'A') ||
        setweight(to_tsvector('simple', "text"), 'B') ||
        setweight(to_tsvector('simple', coalesce("url", '')), 'D')
    ) STORED
);

CREATE TABLE "SavedItemTag" (
    "savedItemId" TEXT NOT NULL REFERENCES "SavedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "tagId" TEXT NOT NULL REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("savedItemId", "tagId")
);

CREATE TABLE "SavedItemAttachment" (
    "savedItemId" TEXT NOT NULL REFERENCES "SavedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Check after both User cascades have removed their rows.
    "uploadId" TEXT NOT NULL REFERENCES "Upload"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    PRIMARY KEY ("savedItemId", "uploadId")
);

CREATE TABLE "SavedItemRequest" (
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "operation" "SavedItemOperation" NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    PRIMARY KEY ("userId", "operation", "key")
);

CREATE TABLE "SavedItemMetadataJob" (
    "savedItemId" TEXT NOT NULL PRIMARY KEY REFERENCES "SavedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "leaseToken" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "finishedAt" TIMESTAMP(3),
    "failed" BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX "SavedItem_userId_archivedAt_createdAt_id_idx" ON "SavedItem"("userId", "archivedAt", "createdAt", "id");
CREATE INDEX "SavedItem_convertedPageId_idx" ON "SavedItem"("convertedPageId");
CREATE INDEX "SavedItem_searchVector_idx" ON "SavedItem" USING GIN ("searchVector");
CREATE INDEX "SavedItemTag_tagId_savedItemId_idx" ON "SavedItemTag"("tagId", "savedItemId");
CREATE UNIQUE INDEX "SavedItemAttachment_savedItemId_position_key" ON "SavedItemAttachment"("savedItemId", "position");
CREATE INDEX "SavedItemAttachment_uploadId_idx" ON "SavedItemAttachment"("uploadId");
CREATE INDEX "SavedItemMetadataJob_finishedAt_availableAt_savedItemId_idx" ON "SavedItemMetadataJob"("finishedAt", "availableAt", "savedItemId");

COMMIT;
